const state = { products: [], cart: {}, acceptingOrders: true, lineAccessToken: null, config: null };
const $ = selector => document.querySelector(selector);
const money = value => `NT$ ${Number(value || 0).toLocaleString('zh-TW')}`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const merchantSlug = location.pathname.split('/').filter(Boolean)[1] || '';

async function initLine(liffId) {
  if (!liffId || typeof liff === 'undefined') return;
  try {
    await liff.init({ liffId });
    if (liff.isInClient() && !liff.isLoggedIn()) { liff.login(); return; }
    if (liff.isLoggedIn()) state.lineAccessToken = liff.getAccessToken();
  } catch (error) { console.error('LINE LIFF 初始化失敗', error); }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  if (typeof input === 'string' && input.startsWith('/api/shop')) options = { ...options, cache: 'no-store' };
  if (merchantSlug && typeof input === 'string' && input.startsWith('/api/shop')) options = { ...options, headers: { ...options.headers, 'X-Merchant-Slug': merchantSlug } };
  if (input === '/api/shop/orders' && state.lineAccessToken) options = { ...options, headers: { ...options.headers, 'X-Line-Access-Token': state.lineAccessToken } };
  return nativeFetch(input, options);
};

function fulfillmentOptions(products = []) {
  const enabled = (state.config?.fulfillment_options || []).filter(item => item.enabled !== false);
  if (!products.length) return enabled;
  return enabled.filter(option => products.every(product => !Array.isArray(product.fulfillment_ids) || !product.fulfillment_ids.length || product.fulfillment_ids.includes(option.id)));
}

function renderFulfillmentChoices(targetId, products = []) {
  const options = fulfillmentOptions(products);
  $(targetId).innerHTML = options.length ? options.map((item, index) => `<label><input type="radio" name="${targetId}" value="${escapeHtml(item.id)}" ${index === 0 ? 'checked' : ''}> ${escapeHtml(item.label)}</label>`).join('') : '<p class="choice-empty">這項商品目前沒有可用取貨方式，請聯絡店家。</p>';
  return options.length;
}

function configureCheckout(config) {
  const fields = config.checkout_fields || {};
  [['customer_name', 'customerNameField', 'customerNameLabel', 'customerName'], ['phone', 'phoneField', 'phoneLabel', 'phone'], ['pickup_time', 'pickupTimeField', 'pickupTimeLabel', 'pickupTime'], ['note', 'noteField', 'noteLabel', 'note']].forEach(([key, fieldId, labelId, inputId]) => {
    const field = fields[key] || {};
    const enabled = field.enabled !== false;
    const wrapper = $(`#${fieldId}`);
    wrapper.hidden = !enabled;
    $(`#${labelId}`).textContent = field.label || $(`#${labelId}`).textContent;
    $(`#${inputId}`).required = enabled && field.required === true;
  });
  renderFulfillmentChoices('#fulfillmentChoices');
  renderFulfillmentChoices('#quoteFulfillmentChoices');
}

async function loadConfig() {
  try {
    const response = await fetch('/api/shop/config');
    if (!response.ok) throw new Error('店家資料載入失敗');
    const config = await response.json();
    state.config = config;
    await initLine(config.liff_id);
    document.title = `${config.store_name}｜線上點餐`;
    $('#storeName').textContent = config.store_name;
    $('#tagline').textContent = config.tagline;
    $('#storeDescription').textContent = config.description;
    if (config.logo_url) { $('#storeLogo').src = config.logo_url; $('#storeLogo').hidden = false; }
    if (config.hero_image_url) $('#hero').style.backgroundImage = `linear-gradient(90deg,rgba(29,22,19,.82),rgba(29,22,19,.15)),url("${config.hero_image_url.replace(/["\\]/g, '')}")`;
    state.acceptingOrders = config.accepting_orders !== false;
    $('#closedNotice').hidden = state.acceptingOrders;
    $('#platformBrand').hidden = config.platform_branding === false;
    $('#platformBrand').href = config.platform_sales_url || '/admin/';
    configureCheckout(config);
    $('#cashChoice').hidden = config.cash_enabled === false;
    $('#bankChoice').hidden = config.bank_transfer_enabled === false;
    if (config.cash_enabled === false) $('#cashChoice input').disabled = true;
    if (config.bank_transfer_enabled === false) $('#bankChoice input').disabled = true;
    (document.querySelector('[name="paymentMethod"]:not(:disabled)'))?.click();
    const details = [config.phone && `電話：${config.phone}`, config.address && `地址：${config.address}`, config.business_hours && `營業時間：${config.business_hours}`].filter(Boolean);
    $('#storeInfo').innerHTML = details.map(item => `<span>${escapeHtml(item)}</span>`).join('');
  } catch (error) { console.error(error); }
}

