const state = { token: localStorage.getItem('adminToken'), products: [], orders: [], report: null, fulfillmentOptions: [], orderView: 'active', orderStatus: 'all', orderQuery: '', reportRange: 'month', activeTab: 'products', account: null, lineIntegration: null, sheetIntegration: null, lineStep: 1 };
const $ = selector => document.querySelector(selector);
const statusLabels = { new:'新訂單',confirmed:'已確認',preparing:'製作中',ready:'可取貨',completed:'已完成',cancelled:'已取消' };
const paymentLabels = { unpaid:'未付款',pending:'待核對',paid:'已付款',refunded:'已退款' };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${state.token || ''}`, ...options.headers }
  });
  const data = response.status === 204 ? null : await response.json();
  if (response.status === 401 && path !== '/api/admin/login') logout();
  if (!response.ok) throw new Error(data?.error || '操作失敗');
  return data;
}

function toast(text) { const el=$('#toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); }
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function paymentMethodLabel(value){return value==='bank_transfer'?'銀行轉帳':value==='quote'?'客製詢價':'現金取貨';}
function clearMerchantView(){state.products=[];state.orders=[];state.report=null;state.fulfillmentOptions=[];state.account=null;state.lineIntegration=null;state.lineStep=1;state.activeTab='products';state.orderView='active';state.orderStatus='all';state.orderQuery='';state.reportRange='month';$('#productList').innerHTML='<div class="empty">正在載入這間店的商品…</div>';$('#orderList').innerHTML='<div class="empty">正在載入這間店的訂單…</div>';$('#reportCards').innerHTML='';$('#orderSearch').value='';$('#reportRange').value='month';$('#settingsForm').reset();updateBrandPreview('logo');updateBrandPreview('hero');$('#accountSummary').textContent='';document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.tab==='products'));$('#productsPanel').hidden=false;$('#ordersPanel').hidden=true;$('#reportsPanel').hidden=true;$('#settingsPanel').hidden=true;document.querySelectorAll('.order-filter').forEach(button=>button.classList.toggle('active',button.dataset.view==='active'));}
function showApp() { clearMerchantView();$('#loginView').hidden=true; $('#registerView').hidden=true; $('#appView').hidden=false; loadProducts(); loadAccount(); }
function logout() { localStorage.removeItem('adminToken'); state.token=null;clearMerchantView();$('#appView').hidden=true; $('#registerView').hidden=true; $('#loginView').hidden=false; }
async function loadAccount(){try{state.account=await api('/api/admin/account');const merchant=state.account.merchant;if(!merchant){$('#accountSummary').textContent='既有測試商店';return;}const until=new Date(merchant.expires_at||merchant.trial_ends_at).toLocaleDateString('zh-TW');const retention=state.account.retention?.retention_days;$('#accountSummary').innerHTML=`方案：${escapeHtml(state.account.capabilities?.label||merchant.plan)} · 到期日：${escapeHtml(until)}${retention?` · 訂單保存 ${retention>=365?`${Math.round(retention/365)} 年`:`${retention} 天`}`:''} · <a href="${escapeHtml(state.account.shop_url)}" target="_blank">開啟商店</a>`;}catch(error){toast(error.message);}}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#loginError').textContent='';
  try {
    const result=await api('/api/admin/login',{method:'POST',body:JSON.stringify({email:$('#loginEmail').value,password:$('#password').value})});
    state.token=result.token; localStorage.setItem('adminToken',result.token); showApp();
  } catch(error) { $('#loginError').textContent=error.message; }
});
$('#logoutButton').addEventListener('click',logout);
function showRegisterView(){$('#loginView').hidden=true;$('#registerView').hidden=false;window.scrollTo({top:0,behavior:'smooth'});}
document.addEventListener('click',event=>{if(event.target.closest('[data-show-register]'))showRegisterView();});
$('#showLogin').addEventListener('click',()=>{$('#registerView').hidden=true;$('#loginView').hidden=false;});
$('#registerForm').addEventListener('submit',async event=>{event.preventDefault();$('#registerError').textContent='';const button=event.submitter;button.disabled=true;try{const result=await api('/api/admin/register',{method:'POST',body:JSON.stringify({store_name:$('#registerStoreName').value,slug:$('#registerSlug').value,email:$('#registerEmail').value,password:$('#registerPassword').value})});state.token=result.token;localStorage.setItem('adminToken',result.token);showApp();toast('商店建立成功，免費試用 14 天');}catch(error){$('#registerError').textContent=error.message;}finally{button.disabled=false;}});

document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===button));
  const selected=button.dataset.tab; state.activeTab=selected; $('#productsPanel').hidden=selected!=='products'; $('#ordersPanel').hidden=selected!=='orders'; $('#reportsPanel').hidden=selected!=='reports'; $('#settingsPanel').hidden=selected!=='settings';
  if(selected==='orders') loadOrders(); if(selected==='reports') loadReport(); if(selected==='settings'){loadSettings();loadLineIntegration();loadSheetsIntegration();}
}));

async function loadProducts() {
  try { state.products=await api('/api/admin/products'); renderProducts(); } catch(error) { toast(error.message); }
}
function renderProducts() {
  $('#productList').innerHTML=state.products.length?state.products.map(item=>`<article class="product-card" data-id="${item.id}">
    <img src="${escapeHtml(item.image_url || 'https://images.unsplash.com/photo-1547592180-85f173990554?w=600')}" alt="">
    <div class="product-body"><div class="product-top"><div><strong>${escapeHtml(item.name)}</strong><div class="price">${item.product_type==='quote'?'客製詢價':`NT$ ${item.price}`}</div></div><span class="pill ${item.active?'':'off'}">${item.active?'販售中':'已停售'}</span></div><p>${escapeHtml(item.description || '尚未填寫介紹')}</p></div>
  </article>`).join(''):'<div class="empty">尚未建立商品，點「新增商品」開始。</div>';
  document.querySelectorAll('.product-card').forEach(card=>card.addEventListener('click',()=>openProduct(state.products.find(item=>item.id===card.dataset.id))));
}

async function ensureFulfillmentOptions(){if(state.fulfillmentOptions.length)return;try{const settings=await api('/api/admin/settings');state.fulfillmentOptions=(settings.fulfillment_options||[]).map(item=>({...item}));}catch{state.fulfillmentOptions=[];}}
function renderProductFulfillmentOptions(product=null){const enabled=state.fulfillmentOptions.filter(item=>item.enabled!==false);const selected=Array.isArray(product?.fulfillment_ids)&&product.fulfillment_ids.length?product.fulfillment_ids:enabled.map(item=>item.id);$('#productFulfillmentOptions').innerHTML=enabled.length?enabled.map(item=>`<label class="compact-switch"><input type="checkbox" value="${escapeHtml(item.id)}" ${selected.includes(item.id)?'checked':''}>${escapeHtml(item.label)}</label>`).join(''):'<p class="field-help">請先到「店家設定」新增至少一種取貨方式。</p>';}
function readProductFulfillmentIds(){return [...document.querySelectorAll('#productFulfillmentOptions input:checked')].map(input=>input.value);}

async function openProduct(product=null) {
  await ensureFulfillmentOptions();
  $('#productForm').reset(); $('#formError').textContent=''; $('#productId').value=product?.id||''; $('#dialogTitle').textContent=product?'編輯商品':'新增商品';
  $('#name').value=product?.name||''; $('#productType').value=product?.product_type==='quote'?'quote':'fixed'; $('#price').value=product?.price??''; $('#stock').value=product?.stock??''; $('#description').value=product?.description||''; $('#quotePrompt').value=product?.quote_prompt||''; $('#imageUrl').value=product?.image_url||''; $('#active').checked=product?.active!==false; $('#deleteProduct').hidden=!product; toggleProductTypeFields();
  renderProductFulfillmentOptions(product);
  $('#imagePreview').src=product?.image_url||''; $('#imagePreview').hidden=!product?.image_url; $('#productDialog').showModal();
}
$('#addProduct').addEventListener('click',()=>openProduct()); $('#closeDialog').addEventListener('click',()=>$('#productDialog').close());
function toggleProductTypeFields(){const isQuote=$('#productType').value==='quote';$('#quotePromptField').hidden=!isQuote;$('#price').required=!isQuote;if(isQuote)$('#price').value=0;}
$('#productType').addEventListener('change',toggleProductTypeFields);
$('#imageFile').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;$('#imagePreview').src=URL.createObjectURL(file);$('#imagePreview').hidden=false;});

async function resizeImage(file) {
  const bitmap=await createImageBitmap(file); const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas'); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('照片處理失敗')),'image/webp',0.82));
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('照片讀取失敗'));reader.readAsDataURL(blob);});
}
function updateBrandPreview(kind,url=''){const logo=kind==='logo';const preview=$(logo?'#logoPreview':'#heroImagePreview');const remove=$(logo?'#removeLogo':'#useDefaultHero');preview.src=url;preview.hidden=!url;remove.hidden=!url;}
$('#logoFile').addEventListener('change',event=>{const file=event.target.files[0];if(file)updateBrandPreview('logo',URL.createObjectURL(file));});
$('#heroImageFile').addEventListener('change',event=>{const file=event.target.files[0];if(file)updateBrandPreview('hero',URL.createObjectURL(file));});
$('#logoUrl').addEventListener('change',event=>updateBrandPreview('logo',event.target.value));
$('#heroImageUrl').addEventListener('change',event=>updateBrandPreview('hero',event.target.value));
$('#removeLogo').addEventListener('click',()=>{$('#logoFile').value='';$('#logoUrl').value='';updateBrandPreview('logo');});
$('#useDefaultHero').addEventListener('click',()=>{$('#heroImageFile').value='';$('#heroImageUrl').value='';updateBrandPreview('hero');});
$('#productForm').addEventListener('submit',async event=>{
  event.preventDefault(); const id=$('#productId').value; const saveButton=event.submitter; saveButton.disabled=true; $('#formError').textContent='';
  try {
    let imageUrl=$('#imageUrl').value; const file=$('#imageFile').files[0];
    if(file){saveButton.textContent='照片上傳中…';const uploaded=await api('/api/admin/images',{method:'POST',body:JSON.stringify({data_url:await resizeImage(file)})});imageUrl=uploaded.url;}
    const fulfillmentIds=readProductFulfillmentIds();if(!fulfillmentIds.length)throw new Error('請至少選擇一種此商品可用的取貨方式');
    const body={name:$('#name').value,product_type:$('#productType').value,price:Number($('#price').value||0),stock:$('#stock').value,description:$('#description').value,quote_prompt:$('#quotePrompt').value,fulfillment_ids:fulfillmentIds,image_url:imageUrl,active:$('#active').checked};
    saveButton.textContent='儲存中…'; await api(id?`/api/admin/products/${id}`:'/api/admin/products',{method:id?'PUT':'POST',body:JSON.stringify(body)}); $('#productDialog').close(); await loadProducts(); toast('商品已儲存');
  } catch(error) { $('#formError').textContent=error.message; } finally { saveButton.disabled=false; saveButton.textContent='儲存商品'; }
});
$('#deleteProduct').addEventListener('click',async()=>{ const id=$('#productId').value; if(!id||!confirm('確定要永久刪除這項商品嗎？'))return; try{await api(`/api/admin/products/${id}`,{method:'DELETE'});$('#productDialog').close();await loadProducts();toast('商品已刪除');}catch(error){$('#formError').textContent=error.message;} });

async function loadOrders({notify=false}={}){const button=$('#refreshOrders');if(notify){button.disabled=true;button.textContent='整理中…';}try{state.orders=await api('/api/admin/orders');renderOrders();if(notify)toast('訂單已重新整理');}catch(error){toast(error.message);}finally{if(notify){button.disabled=false;button.textContent='重新整理';}}}
function renderOrderStatusFilters(){const statuses=state.orderView==='history'?['all','completed','cancelled']:['all','new','confirmed','preparing','ready'];const label=value=>value==='all'?(state.orderView==='history'?'全部歷史':'全部未完成'):statusLabels[value];const relevant=state.orders.filter(order=>state.orderView==='history'?['completed','cancelled'].includes(order.status):!['completed','cancelled'].includes(order.status));$('#orderStatusFilters').innerHTML=statuses.map(value=>`<button type="button" class="order-status-filter ${state.orderStatus===value?'active':''}" data-status="${value}">${label(value)} <b>${value==='all'?relevant.length:relevant.filter(order=>order.status===value).length}</b></button>`).join('');document.querySelectorAll('.order-status-filter').forEach(button=>button.addEventListener('click',()=>{state.orderStatus=button.dataset.status;renderOrders();}));}
function renderOrders(){
  const isHistory=order=>['completed','cancelled'].includes(order.status);const activeCount=state.orders.filter(order=>!isHistory(order)).length;const historyCount=state.orders.length-activeCount;$('#activeOrderCount').textContent=activeCount;$('#historyOrderCount').textContent=historyCount;
  renderOrderStatusFilters();const query=state.orderQuery.trim().toLowerCase();const orders=state.orders.filter(order=>(state.orderView==='history'?isHistory(order):!isHistory(order))).filter(order=>state.orderStatus==='all'||order.status===state.orderStatus).filter(order=>!query||[order.id,order.customer_name,order.phone,order.summary,order.fulfillment,order.pickup_time,order.note,order.transfer_last5,order.quote_request,order.quote_note].some(value=>String(value||'').toLowerCase().includes(query)));
  const emptyText=query||state.orderStatus!=='all'?'找不到符合篩選條件的訂單。':state.orderView==='history'?'目前還沒有歷史訂單。':'太好了，目前沒有未完成訂單。';
  $('#orderList').innerHTML=orders.length?orders.map(order=>`<article class="order"><div><strong>#${order.id.slice(0,8)} · ${order.quote_status==='requested'?'待報價':money(order.total)}</strong><p>${escapeHtml(order.summary)}</p><p>${escapeHtml(order.customer_name||'未填姓名')} · ${escapeHtml(order.phone||'未留電話')} · ${escapeHtml(order.fulfillment||'未選取貨方式')}${order.pickup_time?` · ${escapeHtml(order.pickup_time)}`:''}</p><p>付款：${paymentMethodLabel(order.payment_method)}${order.transfer_last5?` · 末五碼 ${escapeHtml(order.transfer_last5)}`:''}</p>${order.quote_request?`<div class="quote-box"><b>客製需求</b><p>${escapeHtml(order.quote_request)}</p><label>報價金額<input data-quote-amount="${order.id}" type="number" min="0" step="1" value="${order.quote_amount??''}" placeholder="例如：1200"></label><label>報價說明<textarea data-quote-note="${order.id}" rows="2" maxlength="300" placeholder="例如：此報價含包裝與冷藏宅配">${escapeHtml(order.quote_note||'')}</textarea></label><button type="button" data-quote-save="${order.id}">${order.quote_status==='quoted'?'更新報價':'儲存報價'}</button></div>`:''}${renderOrderMessages(order)}${order.note?`<p>備註：${escapeHtml(order.note)}</p>`:''}<small>${new Date(order.created_at).toLocaleString('zh-TW')}</small></div><div class="order-actions"><label><span>訂單狀態</span><select data-type="order" data-id="${order.id}">${Object.entries(statusLabels).map(([value,label])=>`<option value="${value}" ${order.status===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>付款狀態</span><select data-type="payment" data-id="${order.id}">${Object.entries(paymentLabels).map(([value,label])=>`<option value="${value}" ${order.payment_status===value?'selected':''}>${label}</option>`).join('')}</select></label></div></article>`).join(''):`<div class="empty">${emptyText}</div>`;
  document.querySelectorAll('.order select').forEach(select=>select.addEventListener('change',async()=>{const payment=select.dataset.type==='payment';try{await api(`/api/admin/orders/${select.dataset.id}/${payment?'payment':'status'}`,{method:'PATCH',body:JSON.stringify(payment?{payment_status:select.value}:{status:select.value})});toast(payment?'付款狀態已更新':'訂單狀態已更新並通知客戶');await loadOrders();}catch(error){toast(error.message);loadOrders();}}));
  document.querySelectorAll('[data-quote-save]').forEach(button=>button.addEventListener('click',async()=>{const id=button.dataset.quoteSave;button.disabled=true;try{await api(`/api/admin/orders/${id}/quote`,{method:'PATCH',body:JSON.stringify({quote_amount:document.querySelector(`[data-quote-amount="${id}"]`).value,quote_note:document.querySelector(`[data-quote-note="${id}"]`).value})});toast('報價已儲存');await loadOrders();}catch(error){toast(error.message);}finally{button.disabled=false;}}));
  document.querySelectorAll('[data-message-send]').forEach(button=>button.addEventListener('click',()=>sendOrderMessage(button.dataset.messageSend)));
}
function renderOrderMessages(order){const messages=Array.isArray(order.order_messages)?order.order_messages:[];return `<div class="message-box"><b>溝通紀錄</b>${messages.length?messages.map(message=>`<div class="message-item ${message.author==='merchant'?'merchant':''}"><small>${message.author==='merchant'?'店家':'客戶'} · ${new Date(message.created_at).toLocaleString('zh-TW')}</small>${message.text?`<p>${escapeHtml(message.text)}</p>`:''}${message.image_url?`<a href="${escapeHtml(message.image_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(message.image_url)}" alt="溝通照片"></a>`:''}</div>`).join(''):'<p class="field-help">尚未有留言或照片。</p>'}<textarea data-message-text="${order.id}" rows="2" maxlength="600" placeholder="回覆客戶，例如：請補蛋糕參考照片或確認尺寸"></textarea><input data-message-file="${order.id}" type="file" accept="image/jpeg,image/png,image/webp"><button type="button" data-message-send="${order.id}">送出回覆</button></div>`;}
async function sendOrderMessage(id){const button=document.querySelector(`[data-message-send="${id}"]`);button.disabled=true;try{let imageUrl='';const file=document.querySelector(`[data-message-file="${id}"]`).files[0];if(file){button.textContent='照片上傳中…';imageUrl=(await api('/api/admin/images',{method:'POST',body:JSON.stringify({data_url:await resizeImage(file)})})).url;}button.textContent='送出中…';await api(`/api/admin/orders/${id}/messages`,{method:'POST',body:JSON.stringify({text:document.querySelector(`[data-message-text="${id}"]`).value,image_url:imageUrl})});toast('回覆已送出');await loadOrders();}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent='送出回覆';}}
$('#refreshOrders').addEventListener('click',()=>loadOrders({notify:true}));
document.querySelectorAll('.order-filter').forEach(button=>button.addEventListener('click',()=>{state.orderView=button.dataset.view;state.orderStatus='all';document.querySelectorAll('.order-filter').forEach(item=>item.classList.toggle('active',item===button));renderOrders();}));
$('#orderSearch').addEventListener('input',event=>{state.orderQuery=event.target.value;renderOrders();});
setInterval(()=>{if(state.token&&state.activeTab==='orders'&&!document.hidden)loadOrders();},10000);

