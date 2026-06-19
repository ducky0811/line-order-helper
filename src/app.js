const express = require('express');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const { createSheetsService } = require('./sheets');
const { createBot } = require('./bot');

async function createApp(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const app = express();
  const seedProducts = JSON.parse(fs.readFileSync(path.join(rootDir, 'menu.json'), 'utf8'));
  const store = options.store || createStore(rootDir, seedProducts);
  await store.init();
  const sheets = options.sheets || createSheetsService();
  const bot = options.bot || createBot({ store, sheets });
  const auth = options.auth || createAuth();

  app.post('/webhook', bot.middleware, async (req, res) => {
    try {
      const results = await Promise.all(req.body.events.map(bot.handleEvent));
      res.json(results);
    } catch (error) {
      console.error('❌ LINE Webhook 處理失敗：', error);
      res.status(500).end();
    }
  });

  app.use(express.json({ limit: '1mb' }));
  app.use('/admin', express.static(path.join(rootDir, 'public')));
  app.get('/', (_req, res) => res.redirect('/admin'));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'line-order-saas' }));
  app.post('/api/admin/login', auth.login);

  const admin = express.Router();
  admin.use(auth.requireAdmin);
  admin.get('/products', async (_req, res, next) => {
    try { res.json(await store.listProducts()); } catch (error) { next(error); }
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
    console.error(error);
    res.status(400).json({ error: error.message || '操作失敗' });
  });
  return { app, store, bot };
}

module.exports = { createApp };
