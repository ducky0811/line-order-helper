const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MERCHANT_ID = process.env.MERCHANT_ID || 'default-store';

const DEFAULT_SETTINGS = {
  merchant_id: MERCHANT_ID,
  store_name: '接單小幫手',
  tagline: '想吃什麼，慢慢挑',
  description: '選好商品後直接送出訂單，店家確認後會通知您。',
  logo_url: '',
  hero_image_url: '',
  phone: '',
  address: '',
  business_hours: '',
  accepting_orders: true
};

function normalizeSettings(input = {}, existing = DEFAULT_SETTINGS) {
  const text = (value, fallback, max) => String(value ?? fallback ?? '').trim().slice(0, max);
  return {
    ...existing,
    merchant_id: MERCHANT_ID,
    store_name: text(input.store_name, existing.store_name, 80) || DEFAULT_SETTINGS.store_name,
    tagline: text(input.tagline, existing.tagline, 100),
    description: text(input.description, existing.description, 240),
    logo_url: text(input.logo_url, existing.logo_url, 1000),
    hero_image_url: text(input.hero_image_url, existing.hero_image_url, 1000),
    phone: text(input.phone, existing.phone, 40),
    address: text(input.address, existing.address, 180),
    business_hours: text(input.business_hours, existing.business_hours, 180),
    accepting_orders: input.accepting_orders == null ? existing.accepting_orders !== false : input.accepting_orders !== false,
    updated_at: new Date().toISOString()
  };
}

function normalizeProduct(input, existing = {}) {
  const price = Number(input.price);
  if (!String(input.name || '').trim()) throw new Error('商品名稱不能空白');
  if (!Number.isFinite(price) || price < 0) throw new Error('商品價格格式不正確');
  return {
    ...existing,
    id: existing.id || input.id || crypto.randomUUID(),
    merchant_id: MERCHANT_ID,
    name: String(input.name).trim(),
    price,
    description: String(input.description || '').trim(),
    image_url: String(input.image_url || input.image || '').trim(),
    active: input.active !== false,
    stock: input.stock === '' || input.stock == null ? null : Math.max(0, Number(input.stock)),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    updated_at: new Date().toISOString()
  };
}

class LocalStore {
  constructor(dataDir, seedProducts = []) {
    this.dataDir = dataDir;
    this.productsFile = path.join(dataDir, 'products.json');
    this.ordersFile = path.join(dataDir, 'orders.json');
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.seedProducts = seedProducts;
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
      }));
      await this.writeJson(this.productsFile, seeded);
    }
    try { await fs.access(this.ordersFile); } catch { await this.writeJson(this.ordersFile, []); }
    try { await fs.access(this.settingsFile); } catch { await this.writeJson(this.settingsFile, DEFAULT_SETTINGS); }
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
    const product = normalizeProduct(input);
    products.push(product);
    await this.writeJson(this.productsFile, products);
    return product;
  }

  async updateProduct(id, input) {
    const products = await this.listProducts();
    const index = products.findIndex(item => item.id === id);
    if (index < 0) throw new Error('找不到商品');
    products[index] = normalizeProduct({ ...products[index], ...input }, products[index]);
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
      merchant_id: MERCHANT_ID,
      line_user_id: input.line_user_id,
      customer_name: input.customer_name || '',
      phone: input.phone || '',
      fulfillment: input.fulfillment || 'pickup',
      pickup_time: input.pickup_time || '',
      note: input.note || '',
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

  async getSettings() {
    return normalizeSettings(await this.readJson(this.settingsFile));
  }

  async updateSettings(input) {
    const settings = normalizeSettings(input, await this.getSettings());
    await this.writeJson(this.settingsFile, settings);
    return settings;
  }
}

class SupabaseStore {
  constructor(url, key) {
    this.url = url.replace(/\/$/, '');
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
    return this.request(`products?merchant_id=eq.${encodeURIComponent(MERCHANT_ID)}${active}&order=sort_order.asc,name.asc`);
  }

  async createProduct(input) {
    const [product] = await this.request('products', {
      method: 'POST', body: JSON.stringify(normalizeProduct(input))
    });
    return product;
  }

  async updateProduct(id, input) {
    const current = (await this.request(`products?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(MERCHANT_ID)}`))[0];
    if (!current) throw new Error('找不到商品');
    const [product] = await this.request(`products?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(MERCHANT_ID)}`, {
      method: 'PATCH', body: JSON.stringify(normalizeProduct({ ...current, ...input }, current))
    });
    return product;
  }

  async deleteProduct(id) {
    await this.request(`products?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(MERCHANT_ID)}`, { method: 'DELETE' });
  }

  async createOrder(input) {
    const [order] = await this.request('orders', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(), merchant_id: MERCHANT_ID, line_user_id: input.line_user_id,
        customer_name: input.customer_name || '', phone: input.phone || '',
        fulfillment: input.fulfillment || 'pickup', pickup_time: input.pickup_time || '', note: input.note || '',
        items: input.items, summary: input.summary, total: Number(input.total), status: 'new'
      })
    });
    return order;
  }

  async listOrders() {
    return this.request(`orders?merchant_id=eq.${encodeURIComponent(MERCHANT_ID)}&order=created_at.desc&limit=200`);
  }

  async updateOrderStatus(id, status) {
    const [order] = await this.request(`orders?id=eq.${encodeURIComponent(id)}&merchant_id=eq.${encodeURIComponent(MERCHANT_ID)}`, {
      method: 'PATCH', body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    if (!order) throw new Error('找不到訂單');
    return order;
  }

  async getSettings() {
    const rows = await this.request(`store_settings?merchant_id=eq.${encodeURIComponent(MERCHANT_ID)}&limit=1`);
    return normalizeSettings(rows[0] || DEFAULT_SETTINGS);
  }

  async updateSettings(input) {
    const settings = normalizeSettings(input, await this.getSettings());
    const rows = await this.request('store_settings?on_conflict=merchant_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(settings)
    });
    return rows[0] || settings;
  }
}

function createStore(rootDir, seedProducts = []) {
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.SUPABASE_URL && supabaseKey) {
    console.log('☁️ 使用 Supabase 雲端商品與訂單資料庫');
    return new SupabaseStore(process.env.SUPABASE_URL, supabaseKey);
  }
  console.warn('⚠️ 未設定 Supabase，目前使用本機資料模式');
  return new LocalStore(path.join(rootDir, 'data'), seedProducts);
}

module.exports = { createStore, LocalStore, SupabaseStore, normalizeProduct, normalizeSettings, DEFAULT_SETTINGS };
