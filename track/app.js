const statusText = { new: '新訂單', confirmed: '已確認', preparing: '製作中', ready: '可取貨', completed: '已完成', cancelled: '已取消' };
const paymentText = { unpaid: '未付款', pending: '匯款待核對', paid: '已付款', refunded: '已退款' };
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const code = new URLSearchParams(location.search).get('code');
const merchantSlug = new URLSearchParams(location.search).get('store') || '';
const shopHeaders = merchantSlug ? { 'X-Merchant-Slug': merchantSlug } : {};
const state = { editing: false };
document.querySelector('#returnShop').href = merchantSlug ? `/shop/${encodeURIComponent(merchantSlug)}/` : '/shop/';

async function resizeImage(file) {
  if (typeof createImageBitmap !== 'function') return readFileAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('照片處理失敗')), 'image/webp', 0.82));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('照片讀取失敗'));
    reader.readAsDataURL(blob);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('照片讀取失敗'));
    reader.readAsDataURL(file);
  });
}

function markEditing() { state.editing = true; }
function hasDraft() {
  const text = document.querySelector('#messageText')?.value.trim();
  const image = document.querySelector('#messageImage')?.files?.length;
  const last5 = document.querySelector('#last5')?.value.trim();
  const active = document.activeElement;
  const editingNow = active && active.closest && active.closest('#content') && active.matches('input,textarea');
  return Boolean(state.editing || text || image || last5 || editingNow);
}

async function submitLast5(event) {
  event.preventDefault();
  const last5 = document.querySelector('#last5').value.trim();
  const error = document.querySelector('#paymentError');
  error.textContent = '';
  try {
    const response = await fetch(`/api/shop/orders/${encodeURIComponent(code)}/payment`, { method: 'POST', cache: 'no-store', headers: { ...shopHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ transfer_last5: last5 }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '送出失敗');
    state.editing = false;
    await load();
  } catch (reason) { error.textContent = reason.message; }
}

async function submitMessage(event) {
  event.preventDefault();
  const error = document.querySelector('#messageError');
  const button = document.querySelector('#messageSubmit');
  error.textContent = '';
  button.disabled = true;
  const original = button.textContent;
  try {
    let imageUrl = '';
    const file = document.querySelector('#messageImage').files[0];
    if (file) {
      button.textContent = '照片上傳中…';
      const upload = await fetch('/api/shop/images', { method: 'POST', cache: 'no-store', headers: { ...shopHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: await resizeImage(file) }) });
      const uploaded = await upload.json();
      if (!upload.ok) throw new Error(uploaded.error || '照片上傳失敗');
      imageUrl = uploaded.url;
    }
    button.textContent = '送出中…';
    const response = await fetch(`/api/shop/orders/${encodeURIComponent(code)}/messages`, { method: 'POST', cache: 'no-store', headers: { ...shopHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: document.querySelector('#messageText').value, image_url: imageUrl }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '送出失敗');
    state.editing = false;
    event.target.reset();
    await load();
  } catch (reason) { error.textContent = reason.message; } finally { button.disabled = false; button.textContent = original; }
}

function renderMessages(messages = []) {
  return `<section class="messages"><h2>與店家溝通</h2>${messages.length ? messages.map(message => `<div class="message ${message.author === 'merchant' ? 'merchant' : ''}"><small>${message.author === 'merchant' ? '店家' : '您'} · ${new Date(message.created_at).toLocaleString('zh-TW')}</small>${message.text ? `<p>${escapeHtml(message.text)}</p>` : ''}${message.image_url ? `<a href="${escapeHtml(message.image_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(message.image_url)}" alt="溝通照片"></a>` : ''}</div>`).join('') : '<p class="hint">還沒有留言。若是客製商品，可以在這裡補充文字或參考照片。</p>'}<form id="messageForm"><label>留言<textarea id="messageText" rows="3" maxlength="600" placeholder="例如：這是我想要的風格，或補充尺寸、顏色、日期"></textarea></label><label>參考照片<input id="messageImage" type="file" accept="image/*"></label><button id="messageSubmit" type="submit">送出留言／照片</button><p class="hint">送出後，店家會在後台看到；若店家有綁 LINE，也會收到提醒。</p><p id="messageError" class="error"></p></form></section>`;
}

function renderPaymentInfo(info) {
  if (!info || !info.bank_account) return '';
  return `<section class="payment-info"><b>匯款資料</b><p>${escapeHtml(info.bank_name || '')}${info.bank_code ? `（${escapeHtml(info.bank_code)}）` : ''}<br><strong>帳號：${escapeHtml(info.bank_account)}</strong><br>戶名：${escapeHtml(info.bank_account_name || '')}${info.instructions ? `<br>${escapeHtml(info.instructions)}` : ''}</p></section>`;
}

async function load() {
  if (!code) { document.querySelector('#content').innerHTML = '<p>缺少訂單查詢碼。</p>'; return; }
  try {
    const response = await fetch(`/api/shop/orders/${encodeURIComponent(code)}/status`, { cache: 'no-store', headers: shopHeaders });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || '查詢失敗');
    const isQuote = order.quote_status === 'requested' || order.quote_status === 'quoted';
    const canSubmitLast5 = !['paid', 'refunded'].includes(order.payment_status) && (order.payment_method === 'bank_transfer' || (order.payment_method === 'quote' && order.quote_status === 'quoted'));
    const paymentForm = canSubmitLast5 ? `<form id="paymentForm"><label>${order.payment_method === 'quote' ? '已匯款帳號末五碼' : '匯款帳號末五碼'}<input id="last5" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" value="${escapeHtml(order.transfer_last5 || '')}" placeholder="例如：12345" required></label><button type="submit">送出末五碼給店家</button><p class="hint">送出後，店家會收到匯款核對提醒。</p><p id="paymentError" class="error"></p></form>` : '';
    const quoteBlock = isQuote ? `<p class="summary">詢價狀態：${order.quote_status === 'quoted' ? '已報價，請依店家說明付款' : '等待店家報價'}</p>${order.quote_note ? `<p>${escapeHtml(order.quote_note)}</p>` : ''}` : '';
    document.querySelector('#content').innerHTML = `<div class="number">#${escapeHtml(order.id.slice(0, 8))}</div><p class="summary">${escapeHtml(order.summary)}</p><p class="price">${order.quote_status === 'requested' ? '待報價' : `NT$ ${Number(order.total).toLocaleString('zh-TW')}`}</p>${quoteBlock}<p><span class="status">${escapeHtml(statusText[order.status] || order.status)}</span> <span class="payment">${isQuote ? '客製詢價' : escapeHtml(paymentText[order.payment_status] || order.payment_status)}</span></p><p class="line-ok">${order.claimed ? '✓ 已連結 LINE 訂單通知' : '尚未連結 LINE 通知'}</p>${paymentForm ? renderPaymentInfo(order.payment_info) : ''}${paymentForm}${renderMessages(order.order_messages || [])}`;
    document.querySelector('#paymentForm')?.addEventListener('submit', submitLast5);
    document.querySelector('#messageForm')?.addEventListener('submit', submitMessage);
    document.querySelector('#content')?.addEventListener('input', markEditing);
    document.querySelector('#content')?.addEventListener('change', markEditing);
  } catch (error) { document.querySelector('#content').innerHTML = `<p>${escapeHtml(error.message)}</p>`; }
}

load();
setInterval(() => { if (!document.hidden && !hasDraft()) load(); }, 15000);
