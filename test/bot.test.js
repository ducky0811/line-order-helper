const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { LocalStore } = require('../src/store');
const { createBot } = require('../src/bot');

test('店家可綁定 LINE、收到新訂單並用按鈕更新狀態', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-order-bot-'));
  const store = new LocalStore(dir);
  await store.init();
  const calls = { replies: [], pushes: [] };
  const client = {
    replyMessage: async payload => calls.replies.push(payload),
    pushMessage: async payload => calls.pushes.push(payload)
  };
  const previous = process.env.MERCHANT_BIND_CODE;
  process.env.MERCHANT_BIND_CODE = '246810';
  const bot = createBot({
    store,
    sheets: { saveOrder: async () => null },
    client,
    config: { channelAccessToken: 'test-token', channelSecret: 'test-secret' }
  });

  try {
    await bot.handleEvent({
      type: 'message', replyToken: 'reply-1', source: { userId: 'Umerchant' },
      message: { type: 'text', text: '綁定店家 246810' }
    });
    assert.equal((await store.getSettings()).merchant_line_user_id, 'Umerchant');

    const order = await store.createOrder({ customer_name: '客戶', phone: '0900', items: [], summary: '蛋糕x1', total: 500 });
    await bot.notifyNewOrder(order);
    assert.equal(calls.pushes[0].to, 'Umerchant');
    assert.match(JSON.stringify(calls.pushes[0]), /確認訂單/);

    await bot.handleEvent({
      type: 'postback', replyToken: 'reply-intruder', source: { userId: 'Uother' },
      postback: { data: `action=orderStatus&orderId=${order.id}&status=completed` }
    });
    assert.equal((await store.listOrders())[0].status, 'new');

    await bot.handleEvent({
      type: 'postback', replyToken: 'reply-2', source: { userId: 'Umerchant' },
      postback: { data: `action=orderStatus&orderId=${order.id}&status=confirmed` }
    });
    assert.equal((await store.listOrders())[0].status, 'confirmed');
  } finally {
    if (previous == null) delete process.env.MERCHANT_BIND_CODE;
    else process.env.MERCHANT_BIND_CODE = previous;
  }
});
