import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
process.umask(0o077);
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDir, 0o700);
const dbPath = path.join(dataDir, 'as-anamul-voice.sqlite');
const db = new DatabaseSync(dbPath);
fs.chmodSync(dbPath, 0o600);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS client_keys (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS client_sessions (
    token_hash TEXT PRIMARY KEY,
    key_id TEXT NOT NULL REFERENCES client_keys(id) ON DELETE CASCADE,
    device_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_voice_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const defaults = {
  displayName: 'AS ANAMUL VOICE',
  telegramUrl: 'https://t.me/crackffpanel',
  modelId: 'sonic-3.6',
  language: 'bn',
  defaultVoiceId: '',
};
for (const [key, value] of Object.entries(defaults)) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key, value);
}

function nowIso() { return new Date().toISOString(); }
function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? defaults[key] ?? '';
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function hashToken(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function randomToken(prefix = '') { return prefix + crypto.randomBytes(32).toString('base64url'); }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function passwordMatches(password, salt, expected) {
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeEqual(actual, expected);
}

const configuredAdmin = String(process.env.ADMIN_USERNAME || '').trim();
const configuredPassword = String(process.env.ADMIN_PASSWORD || '');
if (configuredAdmin && configuredPassword) {
  const existing = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
  if (!existing) {
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(configuredPassword, salt, 64).toString('hex');
    db.prepare('INSERT INTO admin_users(username,salt,password_hash,created_at) VALUES(?,?,?,?)')
      .run(configuredAdmin, salt, passwordHash, nowIso());
    console.info('Initial admin account created from environment configuration.');
  }
} else {
  console.warn('Admin bootstrap is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD before login.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'", 'https://*.manus.computer'],
    },
  },
  frameguard: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '64kb', type: 'application/json' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/assets', express.static(path.join(root, 'admin'), { fallthrough: false, maxAge: '1h' }));
app.get(['/', '/admin', '/admin/'], (_req, res) => res.sendFile(path.join(root, 'admin', 'index.html')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
const ttsIpLimiter = rateLimit({ windowMs: 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false });
const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => `client:${req.clientSession?.key_id ?? ipKeyGenerator(req.ip)}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
let inFlightTts = 0;
function ttsConcurrency(req, res, next) {
  if (inFlightTts >= 4) return res.status(503).json({ error: 'tts_capacity_reached' });
  inFlightTts += 1;
  let released = false;
  const release = () => { if (!released) { released = true; inFlightTts = Math.max(0, inFlightTts - 1); } };
  res.once('finish', release);
  res.once('close', release);
  next();
}
const adminCookie = 'asav_admin';
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const item of raw.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) {
      try { return decodeURIComponent(item.slice(index + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}
function adminAuth(req, res, next) {
  const token = cookieValue(req, adminCookie);
  if (!token) return res.status(401).json({ error: 'admin_login_required' });
  const session = db.prepare('SELECT username,expires_at FROM admin_sessions WHERE token_hash=?').get(hashToken(token));
  if (!session || Date.parse(session.expires_at) < Date.now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashToken(token));
    return res.status(401).json({ error: 'admin_session_expired' });
  }
  req.admin = { username: session.username };
  next();
}
function clientAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'client_login_required' });
  const session = db.prepare(`
    SELECT s.token_hash,s.key_id,s.expires_at,k.active
    FROM client_sessions s JOIN client_keys k ON k.id=s.key_id
    WHERE s.token_hash=?
  `).get(hashToken(token));
  if (!session || session.active !== 1 || Date.parse(session.expires_at) < Date.now()) {
    return res.status(401).json({ error: 'client_session_expired' });
  }
  req.clientSession = session;
  next();
}
function adminOriginGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return res.status(403).json({ error: 'admin_origin_required' });
  try {
    const origin = new URL(source);
    const host = String(req.get('host') || '').toLowerCase();
    const localHttp = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if ((origin.protocol !== 'https:' && !localHttp) || origin.host.toLowerCase() !== host) {
      return res.status(403).json({ error: 'admin_origin_mismatch' });
    }
  } catch {
    return res.status(403).json({ error: 'admin_origin_invalid' });
  }
  return next();
}
app.use('/api/admin', adminOriginGuard);
function listEnabledVoices() {
  return db.prepare('SELECT id,name FROM voices WHERE enabled=1 ORDER BY sort_order,name').all();
}
function publicConfig() {
  return {
    displayName: getSetting('displayName'),
    telegramUrl: getSetting('telegramUrl'),
    modelId: getSetting('modelId'),
    language: getSetting('language'),
    defaultVoiceId: getSetting('defaultVoiceId'),
    voices: listEnabledVoices(),
  };
}
function normalizeVoicePayload(body) {
  const name = String(body?.name || '').trim();
  const providerVoiceId = String(body?.providerVoiceId || '').trim();
  if (!name || name.length > 64) return { error: 'name_must_be_1_to_64_chars' };
  if (!providerVoiceId || providerVoiceId.length > 180 || !/^[A-Za-z0-9_-]+$/.test(providerVoiceId)) {
    return { error: 'invalid_provider_voice_id' };
  }
  return { name, providerVoiceId };
}
function cartesiaHeaders() {
  const key = String(process.env.CARTESIA_API_KEY || '').trim();
  return {
    key,
    headers: {
      Authorization: `Bearer ${key}`,
      'Cartesia-Version': process.env.CARTESIA_VERSION || '2026-08-14',
      Accept: 'application/json',
    },
  };
}

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, service: 'as-anamul-voice-backend' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'online', timestamp: nowIso() }));

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const admin = db.prepare('SELECT username,salt,password_hash FROM admin_users WHERE username=?').get(username);
  if (!admin || !passwordMatches(password, admin.salt, admin.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO admin_sessions(token_hash,username,expires_at) VALUES(?,?,?)').run(hashToken(token), username, expiresAt);
  res.cookie(adminCookie, token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
  return res.json({ ok: true, username });
});
app.get('/api/admin/me', adminAuth, (req, res) => res.json({ ok: true, username: req.admin.username }));
app.post('/api/admin/logout', adminAuth, (req, res) => {
  const token = cookieValue(req, adminCookie);
  db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashToken(token));
  res.clearCookie(adminCookie, { httpOnly: true, sameSite: 'none', secure: true, path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/status', adminAuth, (_req, res) => {
  const counts = db.prepare('SELECT (SELECT count(*) FROM voices WHERE enabled=1) AS voiceCount, (SELECT count(*) FROM client_keys WHERE active=1) AS activeKeyCount').get();
  res.json({
    ok: true,
    service: 'online',
    providerKeyConfigured: Boolean(process.env.CARTESIA_API_KEY),
    adminUsername: configuredAdmin || null,
    voiceCount: counts.voiceCount,
    activeKeyCount: counts.activeKeyCount,
    modelId: getSetting('modelId'),
    version: '1.0.0',
    uptimeSeconds: Math.floor(process.uptime()),
  });
});
app.post('/api/admin/cartesia-check', adminAuth, async (_req, res) => {
  const { key, headers } = cartesiaHeaders();
  if (!key) return res.status(503).json({ ok: false, error: 'CARTESIA_API_KEY_not_configured' });
  const started = Date.now();
  try {
    const response = await fetch('https://api.cartesia.ai/voices?limit=1', { headers, signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: 'cartesia_rejected_connection', providerStatus: response.status });
    }
    const payload = await response.json();
    return res.json({ ok: true, provider: 'Cartesia', voiceCountReturned: Array.isArray(payload.data) ? payload.data.length : 0, latencyMs: Date.now() - started });
  } catch {
    return res.status(502).json({ ok: false, error: 'cartesia_connection_failed', latencyMs: Date.now() - started });
  }
});

app.get('/api/admin/settings', adminAuth, (_req, res) => res.json({ ...publicConfig(), cartesiaVersion: process.env.CARTESIA_VERSION || '2026-08-14' }));
app.put('/api/admin/settings', adminAuth, (req, res) => {
  const allowed = ['displayName', 'telegramUrl', 'modelId', 'language', 'defaultVoiceId'];
  const patch = req.body || {};
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) return res.status(400).json({ error: `unsupported_setting:${key}` });
  if ('displayName' in patch) {
    const value = String(patch.displayName).trim();
    if (!value || value.length > 64) return res.status(400).json({ error: 'invalid_displayName' });
    setSetting('displayName', value);
  }
  if ('telegramUrl' in patch) {
    const value = String(patch.telegramUrl).trim();
    if (!/^https:\/\/t\.me\/[A-Za-z0-9_]{4,64}$/.test(value)) return res.status(400).json({ error: 'invalid_telegramUrl' });
    setSetting('telegramUrl', value);
  }
  if ('modelId' in patch) {
    const value = String(patch.modelId);
    if (!['sonic-3.6', 'sonic-3.5', 'sonic-3', 'sonic-latest'].includes(value)) return res.status(400).json({ error: 'invalid_modelId' });
    setSetting('modelId', value);
  }
  if ('language' in patch) {
    const value = String(patch.language).trim();
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value)) return res.status(400).json({ error: 'invalid_language' });
    setSetting('language', value);
  }
  if ('defaultVoiceId' in patch) {
    const value = String(patch.defaultVoiceId).trim();
    if (value && !db.prepare('SELECT id FROM voices WHERE id=? AND enabled=1').get(value)) return res.status(400).json({ error: 'default_voice_must_be_enabled' });
    setSetting('defaultVoiceId', value);
  }
  return res.json(publicConfig());
});

app.get('/api/admin/voices', adminAuth, (_req, res) => {
  const voices = db.prepare('SELECT id,name,provider_voice_id AS providerVoiceId,enabled,sort_order AS sortOrder,created_at AS createdAt FROM voices ORDER BY sort_order,name').all();
  res.json({ voices });
});
app.post('/api/admin/voices', adminAuth, (req, res) => {
  const value = normalizeVoicePayload(req.body);
  if (value.error) return res.status(400).json({ error: value.error });
  const id = crypto.randomUUID();
  try {
    db.prepare('INSERT INTO voices(id,name,provider_voice_id,enabled,sort_order,created_at) VALUES(?,?,?,1,0,?)').run(id, value.name, value.providerVoiceId, nowIso());
  } catch {
    return res.status(409).json({ error: 'voice_already_exists' });
  }
  return res.status(201).json({ id, ...value, enabled: true });
});
app.patch('/api/admin/voices/:id', adminAuth, (req, res) => {
  const voice = db.prepare('SELECT id FROM voices WHERE id=?').get(req.params.id);
  if (!voice) return res.status(404).json({ error: 'voice_not_found' });
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled_boolean_required' });
  db.prepare('UPDATE voices SET enabled=? WHERE id=?').run(req.body.enabled ? 1 : 0, req.params.id);
  if (!req.body.enabled && getSetting('defaultVoiceId') === req.params.id) setSetting('defaultVoiceId', '');
  return res.json({ ok: true });
});
app.delete('/api/admin/voices/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM voices WHERE id=?').run(req.params.id);
  if (getSetting('defaultVoiceId') === req.params.id) setSetting('defaultVoiceId', '');
  return res.status(204).end();
});

app.get('/api/admin/client-keys', adminAuth, (_req, res) => {
  const keys = db.prepare('SELECT id,label,active,created_at AS createdAt,last_used_at AS lastUsedAt FROM client_keys ORDER BY created_at DESC').all();
  res.json({ keys });
});
app.post('/api/admin/client-keys', adminAuth, (req, res) => {
  const label = String(req.body?.label || '').trim();
  if (!label || label.length > 64) return res.status(400).json({ error: 'label_must_be_1_to_64_chars' });
  const id = crypto.randomUUID();
  const accessKey = randomToken('asav_');
  db.prepare('INSERT INTO client_keys(id,label,key_hash,active,created_at) VALUES(?,?,?,1,?)').run(id, label, hashToken(accessKey), nowIso());
  return res.status(201).json({ id, label, accessKey, warning: 'Copy this key now. It will not be shown again.' });
});
app.patch('/api/admin/client-keys/:id', adminAuth, (req, res) => {
  if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'active_boolean_required' });
  const result = db.prepare('UPDATE client_keys SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'client_key_not_found' });
  return res.json({ ok: true });
});
app.delete('/api/admin/client-keys/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM client_keys WHERE id=?').run(req.params.id);
  db.prepare('DELETE FROM client_sessions WHERE key_id=?').run(req.params.id);
  return res.status(204).end();
});

app.post('/api/client/login', loginLimiter, (req, res) => {
  const accessKey = String(req.body?.accessKey || '').trim();
  const deviceId = String(req.body?.deviceId || '').trim();
  if (accessKey.length < 24 || accessKey.length > 256 || !deviceId || deviceId.length > 160) return res.status(400).json({ error: 'invalid_login_input' });
  db.prepare('DELETE FROM client_sessions WHERE expires_at < ?').run(nowIso());
  const row = db.prepare('SELECT id FROM client_keys WHERE key_hash=? AND active=1').get(hashToken(accessKey));
  if (!row) return res.status(401).json({ error: 'invalid_or_disabled_access_key' });
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO client_sessions(token_hash,key_id,device_hash,expires_at) VALUES(?,?,?,?)').run(hashToken(token), row.id, hashToken(deviceId), expiresAt);
  db.prepare('UPDATE client_keys SET last_used_at=? WHERE id=?').run(nowIso(), row.id);
  return res.json({ accessToken: token, expiresAt });
});
app.get('/api/client/config', clientAuth, (_req, res) => res.json(publicConfig()));
app.get('/api/client/voices', clientAuth, (_req, res) => res.json({ voices: listEnabledVoices() }));
app.post('/api/client/tts', ttsIpLimiter, clientAuth, ttsLimiter, ttsConcurrency, async (req, res) => {
  const transcript = String(req.body?.text || '').trim();
  const requestedVoiceId = String(req.body?.voiceId || '').trim();
  const voiceId = requestedVoiceId || getSetting('defaultVoiceId');
  if (!transcript || transcript.length > 1500) return res.status(400).json({ error: 'text_must_be_1_to_1500_chars' });
  const voice = db.prepare('SELECT provider_voice_id FROM voices WHERE id=? AND enabled=1').get(voiceId);
  if (!voice) return res.status(400).json({ error: 'voice_unavailable' });
  const { key } = cartesiaHeaders();
  if (!key) return res.status(503).json({ error: 'tts_provider_not_configured' });
  const payload = {
    model_id: getSetting('modelId'),
    transcript,
    voice: { id: voice.provider_voice_id },
    language: getSetting('language'),
    output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
  };
  try {
    const upstream = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Cartesia-Version': process.env.CARTESIA_VERSION || '2026-08-14',
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(65000),
    });
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
      return res.status(status).json({ error: status === 429 ? 'provider_rate_limited' : 'tts_provider_request_failed', providerStatus: upstream.status });
    }
    const maxBytes = 12 * 1024 * 1024;
    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > maxBytes || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      return res.status(502).json({ error: 'invalid_audio_response' });
    }
    const reader = upstream.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          return res.status(502).json({ error: 'invalid_audio_response' });
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    if (!totalBytes) return res.status(502).json({ error: 'invalid_audio_response' });
    const bytes = Buffer.concat(chunks, totalBytes);
    res.status(200).set({ 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg', 'Content-Length': String(bytes.length), 'X-Audio-Format': 'mp3' });
    return res.send(bytes);
  } catch {
    return res.status(502).json({ error: 'tts_provider_unreachable' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, _req, res, _next) => {
  console.error('Request failed:', err?.name || 'Error');
  if (res.headersSent) return;
  return res.status(500).json({ error: 'internal_server_error' });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => console.info(`AS ANAMUL VOICE backend listening on ${host}:${port}`));