function money(value){return `NT$ ${Number(value||0).toLocaleString('zh-TW')}`;}
async function loadReport({notify=false}={}){const button=$('#refreshReports');if(notify){button.disabled=true;button.textContent='整理中…';}try{state.report=await api(`/api/admin/reports/sales?range=${encodeURIComponent(state.reportRange)}`);renderReport();if(notify)toast('報表已重新整理');}catch(error){toast(error.message);}finally{if(notify){button.disabled=false;button.textContent='重新整理';}}}
function renderReport(){
  const report=state.report;if(!report){$('#reportCards').innerHTML='<div class="empty">正在載入營業報表…</div>';return;}
  const paymentText=`現金 ${money(report.by_payment?.cash)} ／ 轉帳 ${money(report.by_payment?.bank_transfer)} ／ 待報價 ${money(report.by_payment?.quote)}`;
  $('#reportCards').innerHTML=[
    ['營業額',money(report.revenue),'不含已取消訂單'],
    ['已收款',money(report.paid_revenue),'付款狀態為已付款'],
    ['未收款',money(report.unpaid_revenue),'未付款、待核對皆列入'],
    ['訂單數',`${report.active_orders} 筆`,`平均客單 ${money(report.average_order_value)}`],
    ['已取消金額',money(report.cancelled_revenue),'取消訂單不列入營業額'],
    ['付款方式',paymentText,'依訂單付款方式統計']
  ].map(([title,value,note])=>`<article class="report-card"><span>${title}</span><strong>${value}</strong><p>${note}</p></article>`).join('');
}
$('#refreshReports').addEventListener('click',()=>loadReport({notify:true}));
$('#reportRange').addEventListener('change',event=>{state.reportRange=event.target.value;loadReport();});
$('#exportOrders').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;const original=button.textContent;button.textContent='準備下載…';
  try{
    const response=await fetch(`/api/admin/reports/orders.csv?range=${encodeURIComponent(state.reportRange)}`,{headers:{Authorization:`Bearer ${state.token || ''}`}});
    if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.error||'匯出失敗');}
    const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`訂單匯出-${state.reportRange}.csv`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);toast('訂單表已下載');
  }catch(error){toast(error.message);}finally{button.disabled=false;button.textContent=original;}
});

