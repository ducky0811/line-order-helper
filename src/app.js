const express = require('express');
const path = require('path');
const fs = require('fs');
const { createStore, DEFAULT_MERCHANT_ID } = require('./store');
const { createAuth } = require('./auth');
const { createSheetsService } = require('./sheets');
const { createBot } = require('./bot');
const { buildOrder } = require('./orders');
const { createImageService } = require('./images');
const { createLineIdentityService } = require('./line-identity');
const { createTenantRegistry, normalizeSlug, canAcceptOrders } = require('./tenants');

function createLineConfirmUrl(order, rawId) {
  const officialId = String(rawId || '').trim().replace(/[^@a-zA-Z0-9._-]/g, '');
  if (!officialId || !order.claim_code) return '';
  const message = encodeURIComponent(`確認訂單 ${order.claim_code}`);
  return `https://line.me/R/oaMessage/${encodeURIComponent(officialId)}/?${message}`;
}

function getPlatformSalesUrl() {
  const value = String(process.env.PLATFORM_SALES_URL || '/admin/').trim();
  return value.startsWith('/') || /^https:\/\//i.test(value) ? value : '/admin/';
}

async function createApp(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const app = express();
  const seedProducts = JSON.parse(fs.readFileSync(path.join(rootDir, 'menu.json'), 'utf8'));
  const store = options.store || createStore(rootDir, seedProducts, DEFAULT_MERCHANT_ID);
  await store.init();
  const tenantRegistry = options.tenantRegistry || createTenantRegistry(rootDir);
  await tenantRegistry.init();
  const stores = new Map([[DEFAULT_MERCHANT_ID, store]]);
  async function getStore(merchantId) {
    const id = normalizeSlug(merchantId) || DEFAULT_MERCHANT_ID;
    if (!stores.has(id)) {
      const tenantStore = createStore(rootDir, [], id);
      await tenantStore.init();
      stores.set(id, tenantStore);
    }
    return stores.get(id);
  }
  const sheets = options.sheets || createSheetsService();
  const bot = options.bot || createBot({ store, sheets });
  const auth = options.auth || createAuth();
  const images = options.images || createImageService();
  const lineIdentity = options.lineIdentity || createLineIdentityService();


  app.post('/webhook', bot.middleware, async (req, res) => {
    try {
      const results = await Promise.all(req.body.events.map(bot.handleEvent));
      res.json(results);
    } catch (error) {
      console.error('❌ LINE Webhook 處理失敗：', error);
      res.status(500).end();
    }
  });

  app.use(express.json({ limit: '4mb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store, max-age=0'); next(); });
  const staticOptions = {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
      else if (filePath.endsWith('.js') || filePath.endsWith('.css')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  };
  app.use('/admin', express.static(path.join(rootDir, 'public'), staticOptions));
  app.use('/shop', express.static(path.join(rootDir, 'shop'), staticOptions));
  app.use('/track', express.static(path.join(rootDir, 'track'), staticOptions));
  app.get(['/shop/:slug', '/shop/:slug/'], (_req, res) => res.sendFile(path.join(rootDir, 'shop', 'index.html')));
  app.get('/', (_req, res) => res.redirect('/admin'));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'line-order-saas' }));
  app.use('/api/shop', async (req, res, next) => {
    try {
      res.vary('X-Merchant-Slug');
      const requested = normalizeSlug(req.get('x-merchant-slug') || req.query.store || DEFAULT_MERCHANT_ID) || DEFAULT_MERCHANT_ID;
      const merchant = requested === DEFAULT_MERCHANT_ID ? null : await tenantRegistry.findBySlug(requested);
      if (requested !== DEFAULT_MERCHANT_ID && !merchant) return res.status(404).json({ error: '找不到這間商店' });
      req.merchantId = merchant?.id || DEFAULT_MERCHANT_ID;
      req.merchant = merchant;
      req.store = await getStore(req.merchantId);
      next();
    } catch (error) { next(error); }
  });
  app.get('/api/shop/products', async (req, res, next) => {
    try { res.json(await req.store.listProducts({ activeOnly: true })); } catch (error) { next(error); }
  });
  app.get('/api/shop/config', async (req, res, next) => {
    try {
      const settings = await req.store.getSettings();
      const { merchant_line_user_id, bank_name, bank_code, bank_account, bank_account_name, payment_instructions, ...publicSettings } = settings;
      const subscriptionOpen = req.merchant ? canAcceptOrders(req.merchant) : true;
      res.json({ ...publicSettings, accepting_orders: publicSettings.accepting_orders !== false && subscriptionOpen, merchant_slug: req.merchant?.slug || DEFAULT_MERCHANT_ID, plan: req.merchant?.plan || 'legacy', subscription_status: req.merchant?.subscription_status || 'active', accepting_subscription_orders: subscriptionOpen, platform_branding: req.merchant?.plan !== 'pro', platform_sales_url: getPlatformSalesUrl(), liff_id: req.merchantId === DEFAULT_MERCHANT_ID ? process.env.LIFF_ID || '' : '' });
    } catch (error) { next(error); }
  });
  app.post('/api/shop/orders', async (req, res, next) => {
    try {
      if (req.merchant && !canAcceptOrders(req.merchant)) {
        const error = new Error('店家方案已到期，目前暫停接受新訂單'); error.status = 402; throw error;
      }
      const settings = await req.store.getSettings();
      if (!settings.accepting_orders) {
        const error = new Error('店家目前暫停接單，請稍後再試');
        error.status = 409;
        throw error;
      }
      // 只信任由 LINE API 驗證過的 Access Token，不接受瀏覽器自行填入 user ID。
      const lineUserId = await lineIdentity.verify(req.get('x-line-access-token') || req.body?.line_access_token);
      const input = await buildOrder(req.store, { ...req.body, line_user_id: lineUserId });
      const order = await req.store.createOrder(input);
      const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      if (req.merchantId === DEFAULT_MERCHANT_ID) {
        await sheets.saveOrder({ time, summary: input.summary, total: input.total }).catch(error => console.error('❌ 寫入 Google Sheets 失敗：', error));
        await bot.notifyNewOrder(order).catch(error => console.error('❌ 店家 LINE 新訂單通知失敗：', error));
      }
      res.status(201).json({
        id: order.id,
        total: order.total,
        status: order.status,
        claim_code: order.claim_code,
        line_confirm_url: req.merchantId === DEFAULT_MERCHANT_ID ? createLineConfirmUrl(order, process.env.LINE_OFFICIAL_ACCOUNT_ID) : '',
        tracking_url: `/track/?store=${encodeURIComponent(req.merchant?.slug || DEFAULT_MERCHANT_ID)}&code=${encodeURIComponent(order.claim_code || '')}`
        ,payment_method: order.payment_method,
        payment_info: order.payment_method === 'bank_transfer' ? {
          bank_name: settings.bank_name,
          bank_code: settings.bank_code,
          bank_account: settings.bank_account,
          bank_account_name: settings.bank_account_name,
          instructions: settings.payment_instructions
        } : null
      });
    } catch (error) { next(error); }
  });
  app.get('/api/shop/orders/:claimCode/status', async (req, res, next) => {
    try {
      const order = await req.store.findOrderByClaimCode(req.params.claimCode);
      if (!order) return res.status(404).json({ error: '找不到訂單' });
      res.json({
        id: order.id,
        summary: order.summary,
        total: order.total,
        status: order.status,
        created_at: order.created_at,
        claimed: Boolean(order.line_user_id)
        ,payment_method: order.payment_method,
        payment_status: order.payment_status,
        transfer_last5: order.transfer_last5 || ''
      });
    } catch (error) { next(error); }
  });
  app.post('/api/shop/orders/:claimCode/payment', async (req, res, next) => {
    try {
      const last5 = String(req.body?.transfer_last5 || '').trim();
      if (!/^\d{5}$/.test(last5)) throw new Error('請輸入匯款帳號末五碼');
      const order = await req.store.submitTransferLast5(req.params.claimCode, last5);
      if (req.merchantId === DEFAULT_MERCHANT_ID && bot.notifyPaymentSubmitted) {
        await bot.notifyPaymentSubmitted(order).catch(error => console.error('❌ 店家 LINE 匯款通知失敗：', error));
      }
      res.json({ payment_status: order.payment_status });
    } catch (error) { next(error); }
  });
  app.post('/api/admin/register', async (req, res, next) => {
    try {
      const merchant = await tenantRegistry.register({ slug: req.body?.slug, storeName: req.body?.store_name, email: req.body?.email, password: req.body?.password });
      const merchantStore = await getStore(merchant.id);
      await merchantStore.updateSettings({ store_name: merchant.name });
      res.status(201).json({ token: auth.issueToken(merchant.id, { email: String(req.body.email).toLowerCase() }), merchant, shop_url: `/shop/${merchant.slug}/` });
    } catch (error) { next(error); }
  });
  app.post('/api/admin/login', async (req, res, next) => {
    try {
      if (!req.body?.email) return auth.login(req, res);
      const result = await tenantRegistry.authenticate(req.body.email, req.body.password);
      if (!result?.merchant) return res.status(401).json({ error: 'Email 或密碼不正確' });
      res.json({ token: auth.issueToken(result.merchant.id, { email: result.user.email }), merchant: result.merchant, shop_url: `/shop/${result.merchant.slug}/` });
    } catch (error) { next(error); }
  });

  const admin = express.Router();
  admin.use(auth.requireAdmin);
  admin.use(async (req, _res, next) => { try { req.store = await getStore(req.merchantId); req.merchant = req.merchantId === DEFAULT_MERCHANT_ID ? null : await tenantRegistry.findById(req.merchantId); next(); } catch (error) { next(error); } });
  admin.get('/account', async (req, res) => res.json({ merchant_id: req.merchantId, merchant: req.merchant, shop_url: req.merchant ? `/shop/${req.merchant.slug}/` : '/shop/', can_accept_orders: req.merchant ? canAcceptOrders(req.merchant) : true }));
  admin.get('/products', async (req, res, next) => {
    try { res.json(await req.store.listProducts()); } catch (error) { next(error); }
  });
  admin.get('/settings', async (req, res, next) => {
    try { res.json(await req.store.getSettings()); } catch (error) { next(error); }
  });
  admin.put('/settings', async (req, res, next) => {
    try { res.json(await req.store.updateSettings(req.body)); } catch (error) { next(error); }
  });
  admin.post('/images', async (req, res, next) => {
    try { res.status(201).json({ url: await images.upload(req.body?.data_url, req.merchantId) }); } catch (error) { next(error); }
  });
  admin.post('/products', async (req, res, next) => {
    try { res.status(201).json(await req.store.createProduct(req.body)); } catch (error) { next(error); }
  });
  admin.put('/products/:id', async (req, res, next) => {
    try { res.json(await req.store.updateProduct(req.params.id, req.body)); } catch (error) { next(error); }
  });
  admin.delete('/products/:id', async (req, res, next) => {
    try { await req.store.deleteProduct(req.params.id); res.status(204).end(); } catch (error) { next(error); }
  });
  admin.get('/orders', async (req, res, next) => {
    try { res.json(await req.store.listOrders()); } catch (error) { next(error); }
  });
  admin.patch('/orders/:id/status', async (req, res, next) => {
    try {
      const order = await req.store.updateOrderStatus(req.params.id, req.body.status);
      if (req.merchantId === DEFAULT_MERCHANT_ID) await bot.notifyOrderStatus(order).catch(error => console.error('❌ LINE 訂單通知失敗：', error));
      res.json(order);
    } catch (error) { next(error); }
  });
  admin.patch('/orders/:id/payment', async (req, res, next) => {
    try {
      const order = await req.store.updatePaymentStatus(req.params.id, req.body.payment_status);
      if (req.merchantId === DEFAULT_MERCHANT_ID && bot.notifyPaymentStatus) {
        await bot.notifyPaymentStatus(order).catch(error => console.error('❌ LINE 付款通知失敗：', error));
      }
      res.json(order);
    } catch (error) { next(error); }
  });
  app.use('/api/admin', admin);

  app.use((error, _req, res, _next) => {
    const status = error.status || 400;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message || '操作失敗' });
  });
  return { app, store, bot, tenantRegistry, getStore };
}

module.exports = { createApp, createLineConfirmUrl };
