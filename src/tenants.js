const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const TRIAL_DAYS = 14;
const PLAN_FEATURES = {
  trial: { line: true, sheets: false, reports: true, retention_days: 30, label: '免費試用' },
  basic: { line: false, sheets: false, reports: false, retention_days: 365, label: '基本版' },
  pro: { line: true, sheets: false, reports: true, retention_days: 1095, label: '專業版' }
};

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
function planCapabilities(merchant) {
  const plan = PLAN_FEATURES[merchant?.plan] ? merchant.plan : 'basic';
  return { plan, ...PLAN_FEATURES[plan] };
}
function hasPlanFeature(merchant, feature) { return Boolean(planCapabilities(merchant)[feature]); }
function retentionPolicy(merchant, now = new Date()) {
  const capabilities = planCapabilities(merchant);
  const expiresAt = new Date(merchant?.expires_at || merchant?.trial_ends_at || 0);
  const validExpiry = Number.isFinite(expiresAt.getTime());
  const graceDeleteAt = validExpiry ? new Date(expiresAt.getTime() + 30 * 86400000) : null;
  const expiredBeyondGrace = graceDeleteAt && graceDeleteAt.getTime() <= now.getTime();
  const activeCutoff = merchant?.plan === 'trial' ? null : new Date(now.getTime() - capabilities.retention_days * 86400000);
  return { retention_days: capabilities.retention_days, expires_at: validExpiry ? expiresAt.toISOString() : null, delete_at: graceDeleteAt?.toISOString() || null, purge_before: expiredBeyondGrace ? now.toISOString() : activeCutoff?.toISOString() || null };
}
function subscriptionUpdate(merchant, input = {}, now = new Date()) {
  if (!input.plan && typeof input.suspended === 'boolean') return { subscription_status: input.suspended ? 'suspended' : merchant.plan === 'trial' ? 'trialing' : 'active', active: !input.suspended, updated_at: now.toISOString() };
  const plan = ['trial', 'basic', 'pro'].includes(input.plan) ? input.plan : merchant.plan;
  const months = Math.min(24, Math.max(1, Number(input.months) || 1));
  const currentExpiry = new Date(merchant.expires_at || merchant.trial_ends_at || 0);
  const base = input.extend !== false && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  const expiresAt = new Date(base);
  if (plan === 'trial') expiresAt.setDate(expiresAt.getDate() + 14);
  else expiresAt.setMonth(expiresAt.getMonth() + months);
  return { plan, subscription_status: input.suspended === true ? 'suspended' : plan === 'trial' ? 'trialing' : 'active', active: input.suspended !== true, expires_at: expiresAt.toISOString(), trial_ends_at: plan === 'trial' ? expiresAt.toISOString() : merchant.trial_ends_at, updated_at: now.toISOString() };
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
  async listMerchants() { return (await this.read()).merchants; }
  async listMerchantSummaries() { const data = await this.read(); return data.merchants.map(merchant => ({ ...merchant, email: data.users.find(user => user.merchant_id === merchant.id)?.email || '' })); }
  async updateSubscription(id, input) { const data = await this.read(); const index = data.merchants.findIndex(item => item.id === id); if (index < 0) throw new Error('找不到店家'); data.merchants[index] = { ...data.merchants[index], ...subscriptionUpdate(data.merchants[index], input) }; await this.write(data); return data.merchants[index]; }
}

class SupabaseTenantRegistry {
  constructor(url, key) { this.url = url.replace(/\/$/, ''); this.headers = { apikey: key, 'Content-Type': 'application/json' }; if (key.split('.').length === 3) this.headers.Authorization = `Bearer ${key}`; }
  async init() {}
  async request(pathname, options = {}) { const response = await fetch(`${this.url}/rest/v1/${pathname}`, { ...options, headers: { ...this.headers, Prefer: 'return=representation', ...options.headers } }); if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`); return response.status === 204 ? null : response.json(); }
  async register(input) { const created = createMerchant(input); if ((await this.findBySlug(created.merchant.slug))) throw new Error('這個商店代碼已被使用'); const existing = await this.request(`merchant_users?email=eq.${encodeURIComponent(created.user.email)}&limit=1`); if (existing.length) throw new Error('這個 Email 已註冊'); await this.request('merchants', { method: 'POST', body: JSON.stringify(created.merchant) }); try { await this.request('merchant_users', { method: 'POST', body: JSON.stringify(created.user) }); } catch (error) { await this.request(`merchants?id=eq.${encodeURIComponent(created.merchant.id)}`, { method: 'DELETE' }); throw error; } return created.merchant; }
  async authenticate(email, password) { const rows = await this.request(`merchant_users?email=eq.${encodeURIComponent(normalizeEmail(email))}&limit=1`); const user = rows[0]; if (!user || !verifyPassword(password, user.password_hash)) return null; return { user, merchant: await this.findById(user.merchant_id) }; }
  async findBySlug(slug) { const rows = await this.request(`merchants?slug=eq.${encodeURIComponent(normalizeSlug(slug))}&limit=1`); return rows[0] || null; }
  async findById(id) { const rows = await this.request(`merchants?id=eq.${encodeURIComponent(id)}&limit=1`); return rows[0] || null; }
  async listMerchants() { return this.request('merchants?select=*&order=created_at.asc'); }
  async listMerchantSummaries() { const [merchants, users] = await Promise.all([this.listMerchants(), this.request('merchant_users?select=merchant_id,email,role')]); return merchants.map(merchant => ({ ...merchant, email: users.find(user => user.merchant_id === merchant.id && user.role === 'owner')?.email || users.find(user => user.merchant_id === merchant.id)?.email || '' })); }
  async updateSubscription(id, input) { const merchant = await this.findById(id); if (!merchant) throw new Error('找不到店家'); const rows = await this.request(`merchants?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(subscriptionUpdate(merchant, input)) }); return rows[0]; }
}

function createTenantRegistry(rootDir) {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return process.env.SUPABASE_URL && key ? new SupabaseTenantRegistry(process.env.SUPABASE_URL, key) : new LocalTenantRegistry(rootDir);
}

module.exports = { createTenantRegistry, LocalTenantRegistry, SupabaseTenantRegistry, normalizeSlug, hashPassword, verifyPassword, canAcceptOrders, planCapabilities, hasPlanFeature, retentionPolicy, subscriptionUpdate, PLAN_FEATURES, TRIAL_DAYS };
