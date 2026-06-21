const state = { token: localStorage.getItem('adminToken'), products: [], orders: [], fulfillmentOptions: [], orderView: 'active', orderStatus: 'all', orderQuery: '', activeTab: 'products', account: null };
const $ = selector => document.querySelector(selector);
const statusLabels = { new:'新訂單',confirmed:'已確認',preparing:'製作中',ready:'可取貨',completed:'已完成',cancelled:'已取消' };
const paymentLabels = { unpaid:'未付款',pending:'待核對',paid:'已付款',refunded:'已退款' };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${state.token || ''}`, ...options.headers }
  });
  const data = response.status === 204 ? null : await response.json();
  if (response.status === 401 && path !== '/api/admin/login') logout();
  if (!response.ok) throw new Error(data?.error || '操作失敗');
  return data;
}

function toast(text) { const el=$('#toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); }
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function showApp() { $('#loginView').hidden=true; $('#registerView').hidden=true; $('#appView').hidden=false; loadProducts(); loadAccount(); }
function logout() { localStorage.removeItem('adminToken'); state.token=null; $('#appView').hidden=true; $('#registerView').hidden=true; $('#loginView').hidden=false; }
async function loadAccount(){try{state.account=await api('/api/admin/account');const merchant=state.account.merchant;if(!merchant){$('#accountSummary').textContent='既有測試商店';return;}const until=new Date(merchant.expires_at||merchant.trial_ends_at).toLocaleDateString('zh-TW');$('#accountSummary').innerHTML=`方案：${escapeHtml(merchant.plan==='trial'?'免費試用':merchant.plan)} · 到期日：${escapeHtml(until)} · <a href="${escapeHtml(state.account.shop_url)}" target="_blank">開啟商店</a>`;}catch(error){toast(error.message);}}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#loginError').textContent='';
  try {
    const result=await api('/api/admin/login',{method:'POST',body:JSON.stringify({email:$('#loginEmail').value,password:$('#password').value})});
    state.token=result.token; localStorage.setItem('adminToken',result.token); showApp();
  } catch(error) { $('#loginError').textContent=error.message; }
});
$('#logoutButton').addEventListener('click',logout);
$('#showRegister').addEventListener('click',()=>{$('#loginView').hidden=true;$('#registerView').hidden=false;});
$('#showLogin').addEventListener('click',()=>{$('#registerView').hidden=true;$('#loginView').hidden=false;});
$('#registerForm').addEventListener('submit',async event=>{event.preventDefault();$('#registerError').textContent='';const button=event.submitter;button.disabled=true;try{const result=await api('/api/admin/register',{method:'POST',body:JSON.stringify({store_name:$('#registerStoreName').value,slug:$('#registerSlug').value,email:$('#registerEmail').value,password:$('#registerPassword').value})});state.token=result.token;localStorage.setItem('adminToken',result.token);showApp();toast('商店建立成功，免費試用 14 天');}catch(error){$('#registerError').textContent=error.message;}finally{button.disabled=false;}});

document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===button));
  const selected=button.dataset.tab; state.activeTab=selected; $('#productsPanel').hidden=selected!=='products'; $('#ordersPanel').hidden=selected!=='orders'; $('#settingsPanel').hidden=selected!=='settings';
  if(selected==='orders') loadOrders(); if(selected==='settings') loadSettings();
}));

async function loadProducts() {
  try { state.products=await api('/api/admin/products'); renderProducts(); } catch(error) { toast(error.message); }
}
function renderProducts() {
  $('#productList').innerHTML=state.products.length?state.products.map(item=>`<article class="product-card" data-id="${item.id}">
    <img src="${escapeHtml(item.image_url || 'https://images.unsplash.com/photo-1547592180-85f173990554?w=600')}" alt="">
    <div class="product-body"><div class="product-top"><div><strong>${escapeHtml(item.name)}</strong><div class="price">NT$ ${item.price}</div></div><span class="pill ${item.active?'':'off'}">${item.active?'販售中':'已停售'}</span></div><p>${escapeHtml(item.description || '尚未填寫介紹')}</p></div>
  </article>`).join(''):'<div class="empty">尚未建立商品，點「新增商品」開始。</div>';
  document.querySelectorAll('.product-card').forEach(card=>card.addEventListener('click',()=>openProduct(state.products.find(item=>item.id===card.dataset.id))));
}

function openProduct(product=null) {
  $('#productForm').reset(); $('#formError').textContent=''; $('#productId').value=product?.id||''; $('#dialogTitle').textContent=product?'編輯商品':'新增商品';
  $('#name').value=product?.name||''; $('#price').value=product?.price??''; $('#stock').value=product?.stock??''; $('#description').value=product?.description||''; $('#imageUrl').value=product?.image_url||''; $('#active').checked=product?.active!==false; $('#deleteProduct').hidden=!product;
  $('#imagePreview').src=product?.image_url||''; $('#imagePreview').hidden=!product?.image_url; $('#productDialog').showModal();
}
$('#addProduct').addEventListener('click',()=>openProduct()); $('#closeDialog').addEventListener('click',()=>$('#productDialog').close());
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
    const body={name:$('#name').value,price:Number($('#price').value),stock:$('#stock').value,description:$('#description').value,image_url:imageUrl,active:$('#active').checked};
    saveButton.textContent='儲存中…'; await api(id?`/api/admin/products/${id}`:'/api/admin/products',{method:id?'PUT':'POST',body:JSON.stringify(body)}); $('#productDialog').close(); await loadProducts(); toast('商品已儲存');
  } catch(error) { $('#formError').textContent=error.message; } finally { saveButton.disabled=false; saveButton.textContent='儲存商品'; }
});
$('#deleteProduct').addEventListener('click',async()=>{ const id=$('#productId').value; if(!id||!confirm('確定要永久刪除這項商品嗎？'))return; try{await api(`/api/admin/products/${id}`,{method:'DELETE'});$('#productDialog').close();await loadProducts();toast('商品已刪除');}catch(error){$('#formError').textContent=error.message;} });

async function loadOrders({notify=false}={}){const button=$('#refreshOrders');if(notify){button.disabled=true;button.textContent='整理中…';}try{state.orders=await api('/api/admin/orders');renderOrders();if(notify)toast('訂單已重新整理');}catch(error){toast(error.message);}finally{if(notify){button.disabled=false;button.textContent='重新整理';}}}
function renderOrderStatusFilters(){const statuses=state.orderView==='history'?['all','completed','cancelled']:['all','new','confirmed','preparing','ready'];const label=value=>value==='all'?(state.orderView==='history'?'全部歷史':'全部未完成'):statusLabels[value];const relevant=state.orders.filter(order=>state.orderView==='history'?['completed','cancelled'].includes(order.status):!['completed','cancelled'].includes(order.status));$('#orderStatusFilters').innerHTML=statuses.map(value=>`<button type="button" class="order-status-filter ${state.orderStatus===value?'active':''}" data-status="${value}">${label(value)} <b>${value==='all'?relevant.length:relevant.filter(order=>order.status===value).length}</b></button>`).join('');document.querySelectorAll('.order-status-filter').forEach(button=>button.addEventListener('click',()=>{state.orderStatus=button.dataset.status;renderOrders();}));}
function renderOrders(){
  const isHistory=order=>['completed','cancelled'].includes(order.status);const activeCount=state.orders.filter(order=>!isHistory(order)).length;const historyCount=state.orders.length-activeCount;$('#activeOrderCount').textContent=activeCount;$('#historyOrderCount').textContent=historyCount;
  renderOrderStatusFilters();const query=state.orderQuery.trim().toLowerCase();const orders=state.orders.filter(order=>(state.orderView==='history'?isHistory(order):!isHistory(order))).filter(order=>state.orderStatus==='all'||order.status===state.orderStatus).filter(order=>!query||[order.id,order.customer_name,order.phone,order.summary,order.fulfillment,order.pickup_time,order.note,order.transfer_last5].some(value=>String(value||'').toLowerCase().includes(query)));
  const emptyText=query||state.orderStatus!=='all'?'找不到符合篩選條件的訂單。':state.orderView==='history'?'目前還沒有歷史訂單。':'太好了，目前沒有未完成訂單。';
  $('#orderList').innerHTML=orders.length?orders.map(order=>`<article class="order"><div><strong>#${order.id.slice(0,8)} · NT$ ${order.total}</strong><p>${escapeHtml(order.summary)}</p><p>${escapeHtml(order.customer_name||'未填姓名')} · ${escapeHtml(order.phone||'未留電話')} · ${escapeHtml(order.fulfillment||'未選取貨方式')}${order.pickup_time?` · ${escapeHtml(order.pickup_time)}`:''}</p><p>付款：${order.payment_method==='bank_transfer'?'銀行轉帳':'現金取貨'}${order.transfer_last5?` · 末五碼 ${escapeHtml(order.transfer_last5)}`:''}</p>${order.note?`<p>備註：${escapeHtml(order.note)}</p>`:''}<small>${new Date(order.created_at).toLocaleString('zh-TW')}</small></div><div class="order-actions"><label><span>訂單狀態</span><select data-type="order" data-id="${order.id}">${Object.entries(statusLabels).map(([value,label])=>`<option value="${value}" ${order.status===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>付款狀態</span><select data-type="payment" data-id="${order.id}">${Object.entries(paymentLabels).map(([value,label])=>`<option value="${value}" ${order.payment_status===value?'selected':''}>${label}</option>`).join('')}</select></label></div></article>`).join(''):`<div class="empty">${emptyText}</div>`;
  document.querySelectorAll('.order select').forEach(select=>select.addEventListener('change',async()=>{const payment=select.dataset.type==='payment';try{await api(`/api/admin/orders/${select.dataset.id}/${payment?'payment':'status'}`,{method:'PATCH',body:JSON.stringify(payment?{payment_status:select.value}:{status:select.value})});toast(payment?'付款狀態已更新':'訂單狀態已更新並通知客戶');await loadOrders();}catch(error){toast(error.message);loadOrders();}}));
}
$('#refreshOrders').addEventListener('click',()=>loadOrders({notify:true}));
document.querySelectorAll('.order-filter').forEach(button=>button.addEventListener('click',()=>{state.orderView=button.dataset.view;state.orderStatus='all';document.querySelectorAll('.order-filter').forEach(item=>item.classList.toggle('active',item===button));renderOrders();}));
$('#orderSearch').addEventListener('input',event=>{state.orderQuery=event.target.value;renderOrders();});
setInterval(()=>{if(state.token&&state.activeTab==='orders'&&!document.hidden)loadOrders();},10000);

