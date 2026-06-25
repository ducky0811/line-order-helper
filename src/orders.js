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
    const isQuoteProduct = product?.product_type === 'quote';
    const quantity = Number(row.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) continue;
    if (product.stock != null && quantity > product.stock) {
      throw new Error(`「${product.name}」庫存只剩 ${product.stock} 份`);
    }
    items.push({
      product_id: product.id,
      name: product.name,
      product_type: isQuoteProduct ? 'quote' : 'fixed',
      fulfillment_ids: Array.isArray(product.fulfillment_ids) ? product.fulfillment_ids : [],
      price: isQuoteProduct ? 0 : Number(product.price),
      quantity,
      subtotal: isQuoteProduct ? 0 : Number(product.price) * quantity
    });
  }

  if (!items.length) throw new Error('購物車沒有可結帳的商品');
  const quoteRequired = items.some(item => item.product_type === 'quote');
  if (quoteRequired && items.some(item => item.product_type !== 'quote')) throw new Error('客製詢價商品請獨立送出需求，不要與固定商品一起結帳');
  const fields = settings.checkout_fields || {};
  const customerName = cleanText(input.customer_name, 60);
  const phone = cleanText(input.phone, 30);
  const pickupTime = cleanText(input.pickup_time, 60);
  const note = cleanText(input.note, 300);
  if (fields.customer_name?.enabled !== false && fields.customer_name?.required && !customerName) throw new Error(`請填寫${fields.customer_name.label || '取貨人姓名'}`);
  if (fields.phone?.enabled !== false && fields.phone?.required && !phone) throw new Error(`請填寫${fields.phone.label || '聯絡電話'}`);
  if (fields.pickup_time?.enabled !== false && fields.pickup_time?.required && !pickupTime) throw new Error(`請填寫${fields.pickup_time.label || '希望取貨時間'}`);
  if (fields.note?.enabled !== false && fields.note?.required && !note) throw new Error(`請填寫${fields.note.label || '備註'}`);
  const fulfillmentOptions = (settings.fulfillment_options || [{ id: 'pickup', label: '到店取貨', enabled: true }]).filter(item => item.enabled !== false);
  const allowedFulfillmentOptions = fulfillmentOptions.filter(option => items.every(item => !item.fulfillment_ids?.length || item.fulfillment_ids.includes(option.id)));
  if (!allowedFulfillmentOptions.length) throw new Error('此商品目前沒有可用的取貨方式，請聯絡店家');
  const selectedFulfillment = allowedFulfillmentOptions.find(item => item.id === input.fulfillment) || allowedFulfillmentOptions[0];
  if (!selectedFulfillment) throw new Error('店家尚未設定取貨方式');
  const enabledMethods = [];
  if (settings.cash_enabled) enabledMethods.push('cash');
  if (settings.bank_transfer_enabled) enabledMethods.push('bank_transfer');
  if (!quoteRequired && !enabledMethods.length) throw new Error('店家尚未開放付款方式');
  const paymentMethod = quoteRequired ? 'quote' : (enabledMethods.includes(input.payment_method) ? input.payment_method : enabledMethods[0]);
  if (!quoteRequired && paymentMethod === 'bank_transfer' && !settings.bank_account) throw new Error('店家尚未設定銀行帳號');
  const total = items.reduce((sum, item) => sum + item.subtotal, 0);
  const quoteRequest = cleanText(input.quote_request, 600);
  if (quoteRequired && !quoteRequest) throw new Error('請填寫客製需求，方便店家報價');

  return {
    line_user_id: cleanText(input.line_user_id, 100) || null,
    customer_name: fields.customer_name?.enabled === false ? '' : customerName,
    phone: fields.phone?.enabled === false ? '' : phone,
    fulfillment: selectedFulfillment.label,
    pickup_time: fields.pickup_time?.enabled === false ? '' : pickupTime,
    note: fields.note?.enabled === false ? '' : note,
    payment_method: paymentMethod,
    quote_status: quoteRequired ? 'requested' : 'none',
    quote_request: quoteRequired ? quoteRequest : '',
    quote_amount: null,
    quote_note: '',
    items,
    summary: items.map(item => `${item.name}x${item.quantity}${item.product_type === 'quote' ? '（待報價）' : ''}`).join('、'),
    total
  };
}

module.exports = { buildOrder };
