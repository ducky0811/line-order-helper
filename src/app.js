const express = require('express');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const { createSheetsService } = require('./sheets');
const { createBot } = require('./bot');
const { buildOrder } = require('./orders');
const { createImageService } = require('./images');
const { createLineIdentityService } = require('./line-identity');

async function createApp(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const app = express();
  const seedProducts = JSON.parse(fs.readFileSync(path.join(rootDir, 'menu.json'), 'utf8'));
  const store = options.store || createStore(rootDir, seedProducts);
  await store.init();
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
  app.use('/admin', express.static(path.join(rootDir, 'public')));
  app.use('/shop', express.static(path.join(rootDir, 'shop')));
  app.get('/', (_req, res) => res.redirect('/admin'));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'line-order-saas' }));
  app.get('/api/shop/products', async (_req, res, next) => {
    try { res.json(await store.listProducts({ activeOnly: true })); } catch (error) { next(error); }
  });
  app.get('/api/shop/config', async (_req, res, next) => {
    try {
      const settings = await store.getSettings();
      const { merchant_line_user_id, ...publicSettings } = settings;
      res.json({ ...publicSettings, liff_id: process.env.LIFF_ID || '' });
    } catch (error) { next(error); }
  });
  app.post('/api/shop/orders', async (req, res, next) => {
    try {
      const settings = await store.getSettings();
      if (!settings.accepting_orders) {
        const error = new Error('店家目前暫停接單，請稍後再試');
        error.status = 409;
        throw error;
      }
      // 只信任由 LINE API 驗證過的 Access Token，不接受瀏覽器自行填入 user ID。
      const lineUserId = await lineIdentity.verify(req.get('x-line-access-token') || req.body?.line_access_token);
      const input = await buildOrder(store, { ...req.body, line_user_id: lineUserId });
      const order = await store.createOrder(input);
      const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      await sheets.saveOrder({ time, summary: input.summary, total: input.total })
        .catch(error => console.error('❌ 寫入 Google Sheets 失敗：', error));
      await bot.notifyNewOrder(order).catch(error => console.error('❌ 店家 LINE 新訂單通知失敗：', error));
      res.status(201).json({ id: order.id, total: order.total, status: order.status });
    } catch (error) { next(error); }
  });
  app.post('/api/admin/login', auth.login);

  const admin = express.Router();
  admin.use(auth.requireAdmin);
  admin.get('/products', async (_req, res, next) => {
    try { res.json(await store.listProducts()); } catch (error) { next(error); }
  });
  admin.get('/settings', async (_req, res, next) => {
    try { res.json(await store.getSettings()); } catch (error) { next(error); }
  });
  admin.put('/settings', async (req, res, next) => {
    try { res.json(await store.updateSettings(req.body)); } catch (error) { next(error); }
  });
  admin.post('/images', async (req, res, next) => {
    try { res.status(201).json({ url: await images.upload(req.body?.data_url) }); } catch (error) { next(error); }
  });
  admin.post('/products', async (req, res, next) => {
    try { res.status(201).json(await store.createProduct(req.body)); } catch (error) { next(error); }
  });
  admin.put('/products/:id', async (req, res, next) => {
    try { res.json(await store.updateProduct(req.params.id, req.body)); } catch (error) { next(error); }
  });
  admin.delete('/products/:id', async (req, res, next) => {
    try { await store.deleteProduct(req.params.id); res.status(204).end(); } catch (error) { next(error); }
  });
  admin.get('/orders', async (_req, res, next) => {
    try { res.json(await store.listOrders()); } catch (error) { next(error); }
  });
  admin.patch('/orders/:id/status', async (req, res, next) => {
    try {
      const order = await store.updateOrderStatus(req.params.id, req.body.status);
      await bot.notifyOrderStatus(order).catch(error => console.error('❌ LINE 訂單通知失敗：', error));
      res.json(order);
    } catch (error) { next(error); }
  });
  app.use('/api/admin', admin);

  app.use((error, _req, res, _next) => {
    const status = error.status || 400;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message || '操作失敗' });
  });
  return { app, store, bot };
}

module.exports = { createApp };