async function loadProducts() {
  try {
    const response = await fetch('/api/shop/products');
    if (!response.ok) throw new Error('菜單載入失敗');
    state.products = await response.json();
    renderProducts();
  } catch (error) { $('#productList').innerHTML = `<div class="empty">${escapeHtml(error.message)}，請稍後再試。</div>`; }
}

function renderProducts() {
  const list = $('#productList');
  list.innerHTML = state.products.length ? state.products.map(product => {
    const isQuote = product.product_type === 'quote';
    return `<article class="product"><img src="${escapeHtml(product.image_url || 'https://images.unsplash.com/photo-1547592180-85f173990554?w=600')}" alt="${escapeHtml(product.name)}"><div class="product-info"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description || '今日新鮮供應')}</p><div class="product-bottom"><strong>${isQuote ? '客製詢價' : money(product.price)}</strong><button class="add ${isQuote ? 'quote-add' : ''}" data-id="${product.id}" aria-label="${isQuote ? '詢價' : '加入'} ${escapeHtml(product.name)}" ${state.acceptingOrders ? '' : 'disabled'}>${isQuote ? '詢價' : '＋'}</button></div></div></article>`;
  }).join('') : '<div class="empty">目前沒有販售中的商品。</div>';
  document.querySelectorAll('.add').forEach(button => button.addEventListener('click', () => {
    if (!state.acceptingOrders) return;
    const product = state.products.find(item => item.id === button.dataset.id);
    if (!product) return;
    if (product.product_type === 'quote') return openQuote(product);
    state.cart[product.id] = (state.cart[product.id] || 0) + 1;
    renderCart();
    button.textContent = '✓';
    setTimeout(() => { button.textContent = '＋'; }, 500);
  }));
}

function cartRows() {
  return Object.entries(state.cart).map(([id, quantity]) => ({ product: state.products.find(product => product.id === id), quantity })).filter(row => row.product && row.quantity > 0);
}

function total() {
  return cartRows().reduce((sum, row) => sum + Number(row.product.price) * row.quantity, 0);
}

function renderCart() {
  const rows = cartRows();
  const hasFulfillment = renderFulfillmentChoices('#fulfillmentChoices', rows.map(row => row.product));
  $('#cartCount').textContent = rows.reduce((sum, row) => sum + row.quantity, 0);
  $('#cartTotal').textContent = money(total());
  $('#checkoutTotal').textContent = money(total());
  $('#cartItems').innerHTML = rows.length ? rows.map(({ product, quantity }) => `<div class="cart-row"><div><strong>${escapeHtml(product.name)}</strong><p>${money(product.price)} × ${quantity}</p></div><div class="quantity"><button data-action="minus" data-id="${product.id}">−</button><b>${quantity}</b><button data-action="plus" data-id="${product.id}">＋</button></div></div>`).join('') : '<div class="empty">購物車還是空的。</div>';
  $('#startCheckout').disabled = !rows.length || !state.acceptingOrders || !hasFulfillment;
  document.querySelectorAll('.quantity button').forEach(button => button.addEventListener('click', () => {
    state.cart[button.dataset.id] = (state.cart[button.dataset.id] || 0) + (button.dataset.action === 'plus' ? 1 : -1);
    if (state.cart[button.dataset.id] <= 0) delete state.cart[button.dataset.id];
    renderCart();
  }));
}

function toggleCart(open) {
  $('#cartSheet').classList.toggle('open', open);
  $('#cartSheet').setAttribute('aria-hidden', String(!open));
}

function openQuote(product) {
  $('#quoteForm').reset();
  $('#quoteError').textContent = '';
  $('#quoteProductId').value = product.id;
  $('#quoteProductName').textContent = product.name;
  $('#quoteRequest').placeholder = product.quote_prompt || '請寫下尺寸、口味、顏色、數量、預算、交貨日期、想放的文字或其他需求';
  renderFulfillmentChoices('#quoteFulfillmentChoices', [product]);
  $('#quoteDialog').showModal();
}

