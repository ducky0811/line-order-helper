const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createStore, DEFAULT_MERCHANT_ID } = require('./store');
const { createAuth } = require('./auth');
const { createSheetsService } = require('./sheets');
const { createBot } = require('./bot');
const { buildOrder } = require('./orders');
const { createImageService } = require('./images');
const { createLineIdentityService } = require('./line-identity');
const { createTenantRegistry, normalizeSlug, canAcceptOrders, planCapabilities, hasPlanFeature, retentionPolicy } = require('./tenants');
const { createLineIntegrationStore, publicIntegration, credentials } = require('./line-integrations');
const { createSheetIntegrationStore, publicSheetIntegration } = require('./sheet-integrations');

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

function friendlySheetsError(reason) {
  const message = String(reason?.message || reason || '');
  if (/找不到名為/.test(message)) return message;
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) return 'Google Sheets API 尚未啟用，請到 Google Cloud 啟用 Google Sheets API 後再試';
  if (/DECODER|private key|invalid_grant|unauthorized_client|invalid_client/i.test(message)) return 'Google 服務帳號金鑰無法使用，請檢查 Zeabur 的 GOOGLE_CLIENT_EMAIL 與 GOOGLE_PRIVATE_KEY';
  if (/403|permission|forbidden|caller does not have permission/i.test(message)) return '服務帳號沒有編輯權限，請在試算表右上角「共用」中設為編輯者';
  if (/404|not found|requested entity was not found/i.test(message)) return '找不到這份試算表，請重新複製瀏覽器上方的完整網址';
  return 'Google 試算表連線失敗，請確認共用帳號、編輯者權限與工作表名稱';
}
function secureEqual(left, right) { const a = Buffer.from(String(left || '')); const b = Buffer.from(String(right || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); }

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
  async function purgeRetainedOrders() {
    for (const merchant of await tenantRegistry.listMerchants()) {
      const policy = retentionPolicy(merchant);
      if (policy.purge_before) await (await getStore(merchant.id)).purgeOrdersBefore(policy.purge_before);
    }
  }
  purgeRetainedOrders().catch(error => console.error('❌ 訂單保存期限整理失敗：', error.message));
  const retentionTimer = setInterval(() => purgeRetainedOrders().catch(error => console.error('❌ 訂單保存期限整理失敗：', error.message)), 86400000);
  retentionTimer.unref?.();
  const sheets = options.sheets || createSheetsService();
  const bot = options.bot || createBot({ store, sheets });
  const auth = options.auth || createAuth();
  const platformPassword = String(options.platformPassword ?? process.env.PLATFORM_ADMIN_PASSWORD ?? '');
  const platformSecret = options.platformSecret || process.env.PLATFORM_ADMIN_SECRET || crypto.createHash('sha256').update(`${process.env.SESSION_SECRET || 'change-me'}:platform-admin`).digest('hex');
  const platformAuth = options.platformAuth || createAuth({ password: platformPassword || crypto.randomBytes(32).toString('hex'), secret: platformSecret });
  const images = options.images || createImageService();
  const lineIdentity = options.lineIdentity || createLineIdentityService();
  const lineIntegrations = options.lineIntegrations || createLineIntegrationStore(rootDir);
  await lineIntegrations.init();
  const sheetIntegrations = options.sheetIntegrations || createSheetIntegrationStore(rootDir);
  await sheetIntegrations.init();
  const tenantBots = new Map();
  async function getTenantBot(merchantId, refresh = false) {
    const row = await lineIntegrations.get(merchantId);
    const config = credentials(row);
    if (!config) return null;
    const cached = tenantBots.get(merchantId);
    if (!refresh && cached?.updatedAt === row.updated_at) return cached;
    const tenantStore = await getStore(merchantId);
    const tenantSheets = { saveOrder: async order => { const merchant = await tenantRegistry.findById(merchantId); if (!hasPlanFeature(merchant, 'sheets')) return null; const sheetConfig = await sheetIntegrations.get(merchantId); return sheetConfig?.enabled ? sheets.saveOrder(order, sheetConfig) : null; } };
    const tenantBot = createBot({ store: tenantStore, sheets: tenantSheets, config: { ...config, merchantSlug: merchantId, publicBaseUrl: process.env.PUBLIC_BASE_URL || '' } });
    const result = { bot: tenantBot, row, config, updatedAt: row.updated_at };
    tenantBots.set(merchantId, result);
    return result;
  }
  async function getTenantBotSafe(merchantId) { try { return await getTenantBot(merchantId); } catch (error) { console.error(`❌ 店家 ${merchantId} LINE 連接失敗：`, error.message); return null; } }


  app.post('/webhook', bot.middleware, async (req, res) => {
    try {
      const results = await Promise.all(req.body.events.map(bot.handleEvent));
      res.json(results);
    } catch (error) {
      console.error('❌ LINE Webhook 處理失敗：', error);
      res.status(500).end();
    }
  });
  app.post('/webhook/:slug', async (req, res, next) => {
    try {
      const merchant = await tenantRegistry.findBySlug(req.params.slug);
      if (!merchant) return res.status(404).end();
      if (!hasPlanFeature(merchant, 'line')) return res.status(403).end();
      const connected = await getTenantBot(merchant.id);
      if (!connected) return res.status(404).end();
      connected.bot.middleware(req, res, async error => {
        if (error) return next(error);
        try { res.json(await Promise.all((req.body.events || []).map(connected.bot.handleEvent))); } catch (reason) { next(reason); }
      });
    } catch (error) { next(error); }
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
  app.use('/platform', express.static(path.join(rootDir, 'platform'), staticOptions));
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
      const tenantLine = req.merchant ? publicIntegration(await lineIntegrations.get(req.merchantId), process.env.PUBLIC_BASE_URL || '') : null;
      res.json({ ...publicSettings, accepting_orders: publicSettings.accepting_orders !== false && subscriptionOpen, merchant_slug: req.merchant?.slug || DEFAULT_MERCHANT_ID, plan: req.merchant?.plan || 'legacy', subscription_status: req.merchant?.subscription_status || 'active', accepting_subscription_orders: subscriptionOpen, platform_branding: req.merchant?.plan !== 'pro', platform_sales_url: getPlatformSalesUrl(), line_enabled: req.merchant ? hasPlanFeature(req.merchant, 'line') && tenantLine.enabled && tenantLine.configured : Boolean(process.env.LINE_OFFICIAL_ACCOUNT_ID), liff_id: req.merchantId === DEFAULT_MERCHANT_ID ? process.env.LIFF_ID || '' : '' });
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
      let tenantLine = null;
      if (req.merchantId === DEFAULT_MERCHANT_ID) {
        await sheets.saveOrder({ time, ...order }).catch(error => console.error('❌ 寫入 Google Sheets 失敗：', error));
        await bot.notifyNewOrder(order).catch(error => console.error('❌ 店家 LINE 新訂單通知失敗：', error));
      } else {
        if (hasPlanFeature(req.merchant, 'sheets')) { const sheetConfig = await sheetIntegrations.get(req.merchantId); if (sheetConfig?.enabled) await sheets.saveOrder({ time, ...order }, sheetConfig).catch(error => console.error('❌ 店家 Google Sheets 同步失敗：', error)); }
        if (hasPlanFeature(req.merchant, 'line')) { tenantLine = await getTenantBotSafe(req.merchantId); if (tenantLine) await tenantLine.bot.notifyNewOrder(order).catch(error => console.error('❌ 店家 LINE 新訂單通知失敗：', error)); }
      }
      res.status(201).json({
        id: order.id,
        total: order.total,
        status: order.status,
        claim_code: order.claim_code,
        line_confirm_url: createLineConfirmUrl(order, req.merchantId === DEFAULT_MERCHANT_ID ? process.env.LINE_OFFICIAL_ACCOUNT_ID : tenantLine?.config.officialAccountId),
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
      if (req.merchantId === DEFAULT_MERCHANT_ID && bot.notifyPaymentSubmitted) await bot.notifyPaymentSubmitted(order).catch(error => console.error('❌ 店家 LINE 匯款通知失敗：', error));
      else if (req.merchantId !== DEFAULT_MERCHANT_ID && hasPlanFeature(req.merchant, 'line')) { const tenantLine = await getTenantBotSafe(req.merchantId); if (tenantLine?.bot.notifyPaymentSubmitted) await tenantLine.bot.notifyPaymentSubmitted(order).catch(error => console.error('❌ 店家 LINE 匯款通知失敗：', error)); }
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

  const platformAttempts = new Map();
  app.post('/api/platform/login', (req, res) => {
    if (!platformPassword) return res.status(503).json({ error: '平台管理密碼尚未設定' });
    const key = req.ip || 'unknown'; const attempt = platformAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60000 };
    if (attempt.resetAt < Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 15 * 60000; }
    if (attempt.count >= 8) return res.status(429).json({ error: '嘗試次數過多，請 15 分鐘後再試' });
    if (!secureEqual(req.body?.password, platformPassword)) { attempt.count += 1; platformAttempts.set(key, attempt); return res.status(401).json({ error: '平台管理密碼不正確' }); }
    platformAttempts.delete(key); return res.json({ token: platformAuth.issueToken('platform', { role: 'platform-admin' }) });
  });
  const platform = express.Router();
  platform.use((req, res, next) => platformAuth.requireAdmin(req, res, error => { if (error) return next(error); if (req.session?.role !== 'platform-admin') return res.status(403).json({ error: '沒有平台管理權限' }); next(); }));
  platform.get('/summary', async (_req, res, next) => {
    try {
      const merchants = await tenantRegistry.listMerchantSummaries();
      const rows = [];
      for (const merchant of merchants) {
        const merchantStore = await getStore(merchant.id); const [orders, products] = await Promise.all([merchantStore.listOrders(), merchantStore.listProducts()]);
        rows.push({ ...merchant, password_hash: undefined, order_count: orders.length, product_count: products.length, revenue: orders.filter(order => !['cancelled'].includes(order.status)).reduce((sum, order) => sum + Number(order.total || 0), 0), can_accept_orders: canAcceptOrders(merchant), capabilities: planCapabilities(merchant), shop_url: `/shop/${merchant.slug}/` });
      }
      res.json({ merchants: rows, totals: { merchants: rows.length, trial: rows.filter(item => item.plan === 'trial').length, basic: rows.filter(item => item.plan === 'basic').length, pro: rows.filter(item => item.plan === 'pro').length, active: rows.filter(item => item.can_accept_orders).length } });
    } catch (error) { next(error); }
  });
  platform.patch('/merchants/:id/subscription', async (req, res, next) => {
    try { const merchant = await tenantRegistry.updateSubscription(req.params.id, { plan: req.body?.plan, months: req.body?.months, extend: req.body?.extend !== false, suspended: req.body?.suspended === true }); console.log(`🔐 平台管理員更新店家 ${merchant.id}：${merchant.plan}，到期 ${merchant.expires_at}，狀態 ${merchant.subscription_status}`); res.json(merchant); } catch (error) { next(error); }
  });
  app.use('/api/platform', platform);

  const admin = express.Router();
  admin.use(auth.requireAdmin);
  admin.use(async (req, _res, next) => { try { req.store = await getStore(req.merchantId); req.merchant = req.merchantId === DEFAULT_MERCHANT_ID ? null : await tenantRegistry.findById(req.merchantId); next(); } catch (error) { next(error); } });
  admin.get('/account', async (req, res) => { const capabilities = req.merchant ? planCapabilities(req.merchant) : { plan: 'legacy', line: true, sheets: true, retention_days: null, label: '既有方案' }; res.json({ merchant_id: req.merchantId, merchant: req.merchant, shop_url: req.merchant ? `/shop/${req.merchant.slug}/` : '/shop/', can_accept_orders: req.merchant ? canAcceptOrders(req.merchant) : true, capabilities, retention: req.merchant ? retentionPolicy(req.merchant) : null }); });
  admin.get('/line-integration', async (req, res, next) => { try { if (!req.merchant) return res.json({ legacy: true, enabled: Boolean(process.env.CHANNEL_ACCESS_TOKEN), configured: Boolean(process.env.CHANNEL_ACCESS_TOKEN && process.env.CHANNEL_SECRET), official_account_id: process.env.LINE_OFFICIAL_ACCOUNT_ID || '', webhook_url: `${String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/webhook` }); if (!hasPlanFeature(req.merchant, 'line')) return res.json({ locked: true, required_plan: 'pro', enabled: false }); const safe = publicIntegration(await lineIntegrations.get(req.merchantId), process.env.PUBLIC_BASE_URL || ''); const settings = await req.store.getSettings(); res.json({ ...safe, bound: Boolean(settings.merchant_line_user_id) }); } catch (error) { next(error); } });
  admin.put('/line-integration', async (req, res, next) => { try { if (!req.merchant) return res.status(409).json({ error: '既有商店請繼續使用 Zeabur 的 LINE 環境變數' }); if (!hasPlanFeature(req.merchant, 'line')) return res.status(403).json({ error: 'LINE 自動通知為專業版功能' }); const row = await lineIntegrations.save(req.merchantId, req.body || {}); tenantBots.delete(req.merchantId); if (row.enabled) { try { const connected = await getTenantBot(req.merchantId, true); await connected.bot.verifyConnection(); } catch (reason) { await lineIntegrations.save(req.merchantId, { enabled: false }); tenantBots.delete(req.merchantId); const error = new Error('LINE Channel Access Token 驗證失敗，已保持停用，請檢查後重試'); error.status = 400; throw error; } } res.json(publicIntegration(row, process.env.PUBLIC_BASE_URL || '')); } catch (error) { next(error); } });
  admin.get('/sheets-integration', async (req, res, next) => { try { if (!req.merchant) return res.json({ legacy: true, enabled: sheets.available, service_account_email: sheets.serviceAccountEmail || '' }); if (!hasPlanFeature(req.merchant, 'sheets')) return res.json({ locked: true, required_plan: 'pro', enabled: false }); res.json(publicSheetIntegration(await sheetIntegrations.get(req.merchantId), sheets.serviceAccountEmail)); } catch (error) { next(error); } });
  admin.put('/sheets-integration', async (req, res, next) => { try { if (!req.merchant) return res.status(409).json({ error: '既有商店請繼續使用 Zeabur 的 Google Sheets 環境變數' }); if (!hasPlanFeature(req.merchant, 'sheets')) return res.status(403).json({ error: 'Google 試算表同步為專業版功能' }); const row = await sheetIntegrations.save(req.merchantId, req.body || {}); if (row.enabled) { try { await sheets.verify(row); } catch (reason) { console.error('❌ Google 試算表驗證失敗：', reason?.message || reason); await sheetIntegrations.save(req.merchantId, { enabled: false }); const error = new Error(friendlySheetsError(reason)); error.status = 400; throw error; } } res.json(publicSheetIntegration(row, sheets.serviceAccountEmail)); } catch (error) { next(error); } });
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
    try { if (req.merchant) { const policy = retentionPolicy(req.merchant); if (policy.purge_before) await req.store.purgeOrdersBefore(policy.purge_before); } res.json(await req.store.listOrders()); } catch (error) { next(error); }
  });
  admin.patch('/orders/:id/status', async (req, res, next) => {
    try {
      const order = await req.store.updateOrderStatus(req.params.id, req.body.status);
      if (req.merchantId === DEFAULT_MERCHANT_ID) await bot.notifyOrderStatus(order).catch(error => console.error('❌ LINE 訂單通知失敗：', error));
      else if (hasPlanFeature(req.merchant, 'line')) { const tenantLine = await getTenantBotSafe(req.merchantId); if (tenantLine) await tenantLine.bot.notifyOrderStatus(order).catch(error => console.error('❌ LINE 訂單通知失敗：', error)); }
      res.json(order);
    } catch (error) { next(error); }
  });
  admin.patch('/orders/:id/payment', async (req, res, next) => {
    try {
      const order = await req.store.updatePaymentStatus(req.params.id, req.body.payment_status);
      if (req.merchantId === DEFAULT_MERCHANT_ID && bot.notifyPaymentStatus) {
        await bot.notifyPaymentStatus(order).catch(error => console.error('❌ LINE 付款通知失敗：', error));
      } else if (req.merchantId !== DEFAULT_MERCHANT_ID && hasPlanFeature(req.merchant, 'line')) { const tenantLine = await getTenantBotSafe(req.merchantId); if (tenantLine?.bot.notifyPaymentStatus) await tenantLine.bot.notifyPaymentStatus(order).catch(error => console.error('❌ LINE 付款通知失敗：', error)); }
      res.json(order);
    } catch (error) { next(error); }
  });
  app.use('/api/admin', admin);

  app.use((error, _req, res, _next) => {
    const status = error.status || 400;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message || '操作失敗' });
  });
  return { app, store, bot, tenantRegistry, getStore, lineIntegrations, sheetIntegrations, getTenantBot };
}

module.exports = { createApp, createLineConfirmUrl, friendlySheetsError };
