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

test('結帳欄位與取貨方式依店家設定驗證', async () => {
  const store = {
    listProducts: async () => [{ id: 'cake', name: '蛋糕', price: 500, active: true }],
    getSettings: async () => ({
      cash_enabled: true,
      bank_transfer_enabled: false,
      checkout_fields: {
        customer_name: { label: '訂購人', enabled: false, required: false },
        phone: { label: '手機號碼', enabled: true, required: true },
        pickup_time: { label: '送達日期', enabled: true, required: true },
        note: { label: '留言', enabled: false, required: false }
      },
      fulfillment_options: [{ id: 'home_delivery', label: '冷藏宅配', enabled: true }]
    })
  };
  await assert.rejects(() => buildOrder(store, { phone: '0900', fulfillment: 'home_delivery', items: [{ product_id: 'cake', quantity: 1 }] }), /送達日期/);
  const order = await buildOrder(store, { customer_name: '不應保存', phone: '0900', pickup_time: '6/30', note: '不應保存', fulfillment: 'home_delivery', items: [{ product_id: 'cake', quantity: 1 }] });
  assert.equal(order.customer_name, '');
  assert.equal(order.note, '');
  assert.equal(order.fulfillment, '冷藏宅配');
});

test('客製詢價商品會建立待報價訂單', async () => {
  const store = {
    listProducts: async () => [{ id: 'custom-cake', name: '客製蛋糕', price: 0, product_type: 'quote', active: true }],
    getSettings: async () => ({
      checkout_fields: {
        customer_name: { label: '姓名', enabled: true, required: true },
        phone: { label: '電話', enabled: true, required: true },
        pickup_time: { label: '交付時間', enabled: true, required: false },
        note: { label: '備註', enabled: true, required: false }
      },
      fulfillment_options: [{ id: 'pickup', label: '到店取貨', enabled: true }],
      cash_enabled: true,
      bank_transfer_enabled: true
    })
  };
  const order = await buildOrder(store, { customer_name: '客戶', phone: '0900', fulfillment: 'pickup', quote_request: '想要粉色生日蛋糕，預算 1500', items: [{ product_id: 'custom-cake', quantity: 1 }] });
  assert.equal(order.payment_method, 'quote');
  assert.equal(order.quote_status, 'requested');
  assert.equal(order.total, 0);
  assert.match(order.summary, /待報價/);
  await assert.rejects(() => buildOrder(store, { customer_name: '客戶', phone: '0900', items: [{ product_id: 'custom-cake', quantity: 1 }] }), /客製需求/);
});