function selectedFulfillment(selector) {
  return document.querySelector(`${selector} input:checked`)?.value;
}

function showSuccess(result) {
  const isQuote = result.quote_required || result.payment_method === 'quote';
  const isBankTransfer = result.payment_method === 'bank_transfer';
  $('#successText').textContent = isQuote ? `詢價單編號 ${result.id.slice(0, 8)} 已送出，店家報價後會再與您確認。` : `訂單編號 ${result.id.slice(0, 8)}，金額 ${money(result.total)}。付款方式：${isBankTransfer ? '銀行轉帳' : '現金取貨'}。`;
  const info = result.payment_info;
  const paymentBox = $('#paymentInfo');
  paymentBox.innerHTML = info ? `<strong>請匯款至以下帳戶</strong><br>${escapeHtml(info.bank_name || '')}（${escapeHtml(info.bank_code || '')}）<br><b>帳號：${escapeHtml(info.bank_account || '')}</b><br>戶名：${escapeHtml(info.bank_account_name || '')}${info.instructions ? `<br>${escapeHtml(info.instructions)}` : ''}` : '';
  paymentBox.toggleAttribute('hidden', !info);
  const claimMessage = `確認訂單 ${result.claim_code || ''}`;
  $('#claimBox').hidden = !result.line_confirm_url;
  $('#claimMessage').textContent = claimMessage;
  $('#copyClaim').dataset.message = claimMessage;
  $('#lineConfirm').hidden = !result.line_confirm_url;
  $('#lineConfirm').href = result.line_confirm_url || '#';
  $('#trackOrder').href = result.tracking_url || '#';
  $('#successDialog').showModal();
}

$('#openCart').addEventListener('click', () => toggleCart(true));
$('#closeCart').addEventListener('click', () => toggleCart(false));
$('#sheetBackdrop').addEventListener('click', () => toggleCart(false));
$('#startCheckout').addEventListener('click', () => { toggleCart(false); $('#checkoutDialog').showModal(); });
$('#closeCheckout').addEventListener('click', () => $('#checkoutDialog').close());
$('#closeQuote').addEventListener('click', () => $('#quoteDialog').close());

$('#checkoutForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#submitOrder');
  const body = { customer_name: $('#customerName').value, phone: $('#phone').value, fulfillment: selectedFulfillment('#fulfillmentChoices'), payment_method: document.querySelector('[name="paymentMethod"]:checked')?.value, pickup_time: $('#pickupTime').value, note: $('#note').value, items: cartRows().map(row => ({ product_id: row.product.id, quantity: row.quantity })) };
  $('#checkoutError').textContent = '';
  button.disabled = true;
  button.textContent = '送出中…';
  try {
    const response = await fetch('/api/shop/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '送出失敗');
    $('#checkoutDialog').close();
    showSuccess(result);
    state.cart = {};
    renderCart();
    event.target.reset();
  } catch (error) { $('#checkoutError').textContent = error.message; } finally { button.disabled = false; button.textContent = '送出訂單'; }
});

$('#quoteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#submitQuote');
  const body = { customer_name: $('#quoteCustomerName').value, phone: $('#quotePhone').value, fulfillment: selectedFulfillment('#quoteFulfillmentChoices'), payment_method: 'quote', pickup_time: $('#quotePickupTime').value, note: $('#quoteNote').value, quote_request: $('#quoteRequest').value, items: [{ product_id: $('#quoteProductId').value, quantity: 1 }] };
  $('#quoteError').textContent = '';
  button.disabled = true;
  button.textContent = '送出中…';
  try {
    const response = await fetch('/api/shop/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '送出失敗');
    $('#quoteDialog').close();
    showSuccess(result);
    event.target.reset();
  } catch (error) { $('#quoteError').textContent = error.message; } finally { button.disabled = false; button.textContent = '送出詢價'; }
});

$('#copyClaim').addEventListener('click', async event => {
  const text = event.currentTarget.dataset.message || '';
  try { await navigator.clipboard.writeText(text); } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  event.currentTarget.textContent = '已複製，請到 LINE 貼上';
  setTimeout(() => { event.currentTarget.textContent = '複製確認訊息'; }, 2200);
});

$('#finishOrder').addEventListener('click', () => $('#successDialog').close());

Promise.all([loadConfig(), loadProducts()]).then(() => { renderProducts(); renderCart(); });
