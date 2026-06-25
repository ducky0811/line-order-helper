const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MERCHANT_ID = process.env.MERCHANT_ID || 'default-store';
const DEFAULT_CHECKOUT_FIELDS = {
  customer_name: { label: '取貨人姓名', enabled: true, required: true },
  phone: { label: '聯絡電話', enabled: true, required: true },
  pickup_time: { label: '希望取貨時間', enabled: true, required: false },
  note: { label: '備註', enabled: true, required: false }
};
const DEFAULT_FULFILLMENT_OPTIONS = [
  { id: 'pickup', label: '到店取貨', enabled: true },
  { id: 'delivery', label: '外送', enabled: true }
];

function createClaimCode() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

const DEFAULT_SETTINGS = {
  merchant_id: DEFAULT_MERCHANT_ID,
  store_name: '接單小幫手',
  tagline: '想吃什麼，慢慢挑',
  description: '選好商品後直接送出訂單，店家確認後會通知您。',
  logo_url: '',
  hero_image_url: '',
  phone: '',
  address: '',
  business_hours: '',
  accepting_orders: true,
  merchant_line_user_id: '',
  cash_enabled: true,
  bank_transfer_enabled: true,
  bank_name: '',
  bank_code: '',
  bank_account: '',
  bank_account_name: '',
  payment_instructions: '',
  checkout_fields: DEFAULT_CHECKOUT_FIELDS,
  fulfillment_options: DEFAULT_FULFILLMENT_OPTIONS
};

function normalizeCheckoutFields(input, existing = DEFAULT_CHECKOUT_FIELDS) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : existing;
  return Object.fromEntries(Object.entries(DEFAULT_CHECKOUT_FIELDS).map(([key, defaults]) => {
    const current = source?.[key] || existing?.[key] || defaults;
    const label = String(current.label || defaults.label).trim().slice(0, 40) || defaults.label;
    const enabled = current.enabled !== false;
    return [key, { label, enabled, required: enabled && current.required === true }];
  }));
}

function normalizeFulfillmentOptions(input, existing = DEFAULT_FULFILLMENT_OPTIONS) {
  const source = Array.isArray(input) ? input : (Array.isArray(existing) ? existing : DEFAULT_FULFILLMENT_OPTIONS);
  const used = new Set();
  const options = source.slice(0, 12).map((item, index) => {
    const fallbackId = `method_${index + 1}`;
    let id = String(item?.id || fallbackId).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || fallbackId;
    while (used.has(id)) id = `${id}_${index + 1}`.slice(0, 40);
    used.add(id);
    return { id, label: String(item?.label || '').trim().slice(0, 40), enabled: item?.enabled !== false };
  }).filter(item => item.label);
  if (!options.length) return DEFAULT_FULFILLMENT_OPTIONS.map(item => ({ ...item }));
  if (!options.some(item => item.enabled)) options[0].enabled = true;
  return options;
}

function normalizeSettings(input = {}, existing = DEFAULT_SETTINGS, merchantId = DEFAULT_MERCHANT_ID) {
  const text = (value, fallback, max) => String(value ?? fallback ?? '').trim().slice(0, max);
  return {
    ...existing,
    merchant_id: merchantId,
    store_name: text(input.store_name, existing.store_name, 80) || DEFAULT_SETTINGS.store_name,
    tagline: text(input.tagline, existing.tagline, 100),
    description: text(input.description, existing.description, 240),
    logo_url: text(input.logo_url, existing.logo_url, 1000),
    hero_image_url: text(input.hero_image_url, existing.hero_image_url, 1000),
    phone: text(input.phone, existing.phone, 40),
    address: text(input.address, existing.address, 180),
    business_hours: text(input.business_hours, existing.business_hours, 180),
    accepting_orders: input.accepting_orders == null ? existing.accepting_orders !== false : input.accepting_orders !== false,
    merchant_line_user_id: text(input.merchant_line_user_id, existing.merchant_line_user_id, 100),
    cash_enabled: input.cash_enabled == null ? existing.cash_enabled !== false : input.cash_enabled !== false,
    bank_transfer_enabled: input.bank_transfer_enabled == null ? existing.bank_transfer_enabled !== false : input.bank_transfer_enabled !== false,
    bank_name: text(input.bank_name, existing.bank_name, 80),
    bank_code: text(input.bank_code, existing.bank_code, 20),
    bank_account: text(input.bank_account, existing.bank_account, 60),
    bank_account_name: text(input.bank_account_name, existing.bank_account_name, 80),
    payment_instructions: text(input.payment_instructions, existing.payment_instructions, 300),
    checkout_fields: normalizeCheckoutFields(input.checkout_fields, existing.checkout_fields),
    fulfillment_options: normalizeFulfillmentOptions(input.fulfillment_options, existing.fulfillment_options),
    updated_at: new Date().toISOString()
  };
}

