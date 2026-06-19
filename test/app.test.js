const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { LocalStore } = require('../src/store');
const { createAuth } = require('../src/auth');

test('管理後台可以登入並完成商品 CRUD', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-app-'));
  const store = new LocalStore(dir, [{ name: '紅茶', price: 30 }]);
  const auth = createAuth({ password: 'demo-password', secret: 'test-secret' });
  const bot = { middleware: (_req, _res, next) => next(), handleEvent: async () => null, notifyOrderStatus: async () => null };
  const sheets = { saveOrder: async () => null };
  const { app } = await createApp({ store, auth, bot, sheets });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await fetch(`${base}/health`).then(response => response.json());
    assert.equal(health.ok, true);
    const page = await fetch(`${base}/admin/`);
    assert.equal(page.status, 200);

    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'demo-password' })
    }).then(response => response.json());
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
    const createdResponse = await fetch(`${base}/api/admin/products`, {
      method: 'POST', headers, body: JSON.stringify({ name: '雞排', price: 80 })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    await fetch(`${base}/api/admin/products/${created.id}`, { method: 'DELETE', headers });
    const products = await fetch(`${base}/api/admin/products`, { headers }).then(response => response.json());
    assert.equal(products.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