function renderCheckoutSettings(settings={}){
  document.querySelectorAll('.checkout-field-row').forEach(row=>{const config=settings.checkout_fields?.[row.dataset.field]||{};row.querySelector('[data-role="label"]').value=config.label||'';row.querySelector('[data-role="enabled"]').checked=config.enabled!==false;row.querySelector('[data-role="required"]').checked=config.required===true;});
  state.fulfillmentOptions=(settings.fulfillment_options||[]).map(item=>({...item}));renderFulfillmentOptions();
}
function readCheckoutFields(){return Object.fromEntries([...document.querySelectorAll('.checkout-field-row')].map(row=>[row.dataset.field,{label:row.querySelector('[data-role="label"]').value,enabled:row.querySelector('[data-role="enabled"]').checked,required:row.querySelector('[data-role="required"]').checked}]));}
function renderFulfillmentOptions(){const box=$('#fulfillmentOptions');box.innerHTML=state.fulfillmentOptions.map((item,index)=>`<div class="fulfillment-option-row" data-index="${index}"><input data-role="label" maxlength="40" value="${escapeHtml(item.label)}" placeholder="例如：宅配"><label class="compact-switch"><input data-role="enabled" type="checkbox" ${item.enabled!==false?'checked':''}>顯示</label><button type="button" class="danger" data-action="remove">刪除</button></div>`).join('');box.querySelectorAll('[data-role="label"]').forEach(input=>input.addEventListener('input',()=>state.fulfillmentOptions[Number(input.closest('[data-index]').dataset.index)].label=input.value));box.querySelectorAll('[data-role="enabled"]').forEach(input=>input.addEventListener('change',()=>state.fulfillmentOptions[Number(input.closest('[data-index]').dataset.index)].enabled=input.checked));box.querySelectorAll('[data-action="remove"]').forEach(button=>button.addEventListener('click',()=>{state.fulfillmentOptions.splice(Number(button.closest('[data-index]').dataset.index),1);renderFulfillmentOptions();}));}
$('#addFulfillmentOption').addEventListener('click',()=>{state.fulfillmentOptions.push({id:`method_${Date.now()}`,label:'新的取貨方式',enabled:true});renderFulfillmentOptions();});
async function loadSettings(){try{const settings=await api('/api/admin/settings');$('#storeName').value=settings.store_name||'';$('#tagline').value=settings.tagline||'';$('#storeDescription').value=settings.description||'';$('#storePhone').value=settings.phone||'';$('#businessHours').value=settings.business_hours||'';$('#storeAddress').value=settings.address||'';$('#logoUrl').value=settings.logo_url||'';$('#heroImageUrl').value=settings.hero_image_url||'';updateBrandPreview('logo',settings.logo_url);updateBrandPreview('hero',settings.hero_image_url);$('#acceptingOrders').checked=settings.accepting_orders!==false;$('#cashEnabled').checked=settings.cash_enabled!==false;$('#bankTransferEnabled').checked=settings.bank_transfer_enabled!==false;$('#bankName').value=settings.bank_name||'';$('#bankCode').value=settings.bank_code||'';$('#bankAccount').value=settings.bank_account||'';$('#bankAccountName').value=settings.bank_account_name||'';$('#paymentInstructions').value=settings.payment_instructions||'';renderCheckoutSettings(settings);}catch(error){toast(error.message);}}
function showLineStep(step){state.lineStep=Math.max(1,Math.min(4,Number(step)||1));document.querySelectorAll('[data-line-step]').forEach(section=>section.hidden=Number(section.dataset.lineStep)!==state.lineStep);document.querySelectorAll('[data-line-go]').forEach(button=>{const number=Number(button.dataset.lineGo);button.classList.toggle('active',number===state.lineStep);button.classList.toggle('completed',number<state.lineStep||(state.lineIntegration?.bound&&number<=4));});}
function renderLineIntegration(integration,{chooseStep=true}={}){state.lineIntegration=integration;$('#lineOfficialAccountId').value=integration.official_account_id||'';$('#lineChannelAccessToken').value='';$('#lineChannelSecret').value='';$('#lineWebhookUrl').value=integration.webhook_url||'';$('#lineBindCommand').value=integration.bind_code?`綁定店家 ${integration.bind_code}`:'';$('#lineEnabledActions').hidden=!integration.enabled;$('#lineConnectionComplete').hidden=!integration.bound;const status=$('#lineBindingStatus');status.textContent=integration.bound?'✓ 已完成店家 LINE 綁定':'尚未偵測到綁定，請傳送上方指令後再檢查';status.classList.toggle('success',integration.bound===true);if(chooseStep)showLineStep(integration.bound?4:integration.configured?3:integration.official_account_id?2:1);else showLineStep(state.lineStep);}
async function loadLineIntegration(options={}){try{$('#lineIntegrationError').textContent='';const integration=await api('/api/admin/line-integration');$('#legacyLineNotice').hidden=!integration.legacy;$('#linePlanLock').hidden=!integration.locked;$('#tenantLineSettings').hidden=integration.legacy===true||integration.locked===true;if(integration.legacy||integration.locked)return;renderLineIntegration(integration,options);}catch(error){$('#lineIntegrationError').textContent=error.message;}}
document.querySelectorAll('[data-line-go]').forEach(button=>button.addEventListener('click',()=>{const target=Number(button.dataset.lineGo);if(target>1&&!$('#lineOfficialAccountId').value.trim())return;showLineStep(target);}));
document.querySelectorAll('[data-line-back]').forEach(button=>button.addEventListener('click',()=>showLineStep(button.dataset.lineBack)));
$('#lineStep1Next').addEventListener('click',()=>{const id=$('#lineOfficialAccountId').value.trim();$('#lineIntegrationError').textContent='';if(!id.startsWith('@')){$('#lineIntegrationError').textContent='官方帳號 ID 必須以 @ 開頭，例如 @abc1234';return;}showLineStep(2);});
$('#saveLineIntegration').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;$('#lineIntegrationError').textContent='';try{const integration=await api('/api/admin/line-integration',{method:'PUT',body:JSON.stringify({enabled:true,official_account_id:$('#lineOfficialAccountId').value,channel_access_token:$('#lineChannelAccessToken').value,channel_secret:$('#lineChannelSecret').value})});renderLineIntegration({...integration,bound:false},{chooseStep:false});showLineStep(3);toast('LINE 連線驗證成功');}catch(error){$('#lineIntegrationError').textContent=error.message;}finally{button.disabled=false;}});
$('#lineStep3Next').addEventListener('click',()=>showLineStep(4));
async function copyLineValue(selector,label){const value=$(selector).value;if(!value){$('#lineIntegrationError').textContent=`目前沒有${label}可複製`;return;}try{await navigator.clipboard.writeText(value);toast(`${label}已複製`);}catch{$(selector).select();document.execCommand('copy');toast(`${label}已複製`);}}
$('#copyLineWebhook').addEventListener('click',()=>copyLineValue('#lineWebhookUrl','Webhook 網址'));
$('#copyLineBindCommand').addEventListener('click',()=>copyLineValue('#lineBindCommand','綁定指令'));
$('#checkLineBinding').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='檢查中…';await loadLineIntegration({chooseStep:false});button.disabled=false;button.textContent='檢查綁定狀態';if(state.lineIntegration?.bound)toast('店家 LINE 綁定完成');});
$('#disableLineIntegration').addEventListener('click',async event=>{if(!confirm('停用後，客戶將看不到 LINE 訂單確認，LINE 通知也會停止。確定停用嗎？'))return;const button=event.currentTarget;button.disabled=true;try{const integration=await api('/api/admin/line-integration',{method:'PUT',body:JSON.stringify({enabled:false,official_account_id:$('#lineOfficialAccountId').value})});renderLineIntegration({...integration,bound:state.lineIntegration?.bound===true});showLineStep(1);toast('LINE 功能已停用');}catch(error){$('#lineIntegrationError').textContent=error.message;}finally{button.disabled=false;}});
async function loadSheetsIntegration(){try{$('#sheetsIntegrationError').textContent='';const integration=await api('/api/admin/sheets-integration');state.sheetIntegration=integration;$('#legacySheetsNotice').hidden=!integration.legacy;$('#sheetsPlanLock').hidden=!integration.locked;$('#tenantSheetsSettings').hidden=integration.legacy===true||integration.locked===true;$('#sheetsConnected').hidden=true;if(integration.legacy||integration.locked)return;$('#sheetsServiceEmail').value=integration.service_account_email||'';$('#sheetsUrl').value=integration.spreadsheet_url||'';$('#sheetsName').value=integration.sheet_name||'訂單';$('#sheetsEnabled').checked=integration.enabled===true;$('#sheetsConnected').hidden=!integration.enabled;if(!integration.service_account_email)$('#sheetsIntegrationError').textContent='平台缺少 GOOGLE_CLIENT_EMAIL 或 GOOGLE_PRIVATE_KEY，請先到 Zeabur 環境變數補齊。';}catch(error){$('#sheetsIntegrationError').textContent=error.message;}}
$('#copySheetsServiceEmail').addEventListener('click',async()=>{const value=$('#sheetsServiceEmail').value;if(!value){$('#sheetsIntegrationError').textContent='系統尚未設定 Google 服務帳號，請聯絡平台管理者';return;}try{await navigator.clipboard.writeText(value);}catch{$('#sheetsServiceEmail').select();document.execCommand('copy');}toast('服務帳號已複製');});
$('#saveSheetsIntegration').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='測試連線中…';$('#sheetsIntegrationError').textContent='';try{const integration=await api('/api/admin/sheets-integration',{method:'PUT',body:JSON.stringify({enabled:$('#sheetsEnabled').checked,spreadsheet_url:$('#sheetsUrl').value,sheet_name:$('#sheetsName').value})});state.sheetIntegration=integration;$('#sheetsConnected').hidden=!integration.enabled;toast(integration.enabled?'Google 試算表同步已啟用':'Google 試算表同步已停用');}catch(error){$('#sheetsIntegrationError').textContent=error.message;}finally{button.disabled=false;button.textContent='儲存並測試連線';}});
$('#settingsForm').addEventListener('submit',async event=>{
  event.preventDefault();$('#settingsError').textContent='';const button=event.submitter;button.disabled=true;const originalText=button.textContent;
  try{
    const fulfillmentOptions=state.fulfillmentOptions.filter(item=>item.label.trim());if(!fulfillmentOptions.some(item=>item.enabled!==false))throw new Error('請至少啟用一種客戶取貨方式');
    let logoUrl=$('#logoUrl').value;let heroImageUrl=$('#heroImageUrl').value;const logoFile=$('#logoFile').files[0];const heroFile=$('#heroImageFile').files[0];
    if(logoFile){button.textContent='Logo 上傳中…';logoUrl=(await api('/api/admin/images',{method:'POST',body:JSON.stringify({data_url:await resizeImage(logoFile)})})).url;}
    if(heroFile){button.textContent='封面上傳中…';heroImageUrl=(await api('/api/admin/images',{method:'POST',body:JSON.stringify({data_url:await resizeImage(heroFile)})})).url;}
    button.textContent='設定儲存中…';await api('/api/admin/settings',{method:'PUT',body:JSON.stringify({store_name:$('#storeName').value,tagline:$('#tagline').value,description:$('#storeDescription').value,phone:$('#storePhone').value,business_hours:$('#businessHours').value,address:$('#storeAddress').value,logo_url:logoUrl,hero_image_url:heroImageUrl,accepting_orders:$('#acceptingOrders').checked,cash_enabled:$('#cashEnabled').checked,bank_transfer_enabled:$('#bankTransferEnabled').checked,bank_name:$('#bankName').value,bank_code:$('#bankCode').value,bank_account:$('#bankAccount').value,bank_account_name:$('#bankAccountName').value,payment_instructions:$('#paymentInstructions').value,checkout_fields:readCheckoutFields(),fulfillment_options:fulfillmentOptions})});
    $('#logoUrl').value=logoUrl;$('#heroImageUrl').value=heroImageUrl;$('#logoFile').value='';$('#heroImageFile').value='';updateBrandPreview('logo',logoUrl);updateBrandPreview('hero',heroImageUrl);toast('店家設定與圖片已更新');
  }catch(error){$('#settingsError').textContent=error.message;}finally{button.disabled=false;button.textContent=originalText;}
});

if(state.token) showApp();
