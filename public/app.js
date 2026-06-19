const state = { token: localStorage.getItem('adminToken'), products: [], orders: [] };
const $ = selector => document.querySelector(selector);
const statusLabels = { new:'新訂單',confirmed:'已確認',preparing:'製作中',ready:'可取貨',completed:'已完成',cancelled:'已取消' };

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
function showApp() { $('#loginView').hidden=true; $('#appView').hidden=false; loadProducts(); }
function logout() { localStorage.removeItem('adminToken'); state.token=null; $('#appView').hidden=true; $('#loginView').hidden=false; }

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#loginError').textContent='';
  try {
    const result=await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});
    state.token=result.token; localStorage.setItem('adminToken',result.token); showApp();
  } catch(error) { $('#loginError').textContent=error.message; }
});
$('#logoutButton').addEventListener('click',logout);

document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===button));
  const products=button.dataset.tab==='products'; $('#productsPanel').hidden=!products; $('#ordersPanel').hidden=products;
  if(!products) loadOrders();
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
  $('#name').value=product?.name||''; $('#price').value=product?.price??''; $('#stock').value=product?.stock??''; $('#description').value=product?.description||''; $('#imageUrl').value=product?.image_url||''; $('#active').checked=product?.active!==false; $('#deleteProduct').hidden=!product; $('#productDialog').showModal();
}
$('#addProduct').addEventListener('click',()=>openProduct()); $('#closeDialog').addEventListener('click',()=>$('#productDialog').close());
$('#productForm').addEventListener('submit',async event=>{
  event.preventDefault(); const id=$('#productId').value; const body={name:$('#name').value,price:Number($('#price').value),stock:$('#stock').value,description:$('#description').value,image_url:$('#imageUrl').value,active:$('#active').checked};
  try { await api(id?`/api/admin/products/${id}`:'/api/admin/products',{method:id?'PUT':'POST',body:JSON.stringify(body)}); $('#productDialog').close(); await loadProducts(); toast('商品已儲存'); } catch(error) { $('#formError').textContent=error.message; }
});
$('#deleteProduct').addEventListener('click',async()=>{ const id=$('#productId').value; if(!id||!confirm('確定要永久刪除這項商品嗎？'))return; try{await api(`/api/admin/products/${id}`,{method:'DELETE'});$('#productDialog').close();await loadProducts();toast('商品已刪除');}catch(error){$('#formError').textContent=error.message;} });

async function loadOrders(){try{state.orders=await api('/api/admin/orders');renderOrders();}catch(error){toast(error.message);}}
function renderOrders(){ $('#orderList').innerHTML=state.orders.length?state.orders.map(order=>`<article class="order"><div><strong>#${order.id.slice(0,8)} · NT$ ${order.total}</strong><p>${escapeHtml(order.summary)}</p><small>${new Date(order.created_at).toLocaleString('zh-TW')}</small></div><select data-id="${order.id}">${Object.entries(statusLabels).map(([value,label])=>`<option value="${value}" ${order.status===value?'selected':''}>${label}</option>`).join('')}</select></article>`).join(''):'<div class="empty">目前還沒有訂單。</div>'; document.querySelectorAll('.order select').forEach(select=>select.addEventListener('change',async()=>{try{await api(`/api/admin/orders/${select.dataset.id}/status`,{method:'PATCH',body:JSON.stringify({status:select.value})});toast('訂單狀態已更新並通知客戶');}catch(error){toast(error.message);loadOrders();}})); }
$('#refreshOrders').addEventListener('click',loadOrders);

if(state.token) showApp();
