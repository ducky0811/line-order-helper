const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createApp, createLineConfirmUrl } = require('../src/app');
const { LocalStore } = require('../src/store');
const { createAuth } = require('../src/auth');
const { LocalTenantRegistry } = require('../src/tenants');
const { LocalLineIntegrationStore } = require('../src/line-integrations');

test('LINE 確認連結包含官方帳號與預填訂單訊息', () => {
  const url = createLineConfirmUrl({ claim_code: 'ABC123' }, '@demo');
  assert.match(url, /%40demo/);
  assert.match(decodeURIComponent(url), /確認訂單 ABC123/);
});

test('管理後台可以登入並完成商品 CRUD', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-app-'));
  const store = new LocalStore(dir, [{ name: '紅茶', price: 30 }]);
  const auth = createAuth({ password: 'demo-password', secret: 'test-secret' });
  const bot = { middleware: (_req, _res, next) => next(), handleEvent: async () => null, notifyOrderStatus: async () => null, notifyNewOrder: async () => null };
  const sheets = { saveOrder: async () => null };
  const lineIdentity = { verify: async token => token === 'valid-line-token' ? 'Ucustomer' : null };
  const tenantRegistry = new LocalTenantRegistry(dir);
  const lineIntegrations = new LocalLineIntegrationStore(dir);
  const { app } = await createApp({ store, auth, bot, sheets, lineIdentity, tenantRegistry, lineIntegrations });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await fetch(`${base}/health`).then(response => response.json());
    assert.equal(health.ok, true);
    const page = await fetch(`${base}/admin/`);
    assert.equal(page.status, 200);
    const shopPage = await fetch(`${base}/shop/`);
    assert.equal(shopPage.status, 200);
    assert.equal(shopPage.headers.get('cache-control'), 'no-store');
    const shopProducts = await fetch(`${base}/api/shop/products`).then(response => response.json());
    const orderResponse = await fetch(`${base}/api/shop/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Access-Token': 'valid-line-token' },
      body: JSON.stringify({
        customer_name: '測試客戶', phone: '0912345678',
        items: [{ product_id: shopProducts[0].id, quantity: 2 }]
      })
    });
    assert.equal(orderResponse.status, 201);
    const orderResult = await orderResponse.json();
    assert.match(orderResult.claim_code, /^[A-F0-9]{16}$/);
    const tracked = await fetch(`${base}/api/shop/orders/${orderResult.claim_code}/status`).then(response => response.json());
    assert.equal(tracked.total, 60);

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
    const orders = await fetch(`${base}/api/admin/orders`, { headers }).then(response => response.json());
    assert.equal(orders[0].customer_name, '測試客戶');
    assert.equal(orders[0].line_user_id, 'Ucustomer');
    await fetch(`${base}/api/admin/settings`, {
      method: 'PUT', headers, body: JSON.stringify({ bank_transfer_enabled: true, bank_account: '1234567890', logo_url: 'https://example.com/logo.png', hero_image_url: 'https://example.com/hero.jpg' })
    });
    const bankOrderResponse = await fetch(`${base}/api/shop/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: '匯款客戶', phone: '0900', payment_method: 'bank_transfer', items: [{ product_id: products[0].id, quantity: 1 }] })
    });
    assert.equal(bankOrderResponse.status, 201);
    const bankOrder = await bankOrderResponse.json();
    const paymentResponse = await fetch(`${base}/api/shop/orders/${bankOrder.claim_code}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transfer_last5: '12345' })
    });
    assert.equal(paymentResponse.status, 200);
    const paidResponse = await fetch(`${base}/api/admin/orders/${bankOrder.id}/payment`, {
      method: 'PATCH', headers, body: JSON.stringify({ payment_status: 'paid' })
    });
    assert.equal((await paidResponse.json()).payment_status, 'paid');
    const settingsResponse = await fetch(`${base}/api/admin/settings`, {
      method: 'PUT', headers, body: JSON.stringify({ store_name: '測試甜點店', accepting_orders: false })
    });
    assert.equal(settingsResponse.status, 200);
    const config = await fetch(`${base}/api/shop/config`).then(response => response.json());
    assert.equal(config.store_name, '測試甜點店');
    assert.equal(config.logo_url, 'https://example.com/logo.png');
    assert.equal(config.hero_image_url, 'https://example.com/hero.jpg');
    assert.equal(config.bank_account, undefined);
    const closedOrder = await fetch(`${base}/api/shop/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: '客戶', phone: '0900', items: [{ product_id: products[0].id, quantity: 1 }] })
    });
    assert.equal(closedOrder.status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('兩間註冊店家的後台與公開商店資料互不相通', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-multi-app-'));
  await fs.writeFile(path.join(dir, 'menu.json'), '[]');
  const store = new LocalStore(path.join(dir, 'default'));
  const tenantRegistry = new LocalTenantRegistry(dir);
  const lineIntegrations = new LocalLineIntegrationStore(dir);
  const auth = createAuth({ password: 'legacy-password', secret: 'multi-test-secret' });
  const bot = { middleware: (_req, _res, next) => next(), handleEvent: async () => null, notifyOrderStatus: async () => null, notifyNewOrder: async () => null };
  const { app } = await createApp({ rootDir: dir, store, tenantRegistry, lineIntegrations, auth, bot, sheets: { saveOrder: async () => null }, lineIdentity: { verify: async () => null } });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const register = input => fetch(`${base}/api/admin/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(response => response.json());
    const a = await register({ slug: 'store-a', store_name: 'A 店', email: 'a@example.com', password: 'password123' });
    const b = await register({ slug: 'store-b', store_name: 'B 店', email: 'b@example.com', password: 'password123' });
    const requestAdmin = (token, pathname, options = {}) => fetch(`${base}/api/admin${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
    await requestAdmin(a.token, '/products', { method: 'POST', body: JSON.stringify({ name: 'A 店蛋糕', price: 500 }) });
    await requestAdmin(b.token, '/products', { method: 'POST', body: JSON.stringify({ name: 'B 店餅乾', price: 100 }) });
    const productsA = await requestAdmin(a.token, '/products').then(response => response.json());
    const productsB = await requestAdmin(b.token, '/products').then(response => response.json());
    assert.deepEqual(productsA.map(item => item.name), ['A 店蛋糕']);
    assert.deepEqual(productsB.map(item => item.name), ['B 店餅乾']);
    const publicAResponse = await fetch(`${base}/api/shop/products`, { headers: { 'X-Merchant-Slug': 'store-a' } });
    const publicBResponse = await fetch(`${base}/api/shop/products`, { headers: { 'X-Merchant-Slug': 'store-b' } });
    assert.match(publicAResponse.headers.get('cache-control'), /no-store/);
    assert.match(publicAResponse.headers.get('vary'), /X-Merchant-Slug/i);
    const publicA = await publicAResponse.json(); const publicB = await publicBResponse.json();
    assert.deepEqual(publicA.map(item => item.name), ['A 店蛋糕']);
    assert.deepEqual(publicB.map(item => item.name), ['B 店餅乾']);
    const spoofedAdmin = await fetch(`${base}/api/admin/products`, { headers: { Authorization: `Bearer ${a.token}`, 'X-Merchant-Slug': 'store-b' } }).then(response => response.json());
    assert.deepEqual(spoofedAdmin.map(item => item.name), ['A 店蛋糕']);
    const orderResponse = await fetch(`${base}/api/shop/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Merchant-Slug': 'store-a' }, body: JSON.stringify({ customer_name: 'A 客戶', phone: '0900', items: [{ product_id: productsA[0].id, quantity: 1 }] }) });
    assert.equal(orderResponse.status, 201);
    assert.equal((await requestAdmin(a.token, '/orders').then(response => response.json())).length, 1);
    assert.equal((await requestAdmin(b.token, '/orders').then(response => response.json())).length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
