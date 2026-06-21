const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { LocalTenantRegistry, canAcceptOrders } = require('../src/tenants');
const { LocalStore } = require('../src/store');

test('店家註冊後取得 14 天試用且帳密可驗證', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-tenants-'));
  const registry = new LocalTenantRegistry(dir);
  await registry.init();
  const merchant = await registry.register({ slug: 'happy-cake', storeName: '快樂蛋糕', email: 'owner@example.com', password: 'password123' });
  assert.equal(merchant.slug, 'happy-cake');
  assert.equal(merchant.plan, 'trial');
  assert.equal(canAcceptOrders(merchant), true);
  assert.equal((await registry.authenticate('owner@example.com', 'password123')).merchant.id, 'happy-cake');
  assert.equal(await registry.authenticate('owner@example.com', 'wrong-password'), null);
});

test('不同店家的商品、訂單與設定完全隔離', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-isolation-'));
  const storeA = new LocalStore(path.join(dir, 'a'), [], 'store-a');
  const storeB = new LocalStore(path.join(dir, 'b'), [], 'store-b');
  await storeA.init(); await storeB.init();
  await storeA.createProduct({ name: 'A 店蛋糕', price: 500 });
  await storeB.createProduct({ name: 'B 店餅乾', price: 100 });
  await storeA.updateSettings({ store_name: 'A 店' });
  await storeB.updateSettings({ store_name: 'B 店' });
  await storeA.createOrder({ items: [], summary: 'A 店蛋糕x1', total: 500 });
  assert.deepEqual((await storeA.listProducts()).map(item => item.name), ['A 店蛋糕']);
  assert.deepEqual((await storeB.listProducts()).map(item => item.name), ['B 店餅乾']);
  assert.equal((await storeA.getSettings()).store_name, 'A 店');
  assert.equal((await storeB.getSettings()).store_name, 'B 店');
  assert.equal((await storeA.listOrders()).length, 1);
  assert.equal((await storeB.listOrders()).length, 0);
});
