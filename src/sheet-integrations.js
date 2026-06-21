const fs = require('fs/promises');
const path = require('path');

function spreadsheetId(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return (match?.[1] || raw).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 200);
}
function prepareSheetIntegration(merchantId, input = {}, existing = {}) {
  const id = spreadsheetId(input.spreadsheet_url ?? input.spreadsheet_id ?? existing.spreadsheet_id);
  const sheetName = String(input.sheet_name ?? existing.sheet_name ?? '訂單').trim().replace(/[\[\]*?:\\/]/g, '').slice(0, 80) || '訂單';
  const row = { ...existing, merchant_id: merchantId, enabled: input.enabled === true, spreadsheet_id: id, sheet_name: sheetName, updated_at: new Date().toISOString() };
  if (row.enabled && !row.spreadsheet_id) throw new Error('請貼上 Google 試算表網址');
  return row;
}
function publicSheetIntegration(row, serviceAccountEmail = '') {
  return { enabled: row?.enabled === true, configured: Boolean(row?.spreadsheet_id), spreadsheet_id: row?.spreadsheet_id || '', spreadsheet_url: row?.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${row.spreadsheet_id}/edit` : '', sheet_name: row?.sheet_name || '訂單', service_account_email: serviceAccountEmail, updated_at: row?.updated_at || null };
}
class LocalSheetIntegrationStore {
  constructor(rootDir) { this.file = path.join(rootDir, 'data', 'sheet-integrations.json'); }
  async init() { await fs.mkdir(path.dirname(this.file), { recursive: true }); try { await fs.access(this.file); } catch { await fs.writeFile(this.file, '[]'); } }
  async rows() { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
  async get(merchantId) { return (await this.rows()).find(item => item.merchant_id === merchantId) || null; }
  async save(merchantId, input) { const rows = await this.rows(); const index = rows.findIndex(item => item.merchant_id === merchantId); const row = prepareSheetIntegration(merchantId, input, index >= 0 ? rows[index] : {}); if (index >= 0) rows[index] = row; else rows.push(row); await fs.writeFile(this.file, JSON.stringify(rows, null, 2)); return row; }
}
class SupabaseSheetIntegrationStore {
  constructor(url, key) { this.url = url.replace(/\/$/, ''); this.headers = { apikey: key, 'Content-Type': 'application/json' }; if (key.split('.').length === 3) this.headers.Authorization = `Bearer ${key}`; }
  async init() {}
  async request(pathname, options = {}) { const response = await fetch(`${this.url}/rest/v1/${pathname}`, { ...options, headers: { ...this.headers, Prefer: 'return=representation', ...options.headers } }); if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`); return response.status === 204 ? null : response.json(); }
  async get(merchantId) { const rows = await this.request(`merchant_sheet_integrations?merchant_id=eq.${encodeURIComponent(merchantId)}&limit=1`); return rows[0] || null; }
  async save(merchantId, input) { const row = prepareSheetIntegration(merchantId, input, await this.get(merchantId) || {}); const rows = await this.request('merchant_sheet_integrations?on_conflict=merchant_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) }); return rows[0] || row; }
}
function createSheetIntegrationStore(rootDir) { const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; return process.env.SUPABASE_URL && key ? new SupabaseSheetIntegrationStore(process.env.SUPABASE_URL, key) : new LocalSheetIntegrationStore(rootDir); }

module.exports = { createSheetIntegrationStore, LocalSheetIntegrationStore, SupabaseSheetIntegrationStore, prepareSheetIntegration, publicSheetIntegration, spreadsheetId };
