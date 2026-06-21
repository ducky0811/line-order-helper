const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const TRIAL_DAYS = 14;

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase().slice(0, 200); }
function hashPassword(password) {
  const value = String(password || '');
  if (value.length < 8) throw new Error('密碼至少需要 8 個字元');
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(value, salt, 32).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 32);
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}
function createMerchant({ slug, storeName, email, password }) {
  const merchantId = normalizeSlug(slug);
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(merchantId)) throw new Error('商店代碼需為 3–30 個英文字母、數字或連字號');
  const normalizedEmail = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('請輸入有效的 Email');
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86400000).toISOString();
  return {
    merchant: { id: merchantId, slug: merchantId, name: String(storeName || '').trim().slice(0, 80) || merchantId, plan: 'trial', subscription_status: 'trialing', trial_ends_at: trialEndsAt, expires_at: trialEndsAt, active: true, created_at: now.toISOString(), updated_at: now.toISOString() },
    user: { id: crypto.randomUUID(), merchant_id: merchantId, email: normalizedEmail, password_hash: hashPassword(password), role: 'owner', created_at: now.toISOString() }
  };
}
function canAcceptOrders(merchant) {
  if (!merchant || merchant.active === false || merchant.subscription_status === 'suspended') return false;
  if (merchant.plan === 'trial') return new Date(merchant.trial_ends_at).getTime() > Date.now();
  return !merchant.expires_at || new Date(merchant.expires_at).getTime() > Date.now();
}

class LocalTenantRegistry {
  constructor(rootDir) { this.file = path.join(rootDir, 'data', 'tenants.json'); }
  async init() { await fs.mkdir(path.dirname(this.file), { recursive: true }); try { await fs.access(this.file); } catch { await fs.writeFile(this.file, JSON.stringify({ merchants: [], users: [] }, null, 2)); } }
  async read() { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
  async write(data) { await fs.writeFile(this.file, JSON.stringify(data, null, 2)); }
  async register(input) { const data = await this.read(); const created = createMerchant(input); if (data.merchants.some(item => item.slug === created.merchant.slug)) throw new Error('這個商店代碼已被使用'); if (data.users.some(item => item.email === created.user.email)) throw new Error('這個 Email 已註冊'); data.merchants.push(created.merchant); data.users.push(created.user); await this.write(data); return created.merchant; }
  async authenticate(email, password) { const data = await this.read(); const user = data.users.find(item => item.email === normalizeEmail(email)); if (!user || !verifyPassword(password, user.password_hash)) return null; return { user, merchant: data.merchants.find(item => item.id === user.merchant_id) }; }
  async findBySlug(slug) { return (await this.read()).merchants.find(item => item.slug === normalizeSlug(slug)) || null; }
  async findById(id) { return (await this.read()).merchants.find(item => item.id === id) || null; }
}

class SupabaseTenantRegistry {
  constructor(url, key) { this.url = url.replace(/\/$/, ''); this.headers = { apikey: key, 'Content-Type': 'application/json' }; if (key.split('.').length === 3) this.headers.Authorization = `Bearer ${key}`; }
  async init() {}
  async request(pathname, options = {}) { const response = await fetch(`${this.url}/rest/v1/${pathname}`, { ...options, headers: { ...this.headers, Prefer: 'return=representation', ...options.headers } }); if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`); return response.status === 204 ? null : response.json(); }
  async register(input) { const created = createMerchant(input); if ((await this.findBySlug(created.merchant.slug))) throw new Error('這個商店代碼已被使用'); const existing = await this.request(`merchant_users?email=eq.${encodeURIComponent(created.user.email)}&limit=1`); if (existing.length) throw new Error('這個 Email 已註冊'); await this.request('merchants', { method: 'POST', body: JSON.stringify(created.merchant) }); try { await this.request('merchant_users', { method: 'POST', body: JSON.stringify(created.user) }); } catch (error) { await this.request(`merchants?id=eq.${encodeURIComponent(created.merchant.id)}`, { method: 'DELETE' }); throw error; } return created.merchant; }
  async authenticate(email, password) { const rows = await this.request(`merchant_users?email=eq.${encodeURIComponent(normalizeEmail(email))}&limit=1`); const user = rows[0]; if (!user || !verifyPassword(password, user.password_hash)) return null; return { user, merchant: await this.findById(user.merchant_id) }; }
  async findBySlug(slug) { const rows = await this.request(`merchants?slug=eq.${encodeURIComponent(normalizeSlug(slug))}&limit=1`); return rows[0] || null; }
  async findById(id) { const rows = await this.request(`merchants?id=eq.${encodeURIComponent(id)}&limit=1`); return rows[0] || null; }
}

function createTenantRegistry(rootDir) {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return process.env.SUPABASE_URL && key ? new SupabaseTenantRegistry(process.env.SUPABASE_URL, key) : new LocalTenantRegistry(rootDir);
}

module.exports = { createTenantRegistry, LocalTenantRegistry, SupabaseTenantRegistry, normalizeSlug, hashPassword, verifyPassword, canAcceptOrders, TRIAL_DAYS };