function renderCheckoutSettings(settings={}){
  document.querySelectorAll('.checkout-field-row').forEach(row=>{const config=settings.checkout_fields?.[row.dataset.field]||{};row.querySelector('[data-role="label"]').value=config.label||'';row.querySelector('[data-role="enabled"]').checked=config.enabled!==false;row.querySelector('[data-role="required"]').checked=config.required===true;});
  state.fulfillmentOptions=(settings.fulfillment_options||[]).map(item=>({...item}));renderFulfillmentOptions();
}
function readCheckoutFields(){return Object.fromEntries([...document.querySelectorAll('.checkout-field-row')].map(row=>[row.dataset.field,{label:row.querySelector('[data-role="label"]').value,enabled:row.querySelector('[data-role="enabled"]').checked,required:row.querySelector('[data-role="required"]').checked}]));}
function renderFulfillmentOptions(){const box=$('#fulfillmentOptions');box.innerHTML=state.fulfillmentOptions.map((item,index)=>`<div class="fulfillment-option-row" data-index="${index}"><input data-role="label" maxlength="40" value="${escapeHtml(item.label)}" placeholder="例如：宅配"><label class="compact-switch"><input data-role="enabled" type="checkbox" ${item.enabled!==false?'checked':''}>顯示</label><button type="button" class="danger" data-action="remove">刪除</button></div>`).join('');box.querySelectorAll('[data-role="label"]').forEach(input=>input.addEventListener('input',()=>state.fulfillmentOptions[Number(input.closest('[data-index]').dataset.index)].label=input.value));box.querySelectorAll('[data-role="enabled"]').forEach(input=>input.addEventListener('change',()=>state.fulfillmentOptions[Number(input.closest('[data-index]').dataset.index)].enabled=input.checked));box.querySelectorAll('[data-action="remove"]').forEach(button=>button.addEventListener('click',()=>{state.fulfillmentOptions.splice(Number(button.closest('[data-index]').dataset.index),1);renderFulfillmentOptions();}));}
$('#addFulfillmentOption').addEventListener('click',()=>{state.fulfillmentOptions.push({id:`method_${Date.now()}`,label:'新的取貨方式',enabled:true});renderFulfillmentOptions();});
async function loadSettings(){try{const settings=await api('/api/admin/settings');$('#storeName').value=settings.store_name||'';$('#tagline').value=settings.tagline||'';$('#storeDescription').value=settings.description||'';$('#storePhone').value=settings.phone||'';$('#businessHours').value=settings.business_hours||'';$('#storeAddress').value=settings.address||'';$('#logoUrl').value=settings.logo_url||'';$('#heroImageUrl').value=settings.hero_image_url||'';updateBrandPreview('logo',settings.logo_url);updateBrandPreview('hero',settings.hero_image_url);$('#acceptingOrders').checked=settings.accepting_orders!==false;$('#cashEnabled').checked=settings.cash_enabled!==false;$('#bankTransferEnabled').checked=settings.bank_transfer_enabled!==false;$('#bankName').value=settings.bank_name||'';$('#bankCode').value=settings.bank_code||'';$('#bankAccount').value=settings.bank_account||'';$('#bankAccountName').value=settings.bank_account_name||'';$('#paymentInstructions').value=settings.payment_instructions||'';renderCheckoutSettings(settings);}catch(error){toast(error.message);}}
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