function normalizeProduct(input, existing = {}, merchantId = DEFAULT_MERCHANT_ID) {
  const price = Number(input.price);
  const productType = input.product_type === 'quote' ? 'quote' : 'fixed';
  if (!String(input.name || '').trim()) throw new Error('商品名稱不能空白');
  if (productType === 'fixed' && (!Number.isFinite(price) || price < 0)) throw new Error('商品價格格式不正確');
  return {
    ...existing,
    id: existing.id || input.id || crypto.randomUUID(),
    merchant_id: merchantId,
    name: String(input.name).trim(),
    price: productType === 'quote' ? 0 : price,
    product_type: productType,
    quote_prompt: String(input.quote_prompt || '').trim().slice(0, 240),
    fulfillment_ids: Array.isArray(input.fulfillment_ids) ? input.fulfillment_ids.map(value => String(value).trim()).filter(Boolean).slice(0, 12) : (Array.isArray(existing.fulfillment_ids) ? existing.fulfillment_ids : []),
    description: String(input.description || '').trim(),
    image_url: String(input.image_url || input.image || '').trim(),
    active: input.active !== false,
    stock: input.stock === '' || input.stock == null ? null : Math.max(0, Number(input.stock)),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    updated_at: new Date().toISOString()
  };
}

class LocalStore {
  constructor(dataDir, seedProducts = [], merchantId = DEFAULT_MERCHANT_ID) {
    this.dataDir = dataDir;
    this.productsFile = path.join(dataDir, 'products.json');
    this.ordersFile = path.join(dataDir, 'orders.json');
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.seedProducts = seedProducts;
    this.merchantId = merchantId;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      await fs.access(this.productsFile);
    } catch {
      const seeded = this.seedProducts.map((item, index) => normalizeProduct({
        ...item,
        image_url: item.image,
        sort_order: index
      }, {}, this.merchantId));
      await this.writeJson(this.productsFile, seeded);
    }
    try { await fs.access(this.ordersFile); } catch { await this.writeJson(this.ordersFile, []); }
    try { await fs.access(this.settingsFile); } catch { await this.writeJson(this.settingsFile, { ...DEFAULT_SETTINGS, merchant_id: this.merchantId }); }
  }

  async readJson(file) {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }

  async writeJson(file, value) {
    this.writeQueue = this.writeQueue.then(async () => {
      const temp = `${file}.tmp`;
      await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
      await fs.rename(temp, file);
    });
    return this.writeQueue;
  }

  async listProducts({ activeOnly = false } = {}) {
    const products = await this.readJson(this.productsFile);
    return products
      .filter(item => !activeOnly || item.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  async createProduct(input) {
    const products = await this.listProducts();
    const product = normalizeProduct(input, {}, this.merchantId);
    products.push(product);
    await this.writeJson(this.productsFile, products);
    return product;
  }

  async updateProduct(id, input) {
    const products = await this.listProducts();
    const index = products.findIndex(item => item.id === id);
    if (index < 0) throw new Error('找不到商品');
    products[index] = normalizeProduct({ ...products[index], ...input }, products[index], this.merchantId);
    await this.writeJson(this.productsFile, products);
    return products[index];
  }

  async deleteProduct(id) {
    const products = await this.listProducts();
    const next = products.filter(item => item.id !== id);
    if (next.length === products.length) throw new Error('找不到商品');
    await this.writeJson(this.productsFile, next);
  }

  async createOrder(input) {
    const orders = await this.readJson(this.ordersFile);
    const order = {
      id: crypto.randomUUID(),
      merchant_id: this.merchantId,
      line_user_id: input.line_user_id,
      claim_code: createClaimCode(),
      claimed_at: input.line_user_id ? new Date().toISOString() : null,
      customer_name: input.customer_name || '',
      phone: input.phone || '',
      fulfillment: input.fulfillment || 'pickup',
      pickup_time: input.pickup_time || '',
      note: input.note || '',
      payment_method: input.payment_method || 'cash',
      payment_status: 'unpaid',
      quote_status: input.quote_status || 'none',
      quote_request: input.quote_request || '',
      quote_amount: input.quote_amount == null ? null : Number(input.quote_amount),
      quote_note: input.quote_note || '',
      quoted_at: input.quoted_at || null,
      transfer_last5: '',
      paid_at: null,
      items: input.items,
      summary: input.summary,
      total: Number(input.total),
      status: 'new',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    orders.unshift(order);
    await this.writeJson(this.ordersFile, orders);
    return order;
  }

  async listOrders() {
    return this.readJson(this.ordersFile);
  }

  async purgeOrdersBefore(cutoff) {
    if (!cutoff) return 0;
    const orders = await this.readJson(this.ordersFile);
    const kept = orders.filter(item => new Date(item.created_at).getTime() >= new Date(cutoff).getTime());
    if (kept.length !== orders.length) await this.writeJson(this.ordersFile, kept);
    return orders.length - kept.length;
  }

  async updateOrderStatus(id, status) {
    const allowed = ['new', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!allowed.includes(status)) throw new Error('訂單狀態不正確');
    const orders = await this.listOrders();
    const order = orders.find(item => item.id === id);
    if (!order) throw new Error('找不到訂單');
    order.status = status;
    order.updated_at = new Date().toISOString();
    await this.writeJson(this.ordersFile, orders);
    return order;
  }

  async findOrderByClaimCode(code) {
    return (await this.listOrders()).find(item => item.claim_code === String(code || '').trim().toUpperCase()) || null;
  }

  async claimOrder(code, lineUserId) {
    const orders = await this.listOrders();
    const order = orders.find(item => item.claim_code === String(code || '').trim().toUpperCase());
    if (!order) throw new Error('找不到這筆訂單，請確認訂單碼');
    if (order.line_user_id && order.line_user_id !== lineUserId) throw new Error('這筆訂單已由其他 LINE 帳號確認');
    order.line_user_id = lineUserId;
    order.claimed_at = order.claimed_at || new Date().toISOString();
    order.updated_at = new Date().toISOString();
    await this.writeJson(this.ordersFile, orders);
    return order;
  }

  async submitTransferLast5(code, last5) {
    const orders = await this.listOrders();
    const order = orders.find(item => item.claim_code === String(code || '').trim().toUpperCase());
    if (!order) throw new Error('找不到這筆訂單');
    if (order.payment_method !== 'bank_transfer') throw new Error('這筆訂單不是銀行轉帳');
    order.transfer_last5 = String(last5 || '').trim();
    order.payment_status = 'pending';
    order.updated_at = new Date().toISOString();
    await this.writeJson(this.ordersFile, orders);
    return order;
  }

  async updatePaymentStatus(id, status) {
    const allowed = ['unpaid', 'pending', 'paid', 'refunded'];
    if (!allowed.includes(status)) throw new Error('付款狀態不正確');
    const orders = await this.listOrders();
    const order = orders.find(item => item.id === id);
    if (!order) throw new Error('找不到訂單');
    order.payment_status = status;
    order.paid_at = status === 'paid' ? new Date().toISOString() : order.paid_at;
    order.updated_at = new Date().toISOString();
    await this.writeJson(this.ordersFile, orders);
    return order;
  }

  async updateOrderQuote(id, input = {}) {
    const amount = Number(input.quote_amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('報價金額格式不正確');
    const orders = await this.listOrders();
    const order = orders.find(item => item.id === id);
    if (!order) throw new Error('找不到訂單');
    order.quote_status = 'quoted';
    order.quote_amount = amount;
    order.quote_note = String(input.quote_note || '').trim().slice(0, 300);
    order.total = amount;
    order.quoted_at = new Date().toISOString();
    order.updated_at = new Date().toISOString();
    await this.writeJson(this.ordersFile, orders);
    return order;
  }

  async getSettings() {
    return normalizeSettings(await this.readJson(this.settingsFile), DEFAULT_SETTINGS, this.merchantId);
  }

  async updateSettings(input) {
    const settings = normalizeSettings(input, await this.getSettings(), this.merchantId);
    await this.writeJson(this.settingsFile, settings);
    return settings;
  }
}

class SupabaseStore {
  constructor(url, key, merchantId = DEFAULT_MERCHANT_ID) {
    this.url = url.replace(/\/$/, '');
    this.merchantId = merchantId;
    this.headers = {
      apikey: key,
      'Content-Type': 'application/json'
    };
    // 舊版 service_role 是 JWT；新版 sb_secret 金鑰只需要 apikey 標頭。
    if (key.split('.').length === 3) this.headers.Authorization = `Bearer ${key}`;
  }

  async request(pathname, options = {}) {
    const response = await fetch(`${this.url}/rest/v1/${pathname}`, {
      ...options,
      headers: { ...this.headers, Prefer: 'return=representation', ...options.headers }
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
    if (response.status === 204) return null;
    return response.json();
  }

  async init() {}

  async listProducts({ activeOnly = false } = {}) {
    const active = activeOnly ? '&active=eq.true' : '';
    return this.request(`products?merchant_id=eq.${encodeURIComponent(this.merchantId)}${active}&order=sort_order.asc,name.asc`);
  }

  async createProduct(input) {
    const [product] = await this.request('products', {
      method: 'POST', body: JSON.stringify(normalizeProduct(input, {}, this.merchantId))
    });
    return product;
  }

  async updateProduct(id, input) {
    const current = (await this.request(`products?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`))[0];
    if (!current) throw new Error('找不到商品');
    const [product] = await this.request(`products?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`, {
      method: 'PATCH', body: JSON.stringify(normalizeProduct({ ...current, ...input }, current, this.merchantId))
    });
    return product;
  }

  async deleteProduct(id) {
    await this.request(`products?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`, { method: 'DELETE' });
  }

  async createOrder(input) {
    const [order] = await this.request('orders', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(), merchant_id: this.merchantId, line_user_id: input.line_user_id,
        claim_code: createClaimCode(), claimed_at: input.line_user_id ? new Date().toISOString() : null,
        customer_name: input.customer_name || '', phone: input.phone || '',
        fulfillment: input.fulfillment || 'pickup', pickup_time: input.pickup_time || '', note: input.note || '',
        payment_method: input.payment_method || 'cash', payment_status: 'unpaid',
        quote_status: input.quote_status || 'none', quote_request: input.quote_request || '', quote_amount: input.quote_amount == null ? null : Number(input.quote_amount), quote_note: input.quote_note || '', quoted_at: input.quoted_at || null,
        transfer_last5: '', paid_at: null,
        items: input.items, summary: input.summary, total: Number(input.total), status: 'new'
      })
    });
    return order;
  }

  async listOrders() {
    return this.request(`orders?merchant_id=eq.${encodeURIComponent(this.merchantId)}&order=created_at.desc&limit=1000`);
  }

  async purgeOrdersBefore(cutoff) {
    if (!cutoff) return 0;
    const rows = await this.request(`orders?merchant_id=eq.${encodeURIComponent(this.merchantId)}&created_at=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE' });
    return rows?.length || 0;
  }

  async updateOrderStatus(id, status) {
    const [order] = await this.request(`orders?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`, {
      method: 'PATCH', body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    if (!order) throw new Error('找不到訂單');
    return order;
  }

  async findOrderByClaimCode(code) {
    const rows = await this.request(`orders?merchant_id=eq.${encodeURIComponent(this.merchantId)}&claim_code=eq.${encodeURIComponent(String(code || '').trim().toUpperCase())}&limit=1`);
    return rows[0] || null;
  }

  async claimOrder(code, lineUserId) {
    const order = await this.findOrderByClaimCode(code);
    if (!order) throw new Error('找不到這筆訂單，請確認訂單碼');
    if (order.line_user_id && order.line_user_id !== lineUserId) throw new Error('這筆訂單已由其他 LINE 帳號確認');
    const rows = await this.request(`orders?id=eq.${encodeURIComponent(order.id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ line_user_id: lineUserId, claimed_at: order.claimed_at || new Date().toISOString(), updated_at: new Date().toISOString() })
    });
    return rows[0] || { ...order, line_user_id: lineUserId };
  }

  async submitTransferLast5(code, last5) {
    const order = await this.findOrderByClaimCode(code);
    if (!order) throw new Error('找不到這筆訂單');
    if (order.payment_method !== 'bank_transfer') throw new Error('這筆訂單不是銀行轉帳');
    const rows = await this.request(`orders?id=eq.${encodeURIComponent(order.id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ transfer_last5: String(last5 || '').trim(), payment_status: 'pending', updated_at: new Date().toISOString() })
    });
    return rows[0] || { ...order, transfer_last5: last5, payment_status: 'pending' };
  }

  async updatePaymentStatus(id, status) {
    const allowed = ['unpaid', 'pending', 'paid', 'refunded'];
    if (!allowed.includes(status)) throw new Error('付款狀態不正確');
    const rows = await this.request(`orders?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ payment_status: status, paid_at: status === 'paid' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    });
    if (!rows[0]) throw new Error('找不到訂單');
    return rows[0];
  }

  async updateOrderQuote(id, input = {}) {
    const amount = Number(input.quote_amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('報價金額格式不正確');
    const rows = await this.request(`orders?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(this.merchantId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ quote_status: 'quoted', quote_amount: amount, quote_note: String(input.quote_note || '').trim().slice(0, 300), total: amount, quoted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    });
    if (!rows[0]) throw new Error('找不到訂單');
    return rows[0];
  }

  async getSettings() {
    const rows = await this.request(`store_settings?merchant_id=eq.${encodeURIComponent(this.merchantId)}&limit=1`);
    return normalizeSettings(rows[0] || DEFAULT_SETTINGS, DEFAULT_SETTINGS, this.merchantId);
  }

  async updateSettings(input) {
    const settings = normalizeSettings(input, await this.getSettings(), this.merchantId);
    const rows = await this.request('store_settings?on_conflict=merchant_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(settings)
    });
    return rows[0] || settings;
  }
}

function createStore(rootDir, seedProducts = [], merchantId = DEFAULT_MERCHANT_ID) {
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.SUPABASE_URL && supabaseKey) {
    console.log('☁️ 使用 Supabase 雲端商品與訂單資料庫');
    return new SupabaseStore(process.env.SUPABASE_URL, supabaseKey, merchantId);
  }
  console.warn('⚠️ 未設定 Supabase，目前使用本機資料模式');
  const directory = merchantId === DEFAULT_MERCHANT_ID ? path.join(rootDir, 'data') : path.join(rootDir, 'data', 'merchants', merchantId);
  return new LocalStore(directory, seedProducts, merchantId);
}

module.exports = { createStore, LocalStore, SupabaseStore, normalizeProduct, normalizeSettings, DEFAULT_SETTINGS, DEFAULT_CHECKOUT_FIELDS, DEFAULT_FULFILLMENT_OPTIONS, DEFAULT_MERCHANT_ID };
