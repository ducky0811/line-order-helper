const line = require('@line/bot-sdk');
const crypto = require('crypto');

const STATUS_TEXT = {
  confirmed: '✅ 店家已確認您的訂單',
  preparing: '👩‍🍳 您的訂單正在準備中',
  ready: '📦 您的訂單已完成，可以取貨了',
  completed: '🎉 訂單已完成，謝謝您的購買',
  cancelled: '❌ 店家已取消此訂單，若有疑問請與店家聯絡'
};
const PAYMENT_TEXT = {
  paid: '💰 店家已確認收到款項',
  refunded: '↩️ 店家已將款項標記為已退款'
};

function createBot({ store, sheets, client: providedClient, config: providedConfig }) {
  const config = providedConfig || {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
  };
  if (!config.channelAccessToken || !config.channelSecret) {
    throw new Error('缺少 CHANNEL_ACCESS_TOKEN 或 CHANNEL_SECRET');
  }
  const client = providedClient || new line.messagingApi.MessagingApiClient({ channelAccessToken: config.channelAccessToken });
  const publicBaseUrl = String(providedConfig?.publicBaseUrl || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  const merchantSlug = String(providedConfig?.merchantSlug || '').trim();
  const carts = new Map();

  async function reply(replyToken, messages) {
    return client.replyMessage({ replyToken, messages: Array.isArray(messages) ? messages : [messages] });
  }

  function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async function getProducts() {
    return (await store.listProducts({ activeOnly: true })).filter(product => product.product_type !== 'quote');
  }

  function cartSummary(cart, products) {
    let total = 0;
    const lines = [];
    const items = [];
    for (const [productId, quantity] of Object.entries(cart)) {
      const product = products.find(item => item.id === productId);
      if (!product) continue;
      const subtotal = product.price * quantity;
      total += subtotal;
      lines.push(`${product.name} x ${quantity}`);
      items.push({ product_id: product.id, name: product.name, price: product.price, quantity, subtotal });
    }
    return { total, summary: lines.join('、'), items };
  }

  async function handleEvent(event) {
    const userId = event.source.userId;
    if (event.type === 'postback') {
      const settings = await store.getSettings();
      if (!settings.merchant_line_user_id || userId !== settings.merchant_line_user_id) {
        return reply(event.replyToken, { type: 'text', text: '您沒有管理訂單的權限。' });
      }
      const data = new URLSearchParams(event.postback.data || '');
      const action = data.get('action');
      let order;
      if (action === 'orderStatus') {
        order = await store.updateOrderStatus(data.get('orderId'), data.get('status'));
        await notifyOrderStatus(order);
      } else if (action === 'paymentStatus') {
        order = await store.updatePaymentStatus(data.get('orderId'), data.get('status'));
        await notifyPaymentStatus(order);
      } else return null;
      return reply(event.replyToken, {
        type: 'text', text: action === 'paymentStatus' ? `訂單 #${order.id.slice(0, 8)} 已確認收款` : `訂單 #${order.id.slice(0, 8)} 已更新為「${STATUS_TEXT[order.status] || order.status}」`
      });
    }

    if (event.type !== 'message' || event.message.type !== 'text') return null;
    const text = event.message.text.trim();
    if (text.startsWith('綁定店家 ')) {
      const bindCode = providedConfig?.merchantBindCode || process.env.MERCHANT_BIND_CODE;
      const provided = text.slice(5).trim();
      if (!bindCode || !safeEqual(provided, bindCode)) {
        return reply(event.replyToken, { type: 'text', text: '綁定碼不正確，請回管理後台確認。' });
      }
      await store.updateSettings({ merchant_line_user_id: userId });
      return reply(event.replyToken, { type: 'text', text: '✅ 店家 LINE 綁定成功！之後的新訂單會通知到這裡。' });
    }
    if (text.startsWith('確認訂單 ')) {
      const claimCode = text.slice(5).trim().toUpperCase();
      try {
        const order = await store.claimOrder(claimCode, userId);
        const settings = await store.getSettings();
        const isQuote = order.payment_method === 'quote' || order.quote_status === 'requested';
        const paymentDetails = isQuote
          ? '\n\n此為客製詢價，店家報價後會再與您確認。'
          : order.payment_method === 'bank_transfer'
          ? `\n\n🏦 匯款資料\n${settings.bank_name || ''}${settings.bank_code ? `（${settings.bank_code}）` : ''}\n帳號：${settings.bank_account || ''}\n戶名：${settings.bank_account_name || ''}${settings.payment_instructions ? `\n${settings.payment_instructions}` : ''}`
          : '\n\n付款方式：現金取貨';
        const paymentFollowup = order.payment_method === 'bank_transfer' ? '\n完成匯款後，請到訂單進度頁回填帳號末五碼。' : '';
        const trackingLink = publicBaseUrl ? `\n\n查看訂單／回填末五碼：\n${publicBaseUrl}/track/?${merchantSlug?`store=${encodeURIComponent(merchantSlug)}&`:''}code=${encodeURIComponent(order.claim_code || claimCode)}` : '';
        return reply(event.replyToken, {
          type: 'text',
          text: `✅ LINE 訂單確認完成！\n\n訂單編號：#${order.id.slice(0, 8)}\n${order.summary}\n${isQuote ? '金額：等待店家報價' : `總計：${order.total} 元`}${paymentDetails}${paymentFollowup}${trackingLink}\n\n店家更新進度時會通知您。`
        });
      } catch (error) {
        return reply(event.replyToken, { type: 'text', text: `❌ ${error.message}` });
      }
    }
    const products = await getProducts();
    if (!carts.has(userId)) carts.set(userId, {});
    const cart = carts.get(userId);

    if (text === '菜單') {
      if (!products.length) return reply(event.replyToken, { type: 'text', text: '目前沒有販售中的商品。' });
      const bubbles = products.slice(0, 12).map(product => ({
        type: 'bubble', size: 'micro',
        hero: { type: 'image', url: product.image_url || 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600', size: 'full', aspectRatio: '20:13', aspectMode: 'cover' },
        body: { type: 'box', layout: 'vertical', contents: [
          { type: 'text', text: product.name, weight: 'bold', size: 'md' },
          { type: 'text', text: `NT$ ${product.price}`, size: 'sm', color: '#e53e3e', weight: 'bold', margin: 'xs' },
          { type: 'text', text: product.description || '歡迎選購', size: 'xs', color: '#718096', margin: 'xs', wrap: true }
        ]},
        footer: { type: 'box', layout: 'vertical', contents: [{
          type: 'button', style: 'primary', color: '#2457d6', height: 'sm',
          action: { type: 'message', label: '加入購物車', text: `加入商品:${product.id}` }
        }]}
      }));
      return reply(event.replyToken, { type: 'flex', altText: '請查看菜單', contents: { type: 'carousel', contents: bubbles } });
    }

    if (text.startsWith('加入商品:')) {
      const product = products.find(item => item.id === text.slice(5));
      if (!product) return reply(event.replyToken, { type: 'text', text: '這項商品目前無法選購，請重新開啟菜單。' });
      const items = [1, 2, 3, 4, 5, 6].map(quantity => ({
        type: 'action', action: { type: 'message', label: `${quantity} 份`, text: `商品數量:${product.id}:${quantity}` }
      }));
      return reply(event.replyToken, { type: 'text', text: `請選擇「${product.name}」的數量`, quickReply: { items } });
    }

    if (text.startsWith('商品數量:')) {
      const [, productId, rawQuantity] = text.split(':');
      const product = products.find(item => item.id === productId);
      const quantity = Number(rawQuantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1) {
        return reply(event.replyToken, { type: 'text', text: '商品或數量無效，請重新開啟菜單。' });
      }
      cart[product.id] = (cart[product.id] || 0) + quantity;
      const current = cartSummary(cart, products);
      return reply(event.replyToken, {
        type: 'text', text: `🛒 已加入 ${product.name} x ${quantity}\n\n${current.summary}\n總計：${current.total} 元`,
        quickReply: { items: [
          { type: 'action', action: { type: 'message', label: '繼續選購', text: '菜單' } },
          { type: 'action', action: { type: 'message', label: '確認結帳', text: '結帳' } }
        ]}
      });
    }

    if (text === '結帳') {
      const current = cartSummary(cart, products);
      if (!current.items.length) return reply(event.replyToken, { type: 'text', text: '購物車目前是空的，請輸入「菜單」。' });
      const order = await store.createOrder({ line_user_id: userId, ...current });
      const time = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      await sheets.saveOrder({ time, ...order })
        .catch(error => console.error('❌ 寫入 Google Sheets 失敗：', error));
      await notifyNewOrder(order).catch(error => console.error('❌ 店家 LINE 新訂單通知失敗：', error));
      carts.set(userId, {});
      return reply(event.replyToken, {
        type: 'text',
        text: `🎉 訂單已送出\n訂單編號：${order.id.slice(0, 8)}\n${current.summary}\n總計：${current.total} 元\n\n店家確認後會再通知您。`
      });
    }

    return reply(event.replyToken, { type: 'text', text: '您好！輸入「菜單」即可開始選購。' });
  }

  async function notifyOrderStatus(order) {
    const text = STATUS_TEXT[order.status];
    if (!text || !order.line_user_id) return;
    await client.pushMessage({ to: order.line_user_id, messages: [{ type: 'text', text: `${text}\n訂單編號：${order.id.slice(0, 8)}` }] });
  }

  async function notifyPaymentStatus(order) {
    const text = PAYMENT_TEXT[order.payment_status];
    if (!text || !order.line_user_id) return;
    await client.pushMessage({ to: order.line_user_id, messages: [{ type: 'text', text: `${text}\n訂單編號：${order.id.slice(0, 8)}` }] });
  }

  async function notifyPaymentSubmitted(order) {
    const settings = await store.getSettings();
    if (!settings.merchant_line_user_id) return;
    await client.pushMessage({
      to: settings.merchant_line_user_id,
      messages: [{
        type: 'text',
        text: `💳 客戶已回填匯款末五碼\n訂單：#${order.id.slice(0, 8)}\n末五碼：${order.transfer_last5}\n金額：NT$ ${order.total}`
      }]
    });
  }

  async function notifyNewOrder(order) {
    const settings = await store.getSettings();
    if (!settings.merchant_line_user_id) return;
    const customer = order.customer_name || 'LINE 客戶';
    const details = [order.phone, order.fulfillment, order.pickup_time, order.note].filter(Boolean).join(' · ');
    const statusButton = (label, status, color) => ({
      type: 'button', style: 'primary', color, height: 'sm', margin: 'sm',
      action: {
        type: 'postback', label, displayText: `${label} #${order.id.slice(0, 8)}`,
        data: `action=orderStatus&orderId=${order.id}&status=${status}`
      }
    });
    await client.pushMessage({
      to: settings.merchant_line_user_id,
      messages: [{
        type: 'flex', altText: `新訂單 #${order.id.slice(0, 8)}｜${order.payment_method === 'quote' || order.quote_status === 'requested' ? '客製詢價待報價' : `NT$ ${order.total}`}`,
        contents: {
          type: 'bubble',
          header: { type: 'box', layout: 'vertical', backgroundColor: '#172038', paddingAll: '18px', contents: [
            { type: 'text', text: '🔔 新訂單', color: '#ffffff', weight: 'bold', size: 'lg' },
            { type: 'text', text: `#${order.id.slice(0, 8)}`, color: '#aeb9d4', size: 'sm', margin: 'xs' }
          ]},
          body: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: order.summary, weight: 'bold', size: 'md', wrap: true },
            { type: 'text', text: order.payment_method === 'quote' || order.quote_status === 'requested' ? '客製詢價｜待報價' : `NT$ ${order.total}`, color: '#f25b2b', weight: 'bold', size: 'xl', margin: 'md' },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: customer, margin: 'lg', weight: 'bold' },
            { type: 'text', text: details || '未填寫其他資料', color: '#73798a', size: 'sm', wrap: true, margin: 'xs' }
            ,{ type: 'text', text: `付款：${order.payment_method === 'bank_transfer' ? '銀行轉帳' : order.payment_method === 'quote' ? '客製詢價' : '現金取貨'}`, color: '#73798a', size: 'sm', margin: 'xs' }
          ]},
          footer: { type: 'box', layout: 'vertical', contents: [
            statusButton('確認訂單', 'confirmed', '#2457d6'),
            statusButton('製作中', 'preparing', '#8b5cf6'),
            statusButton('可取貨', 'ready', '#e87817'),
            statusButton('完成訂單', 'completed', '#238653')
            ,...(order.payment_method === 'bank_transfer' ? [{
              type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
              action: { type: 'postback', label: '確認已收款', displayText: `確認收款 #${order.id.slice(0, 8)}`, data: `action=paymentStatus&orderId=${order.id}&status=paid` }
            }] : [])
          ]}
        }
      }]
    });
  }

  async function verifyConnection() { if (typeof client.getBotInfo !== 'function') return true; return client.getBotInfo(); }
  return { config, middleware: line.middleware(config), handleEvent, notifyOrderStatus, notifyNewOrder, notifyPaymentStatus, notifyPaymentSubmitted, verifyConnection };
}

module.exports = { createBot };
