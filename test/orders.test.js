const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrder } = require('../src/orders');

test('訂單金額由伺服器商品價格計算，不能由客戶端竄改', async () => {
  const store = { listProducts: async () => [{ id: 'tea', name: '紅茶', price: 30, active: true }], getSettings: async () => ({ cash_enabled: true, bank_transfer_enabled: true, bank_account: '123' }) };
  const order = await buildOrder(store, {
    customer_name: '王小明', phone: '0912345678', total: 1,
    items: [{ product_id: 'tea', quantity: 3, price: 1 }]
  });
  assert.equal(order.total, 90);
  assert.equal(order.summary, '紅茶x3');
});
