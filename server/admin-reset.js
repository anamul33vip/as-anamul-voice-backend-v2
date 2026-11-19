import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
process.umask(0o077);
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const dbPath = path.join(dataDir, 'as-anamul-voice.sqlite');
const username = String(process.env.ADMIN_USERNAME || '').trim();
const password = String(process.env.ADMIN_PASSWORD || '');

if (!username || password.length < 16) {
  console.error('Set ADMIN_USERNAME and a new ADMIN_PASSWORD of at least 16 characters in the protected environment or .env.');
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error('Database not found. Start the backend once to initialize its schema, then retry.');
  process.exit(1);
}

fs.chmodSync(dataDir, 0o700);
const db = new DatabaseSync(dbPath);
try {
  fs.chmodSync(dbPath, 0o600);
  const existing = db.prepare('SELECT id FROM admin_users WHERE username=?').get(username);
  const userCount = db.prepare('SELECT count(*) AS n FROM admin_users').get().n;
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  if (existing) {
    db.prepare('UPDATE admin_users SET salt=?,password_hash=? WHERE username=?').run(salt, passwordHash, username);
    db.prepare('DELETE FROM admin_sessions WHERE username=?').run(username);
  } else if (userCount === 0) {
    db.prepare('INSERT INTO admin_users(username,salt,password_hash,created_at) VALUES(?,?,?,?)').run(username, salt, passwordHash, new Date().toISOString());
  } else {
    throw new Error('ADMIN_USERNAME does not match an existing admin; refusing to add or rename an account implicitly.');
  }
  db.exec('COMMIT');
  console.info(existing ? 'Admin password rotated; prior sessions for this admin were revoked.' : 'Initial admin created in the existing database.');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  console.error(error?.message || 'Admin credential update failed.');
  process.exitCode = 1;
} finally {
  db.close();
}
