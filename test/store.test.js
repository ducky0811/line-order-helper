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
  assert.match(order.claim_code, /^[A-F0-9]{16}$/);
  const updated = await store.updateOrderStatus(order.id, 'ready');
  assert.equal(updated.status, 'ready');
});

test('外部網站訂單可用安全碼綁定 LINE 客戶', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-claim-'));
  const store = new LocalStore(dir);
  await store.init();
  const order = await store.createOrder({ items: [], summary: '蛋糕x1', total: 500 });
  const claimed = await store.claimOrder(order.claim_code.toLowerCase(), 'Ucustomer');
  assert.equal(claimed.line_user_id, 'Ucustomer');
  await assert.rejects(() => store.claimOrder(order.claim_code, 'Uother'), /其他 LINE 帳號/);
});

test('店家可以更新品牌資料與暫停接單', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-settings-'));
  const store = new LocalStore(dir);
  await store.init();
  const settings = await store.updateSettings({ store_name: '測試甜點店', accepting_orders: false });
  assert.equal(settings.store_name, '測試甜點店');
  assert.equal((await store.getSettings()).accepting_orders, false);
});

test('店家可以設定訂購欄位與自訂取貨方式', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-checkout-settings-'));
  const store = new LocalStore(dir);
  await store.init();
  const settings = await store.updateSettings({
    checkout_fields: { phone: { label: '手機號碼', enabled: true, required: true } },
    fulfillment_options: [{ id: 'cold_delivery', label: '冷藏宅配', enabled: true }, { id: 'pickup', label: '自取', enabled: false }]
  });
  assert.equal(settings.checkout_fields.phone.label, '手機號碼');
  assert.equal(settings.fulfillment_options[0].label, '冷藏宅配');
  assert.equal(settings.fulfillment_options[1].enabled, false);
});

test('銀行轉帳可回填末五碼並確認收款', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-payment-'));
  const store = new LocalStore(dir);
  await store.init();
  const order = await store.createOrder({ items: [], summary: '蛋糕x1', total: 500, payment_method: 'bank_transfer' });
  const submitted = await store.submitTransferLast5(order.claim_code, '12345');
  assert.equal(submitted.payment_status, 'pending');
  assert.equal(submitted.transfer_last5, '12345');
  const paid = await store.updatePaymentStatus(order.id, 'paid');
  assert.equal(paid.payment_status, 'paid');
  assert.ok(paid.paid_at);
});

test('訂單可保存客製溝通留言與照片', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-messages-'));
  const store = new LocalStore(dir);
  await store.init();
  const order = await store.createOrder({ items: [], summary: '客製蛋糕x1', total: 0, payment_method: 'quote', quote_status: 'requested' });
  const customer = await store.addOrderMessageByClaimCode(order.claim_code, { text: '想要粉色風格', image_url: 'https://example.com/ref.jpg' });
  assert.equal(customer.order_messages.length, 1);
  assert.equal(customer.order_messages[0].author, 'customer');
  const merchant = await store.addOrderMessage(order.id, { author: 'merchant', text: '可以，預計報價 1200 元' });
  assert.equal(merchant.order_messages.length, 2);
  assert.equal(merchant.order_messages[1].author, 'merchant');
});
