function cleanText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

async function buildOrder(store, input = {}) {
  const products = await store.listProducts({ activeOnly: true });
  const settings = await store.getSettings();
  const requested = Array.isArray(input.items) ? input.items : [];
  const items = [];

  for (const row of requested) {
    const product = products.find(item => item.id === row.product_id);
    const quantity = Number(row.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) continue;
    if (product.stock != null && quantity > product.stock) {
      throw new Error(`「${product.name}」庫存只剩 ${product.stock} 份`);
    }
    items.push({
      product_id: product.id,
      name: product.name,
      price: Number(product.price),
      quantity,
      subtotal: Number(product.price) * quantity
    });
  }

  if (!items.length) throw new Error('購物車沒有可結帳的商品');
  const customerName = cleanText(input.customer_name, 60);
  const phone = cleanText(input.phone, 30);
  if (!customerName) throw new Error('請填寫取貨人姓名');
  if (!phone) throw new Error('請填寫聯絡電話');
  const fulfillment = ['pickup', 'delivery'].includes(input.fulfillment) ? input.fulfillment : 'pickup';
  const enabledMethods = [];
  if (settings.cash_enabled) enabledMethods.push('cash');
  if (settings.bank_transfer_enabled) enabledMethods.push('bank_transfer');
  if (!enabledMethods.length) throw new Error('店家尚未開放付款方式');
  const paymentMethod = enabledMethods.includes(input.payment_method) ? input.payment_method : enabledMethods[0];
  if (paymentMethod === 'bank_transfer' && !settings.bank_account) throw new Error('店家尚未設定銀行帳號');
  const total = items.reduce((sum, item) => sum + item.subtotal, 0);

  return {
    line_user_id: cleanText(input.line_user_id, 100) || null,
    customer_name: customerName,
    phone,
    fulfillment,
    pickup_time: cleanText(input.pickup_time, 60),
    note: cleanText(input.note, 300),
    payment_method: paymentMethod,
    items,
    summary: items.map(item => `${item.name}x${item.quantity}`).join('、'),
    total
  };
}

module.exports = { buildOrder };
