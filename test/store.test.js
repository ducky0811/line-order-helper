const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { LocalStore } = require('../src/store');

test('商家可以新增、修改與停售商品', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-store-'));
  const store = new LocalStore(dir, [{ name: '紅茶', price: 30 }]);
  await store.init();
  const initial = await store.listProducts({ activeOnly: true });
  assert.equal(initial.length, 1);

  const product = await store.createProduct({ name: '雞排', price: 80, active: true });
  assert.equal(product.name, '雞排');
  await store.updateProduct(product.id, { active: false, price: 85 });
  const active = await store.listProducts({ activeOnly: true });
  assert.equal(active.some(item => item.id === product.id), false);
  assert.equal((await store.listProducts()).find(item => item.id === product.id).price, 85);
});

test('訂單可以建立並更新狀態', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-orders-'));
  const store = new LocalStore(dir);
  await store.init();
  const order = await store.createOrder({ line_user_id: 'U123', items: [], summary: '雞排x1', total: 80 });
  const updated = await store.updateOrderStatus(order.id, 'ready');
  assert.equal(updated.status, 'ready');
});

test('店家可以更新品牌資料與暫停接單', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-settings-'));
  const store = new LocalStore(dir);
  await store.init();
  const settings = await store.updateSettings({ store_name: '測試甜點店', accepting_orders: false });
  assert.equal(settings.store_name, '測試甜點店');
  assert.equal((await store.getSettings()).accepting_orders, false);
});
