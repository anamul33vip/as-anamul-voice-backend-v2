const $ = (selector) => document.querySelector(selector);
const views = ['overview', 'voices', 'keys', 'settings'];
const labels = { overview: 'Command center', voices: 'Voice profiles', keys: 'App access keys', settings: 'App settings' };
let cachedVoices = [];
let toastTimer;
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  if (response.status === 204) return null;
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await response.json() : {};
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function showToast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function setView(name) {
  for (const view of views) {
    $(`#view-${view}`).classList.toggle('active-view', view === name);
    document.querySelector(`[data-view="${view}"]`).classList.toggle('active', view === name);
  }
  $('#page-title').textContent = labels[name]; $('#crumb').textContent = name.toUpperCase();
}
async function showApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const results = await Promise.allSettled([loadStatus(), loadVoices(), loadKeys(), loadSettings()]);
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) showToast(`${failed} dashboard section(s) could not load; use Refresh after checking the server.`);
}
function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
async function loadStatus() {
  const data = await api('/api/admin/status');
  $('#backend-status').textContent = data.service === 'online' ? 'ONLINE' : 'OFFLINE';
  $('#backend-status').style.color = 'var(--lime)';
  $('#uptime').textContent = `Running for ${Math.floor(data.uptimeSeconds / 60)} min · v${data.version}`;
  $('#key-status').textContent = data.providerKeyConfigured ? 'CONFIGURED' : 'MISSING';
  $('#key-status').style.color = data.providerKeyConfigured ? 'var(--cyan)' : 'var(--danger)';
  $('#voice-count').textContent = data.voiceCount; $('#access-count').textContent = data.activeKeyCount;
}
async function loadVoices() {
  const data = await api('/api/admin/voices'); cachedVoices = data.voices;
  const list = $('#voices-list');
  if (!data.voices.length) { list.innerHTML = '<div class="empty-state">এখনও voice যোগ করা হয়নি। একটি authorized Cartesia Voice ID যোগ করুন।</div>'; }
  else list.innerHTML = data.voices.map((v) => `<div class="list-row"><div class="row-icon">◉</div><div class="row-main"><strong>${escapeHtml(v.name)} ${v.enabled ? '' : '<small>(disabled)</small>'}</strong><small>${escapeHtml(v.providerVoiceId)}</small></div><div class="row-actions"><label class="toggle-label"><input class="toggle voice-toggle" type="checkbox" data-id="${escapeHtml(v.id)}" ${v.enabled ? 'checked' : ''} aria-label="Enable ${escapeHtml(v.name)}"></label><button class="small-button danger remove-voice" data-id="${escapeHtml(v.id)}">Remove</button></div></div>`).join('');
  list.querySelectorAll('.voice-toggle').forEach((el) => el.addEventListener('change', async () => { try { await api(`/api/admin/voices/${encodeURIComponent(el.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: el.checked }) }); await refreshAll(); showToast('Voice setting updated'); } catch (e) { el.checked = !el.checked; showToast(e.message); } }));
  list.querySelectorAll('.remove-voice').forEach((el) => el.addEventListener('click', async () => { if (!confirm('এই voice profile মুছে ফেলবেন?')) return; try { await api(`/api/admin/voices/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' }); await refreshAll(); showToast('Voice removed'); } catch (e) { showToast(e.message); } }));
}
async function loadKeys() {
  const data = await api('/api/admin/client-keys'); const list = $('#keys-list');
  if (!data.keys.length) { list.innerHTML = '<div class="empty-state">কোনো app access key নেই। “Create access key” দিয়ে একটি যোগ করুন।</div>'; return; }
  list.innerHTML = data.keys.map((key) => `<div class="list-row"><div class="row-icon">⌘</div><div class="row-main"><strong>${escapeHtml(key.label)}</strong><small>Created ${new Date(key.createdAt).toLocaleString()}${key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}` : ''}</small></div><div class="row-actions"><label class="toggle-label"><input class="toggle key-toggle" type="checkbox" data-id="${escapeHtml(key.id)}" ${key.active ? 'checked' : ''} aria-label="Enable ${escapeHtml(key.label)}"></label><button class="small-button danger remove-key" data-id="${escapeHtml(key.id)}">Revoke</button></div></div>`).join('');
  list.querySelectorAll('.key-toggle').forEach((el) => el.addEventListener('change', async () => { try { await api(`/api/admin/client-keys/${encodeURIComponent(el.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ active: el.checked }) }); await refreshAll(); } catch (e) { el.checked = !el.checked; showToast(e.message); } }));
  list.querySelectorAll('.remove-key').forEach((el) => el.addEventListener('click', async () => { if (!confirm('Access key revoke করে delete করবেন? Connected app sessions-ও বন্ধ হবে।')) return; try { await api(`/api/admin/client-keys/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' }); await refreshAll(); showToast('Access key revoked'); } catch (e) { showToast(e.message); } }));
}
async function loadSettings() {
  const data = await api('/api/admin/settings'); const form = $('#settings-form');
  form.elements.displayName.value = data.displayName; form.elements.telegramUrl.value = data.telegramUrl;
  form.elements.modelId.value = data.modelId; form.elements.language.value = data.language;
  const select = $('#default-voice'); select.innerHTML = '<option value="">No default</option>' + cachedVoices.filter(v => v.enabled).map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('');
  select.value = data.defaultVoiceId || '';
}
async function refreshAll() { await Promise.all([loadStatus(), loadVoices(), loadKeys()]); await loadSettings(); }
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#login-error').textContent = '';
  const form = new FormData(event.currentTarget);
  try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) }); await showApp(); }
  catch (e) { $('#login-error').textContent = e.message === 'invalid_credentials' ? 'Username অথবা password ভুল।' : e.message; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } finally { showLogin(); } });
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#refresh').addEventListener('click', async () => { try { await refreshAll(); showToast('Dashboard refreshed'); } catch (e) { showToast(e.message); } });
$('#check-cartesia').addEventListener('click', async () => {
  const button = $('#check-cartesia'); button.disabled = true; button.textContent = 'Checking…';
  $('#cartesia-badge').className = 'badge neutral'; $('#cartesia-badge').textContent = 'CHECKING';
  try { const data = await api('/api/admin/cartesia-check', { method: 'POST', body: '{}' }); $('#cartesia-result').textContent = 'Cartesia connection successful'; $('#cartesia-detail').textContent = `${data.voiceCountReturned} voice item returned · ${data.latencyMs} ms`; $('#cartesia-badge').className = 'badge ok'; $('#cartesia-badge').textContent = 'CONNECTED'; }
  catch (e) { $('#cartesia-result').textContent = 'Cartesia connection failed'; $('#cartesia-detail').textContent = e.message; $('#cartesia-badge').className = 'badge fail'; $('#cartesia-badge').textContent = 'FAILED'; }
  finally { button.disabled = false; button.innerHTML = 'Test connection <span>↗</span>'; }
});
$('#voice-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const values = new FormData(event.currentTarget);
  try { await api('/api/admin/voices', { method: 'POST', body: JSON.stringify({ name: values.get('name'), providerVoiceId: values.get('providerVoiceId') }) }); event.currentTarget.reset(); await refreshAll(); showToast('Voice profile added'); }
  catch (e) { showToast(e.message); }
});
$('#new-key').addEventListener('click', async () => {
  const label = prompt('এই access key-টির নাম লিখুন (যেমন: My Android phone):'); if (!label) return;
  try { const data = await api('/api/admin/client-keys', { method: 'POST', body: JSON.stringify({ label }) }); const result = $('#new-key-result'); result.classList.remove('hidden'); result.innerHTML = `<strong>Copy now — this key is shown once.</strong><br><code>${escapeHtml(data.accessKey)}</code><br><button class="small-button copy-key">Copy key</button>`; result.querySelector('.copy-key').addEventListener('click', async () => { await navigator.clipboard.writeText(data.accessKey); showToast('Key copied'); }); await refreshAll(); setView('keys'); }
  catch (e) { showToast(e.message); }
});
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget;
  const values = new FormData(form); const body = Object.fromEntries(['displayName','telegramUrl','modelId','language','defaultVoiceId'].map(key => [key, values.get(key)]));
  try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }); $('#settings-feedback').textContent = 'Saved'; showToast('App configuration saved'); }
  catch (e) { $('#settings-feedback').textContent = e.message; }
});
(async () => {
  try { await api('/api/admin/me'); await showApp(); }
  catch { showLogin(); }
})();
