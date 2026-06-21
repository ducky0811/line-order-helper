const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function encryptionKey() {
  const source = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!source) throw new Error('尚未設定 CREDENTIAL_ENCRYPTION_KEY 或 SESSION_SECRET');
  return crypto.createHash('sha256').update(source).digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
function decrypt(value) {
  const [iv, tag, encrypted] = String(value || '').split('.');
  if (!iv || !tag || !encrypted) throw new Error('LINE 憑證格式錯誤，請重新儲存設定');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
function sanitizeOfficialId(value) { const id = String(value || '').trim().replace(/[^@a-zA-Z0-9._-]/g, '').slice(0, 80); return id; }
function publicIntegration(row, baseUrl = '') {
  if (!row) return { enabled: false, configured: false, official_account_id: '', bind_code: '', webhook_url: '' };
  return { enabled: row.enabled === true, configured: Boolean(row.channel_access_token_encrypted && row.channel_secret_encrypted && row.official_account_id), official_account_id: row.official_account_id || '', bind_code: row.bind_code || '', webhook_url: baseUrl ? `${baseUrl.replace(/\/$/, '')}/webhook/${encodeURIComponent(row.merchant_id)}` : `/webhook/${encodeURIComponent(row.merchant_id)}`, updated_at: row.updated_at };
}
function prepareIntegration(merchantId, input, existing = {}) {
  const accessToken = String(input.channel_access_token || '').trim();
  const channelSecret = String(input.channel_secret || '').trim();
  const officialId = sanitizeOfficialId(input.official_account_id ?? existing.official_account_id);
  const row = {
    ...existing,
    merchant_id: merchantId,
    enabled: input.enabled === true,
    official_account_id: officialId,
    channel_access_token_encrypted: accessToken ? encrypt(accessToken) : existing.channel_access_token_encrypted || '',
    channel_secret_encrypted: channelSecret ? encrypt(channelSecret) : existing.channel_secret_encrypted || '',
    bind_code: existing.bind_code || String(crypto.randomInt(100000, 1000000)),
    updated_at: new Date().toISOString()
  };
  if (row.enabled && (!row.official_account_id || !row.channel_access_token_encrypted || !row.channel_secret_encrypted)) throw new Error('啟用 LINE 前，請填寫官方帳號 ID、Channel Access Token 與 Channel Secret');
  if (row.enabled && !row.official_account_id.startsWith('@')) throw new Error('LINE 官方帳號 ID 必須以 @ 開頭');
  return row;
}
function credentials(row) {
  if (!row?.enabled) return null;
  return { channelAccessToken: decrypt(row.channel_access_token_encrypted), channelSecret: decrypt(row.channel_secret_encrypted), officialAccountId: row.official_account_id, merchantBindCode: row.bind_code };
}

class LocalLineIntegrationStore {
  constructor(rootDir) { this.file = path.join(rootDir, 'data', 'line-integrations.json'); }
  async init() { await fs.mkdir(path.dirname(this.file), { recursive: true }); try { await fs.access(this.file); } catch { await fs.writeFile(this.file, '[]'); } }
  async rows() { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
  async get(merchantId) { return (await this.rows()).find(item => item.merchant_id === merchantId) || null; }
  async save(merchantId, input) { const rows = await this.rows(); const index = rows.findIndex(item => item.merchant_id === merchantId); const row = prepareIntegration(merchantId, input, index >= 0 ? rows[index] : {}); if (index >= 0) rows[index] = row; else rows.push(row); await fs.writeFile(this.file, JSON.stringify(rows, null, 2)); return row; }
}
class SupabaseLineIntegrationStore {
  constructor(url, key) { this.url = url.replace(/\/$/, ''); this.headers = { apikey: key, 'Content-Type': 'application/json' }; if (key.split('.').length === 3) this.headers.Authorization = `Bearer ${key}`; }
  async init() {}
  async request(pathname, options = {}) { const response = await fetch(`${this.url}/rest/v1/${pathname}`, { ...options, headers: { ...this.headers, Prefer: 'return=representation', ...options.headers } }); if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`); return response.status === 204 ? null : response.json(); }
  async get(merchantId) { const rows = await this.request(`merchant_line_integrations?merchant_id=eq.${encodeURIComponent(merchantId)}&limit=1`); return rows[0] || null; }
  async save(merchantId, input) { const row = prepareIntegration(merchantId, input, await this.get(merchantId) || {}); const rows = await this.request('merchant_line_integrations?on_conflict=merchant_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) }); return rows[0] || row; }
}
function createLineIntegrationStore(rootDir) {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return process.env.SUPABASE_URL && key ? new SupabaseLineIntegrationStore(process.env.SUPABASE_URL, key) : new LocalLineIntegrationStore(rootDir);
}

module.exports = { createLineIntegrationStore, LocalLineIntegrationStore, SupabaseLineIntegrationStore, encrypt, decrypt, prepareIntegration, publicIntegration, credentials };
