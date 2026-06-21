const statusText={new:'新訂單',confirmed:'已確認',preparing:'製作中',ready:'可取貨',completed:'已完成',cancelled:'已取消'};
const paymentText={unpaid:'未付款',pending:'匯款待核對',paid:'已付款',refunded:'已退款'};
const escapeHtml=(value='')=>String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const code=new URLSearchParams(location.search).get('code');
const merchantSlug=new URLSearchParams(location.search).get('store')||'';
const shopHeaders=merchantSlug?{'X-Merchant-Slug':merchantSlug}:{};
document.querySelector('#returnShop').href=merchantSlug?`/shop/${encodeURIComponent(merchantSlug)}/`:'/shop/';

async function submitLast5(event){
  event.preventDefault();
  const last5=document.querySelector('#last5').value.trim();
  const error=document.querySelector('#paymentError');
  error.textContent='';
  try{
    const response=await fetch(`/api/shop/orders/${encodeURIComponent(code)}/payment`,{method:'POST',cache:'no-store',headers:{...shopHeaders,'Content-Type':'application/json'},body:JSON.stringify({transfer_last5:last5})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'送出失敗');
    await load();
  }catch(reason){error.textContent=reason.message;}
}

async function load(){
  if(!code){document.querySelector('#content').innerHTML='<p>缺少訂單查詢碼。</p>';return;}
  try{
    const response=await fetch(`/api/shop/orders/${encodeURIComponent(code)}/status`,{cache:'no-store',headers:shopHeaders});
    const order=await response.json();
    if(!response.ok)throw new Error(order.error||'查詢失敗');
    const paymentForm=order.payment_method==='bank_transfer'&&!['paid','refunded'].includes(order.payment_status)?`<form id="paymentForm"><label>匯款帳號末五碼<input id="last5" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" value="${escapeHtml(order.transfer_last5||'')}" required></label><button type="submit">送出末五碼</button><p id="paymentError" class="error"></p></form>`:'';
    document.querySelector('#content').innerHTML=`<div class="number">#${escapeHtml(order.id.slice(0,8))}</div><p class="summary">${escapeHtml(order.summary)}</p><p class="price">NT$ ${Number(order.total).toLocaleString('zh-TW')}</p><p><span class="status">${escapeHtml(statusText[order.status]||order.status)}</span> <span class="payment">${escapeHtml(paymentText[order.payment_status]||order.payment_status)}</span></p><p class="line-ok">${order.claimed?'✓ 已連結 LINE 訂單通知':'尚未連結 LINE 通知'}</p>${paymentForm}`;
    document.querySelector('#paymentForm')?.addEventListener('submit',submitLast5);
  }catch(error){document.querySelector('#content').innerHTML=`<p>${escapeHtml(error.message)}</p>`;}
}

load();setInterval(load,15000);
