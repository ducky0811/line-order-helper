const state = { token: localStorage.getItem('platformToken'), data: null, query: '', filter: 'all', selectedMonths: {} };
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token || ''}`, ...options.headers }
  });
  const data = await response.json().catch(() => null);
  if (response.status === 401 && path !== '/api/platform/login') logout();
  if (!response.ok) throw new Error(data?.error || '操作失敗');
  return data;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function showDashboard() {
  $('#loginView').hidden = true;
  $('#dashboard').hidden = false;
  load();
}

function logout() {
  localStorage.removeItem('platformToken');
  state.token = null;
  $('#dashboard').hidden = true;
  $('#loginView').hidden = false;
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#loginError').textContent = '';
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await api('/api/platform/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    state.token = result.token;
    localStorage.setItem('platformToken', result.token);
    showDashboard();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', logout);
$('#refresh').addEventListener('click', () => load(true));
$('#search').addEventListener('input', event => {
  state.query = event.target.value.toLowerCase();
  renderMerchants();
});
$('#customerFilter').addEventListener('change', event => {
  state.filter = event.target.value;
  renderMerchants();
});

async function load(notify = false) {
  try {
    state.data = await api('/api/platform/summary');
    render();
    if (notify) toast('資料已重新整理');
  } catch (error) {
    toast(error.message);
  }
}

function customerGroup(item) {
  const expiredAt = new Date(item.expires_at || item.trial_ends_at || 0).getTime();
  const expired = Number.isFinite(expiredAt) && expiredAt > 0 && expiredAt <= Date.now();
  const stopped = item.subscription_status === 'suspended' || item.active === false || item.can_accept_orders === false || expired;
  if (stopped) return 'inactive';
  if (item.plan === 'trial' || item.subscription_status === 'trialing') return 'new';
  return 'active';
}

function groupLabel(group) {
  return { active: '正在使用', inactive: '沒有在使用', new: '新客戶' }[group] || '全部客戶';
}

function render() {
  const rows = state.data.merchants || [];
  const counts = rows.reduce((result, item) => {
    result[customerGroup(item)] += 1;
    return result;
  }, { active: 0, inactive: 0, new: 0 });
  $('#stats').innerHTML = [
    ['全部店家', rows.length],
    ['正在使用', counts.active],
    ['新客戶', counts.new],
    ['沒有在使用', counts.inactive]
  ].map(([label, value]) => `<button class="stat" type="button" data-filter="${label === '全部店家' ? 'all' : label === '正在使用' ? 'active' : label === '新客戶' ? 'new' : 'inactive'}"><span>${label}</span><b>${value}</b></button>`).join('');
  $('#stats').querySelectorAll('.stat').forEach(button => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    $('#customerFilter').value = state.filter;
    renderMerchants();
  }));
  renderMerchants();
  syncTrialDurations();
}

function syncTrialDurations(root = document) {
  const items = root.matches?.('.merchant') ? [root] : root.querySelectorAll('.merchant');
  items.forEach(item => {
    const plan = item.querySelector('[data-role="plan"]');
    const months = item.querySelector('[data-role="months"]');
    if (!plan || !months) return;
    if (!months.dataset.normal) months.dataset.normal = months.innerHTML;
    if (plan.value === 'trial') {
      months.innerHTML = '<option value="1">固定 14 天</option>';
      months.disabled = true;
    } else if (months.disabled) {
      months.innerHTML = months.dataset.normal;
      months.disabled = false;
    }
  });
}

document.addEventListener('change', event => {
  if (event.target.matches('[data-role="plan"]')) syncTrialDurations(event.target.closest('.merchant'));
  if (event.target.matches('[data-role="months"]')) state.selectedMonths[event.target.closest('.merchant')?.dataset.id] = event.target.value;
});

function planLabel(value) {
  return { trial: '免費試用', basic: '基本版', pro: '專業版' }[value] || value;
}

function statusNote(item, group) {
  if (item.subscription_status === 'suspended' || item.active === false) return '已暫停';
  if (group === 'inactive') return '已過期';
  if (group === 'new') return '試用／未付款';
  return '付費使用中';
}

function renderMerchants() {
  if (!state.data) return;
  const rows = state.data.merchants.filter(item => {
    const text = `${item.name} ${item.slug} ${item.email}`.toLowerCase();
    const matchesGroup = state.filter === 'all' || customerGroup(item) === state.filter;
    return text.includes(state.query) && matchesGroup;
  });
  $('#merchantList').innerHTML = rows.length ? rows.map(item => {
    const group = customerGroup(item);
    const expiry = new Date(item.expires_at || item.trial_ends_at).toLocaleDateString('zh-TW');
    const suspended = item.subscription_status === 'suspended' || item.active === false;
    return `<article class="merchant" data-id="${esc(item.id)}">
      <div>
        <h3>${esc(item.name)} <span class="badge group-${esc(group)}">${esc(groupLabel(group))}</span> <span class="badge plan">${esc(planLabel(item.plan))}</span></h3>
        <div class="merchant-meta">
          <span>${esc(item.email || '未留 Email')}</span>
          <span>代碼：${esc(item.slug)}</span>
          <span>狀態：${esc(statusNote(item, group))}</span>
          <span>到期：${esc(expiry)}</span>
        </div>
        <div class="merchant-stats">
          <span>商品 ${item.product_count}</span>
          <span>訂單 ${item.order_count}</span>
          <span>訂單金額 NT$ ${Number(item.revenue).toLocaleString('zh-TW')}</span>
        </div>
      </div>
      <div class="actions">
        <label>方案<select data-role="plan">
          <option value="basic" ${item.plan === 'basic' ? 'selected' : ''}>基本版</option>
          <option value="pro" ${item.plan === 'pro' ? 'selected' : ''}>專業版</option>
          <option value="trial" ${item.plan === 'trial' ? 'selected' : ''}>免費試用</option>
        </select></label>
        <label>期限<select data-role="months">
          <option value="1" ${(state.selectedMonths[item.id] || '1') === '1' ? 'selected' : ''}>1 個月</option>
          <option value="3" ${state.selectedMonths[item.id] === '3' ? 'selected' : ''}>3 個月</option>
          <option value="6" ${state.selectedMonths[item.id] === '6' ? 'selected' : ''}>6 個月</option>
          <option value="12" ${state.selectedMonths[item.id] === '12' ? 'selected' : ''}>12 個月</option>
        </select></label>
        <button data-action="activate">開通／延長</button>
        <div class="secondary-actions">
          <button class="ghost" data-action="open" data-url="${esc(item.shop_url)}">查看商店</button>
          <button class="${suspended ? 'ghost' : 'danger'}" data-action="suspend" data-suspended="${suspended}">${suspended ? '恢復商店' : '暫停商店'}</button>
        </div>
      </div>
    </article>`;
  }).join('') : '<div class="empty">找不到符合條件的店家</div>';
  $('#merchantList').querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => updateMerchant(button)));
  syncTrialDurations($('#merchantList'));
}

async function updateMerchant(button) {
  const card = button.closest('.merchant');
  const id = card.dataset.id;
  const action = button.dataset.action;
  if (action === 'open') {
    window.open(button.dataset.url, '_blank', 'noopener');
    return;
  }
  let body;
  if (action === 'activate') {
    const months = card.querySelector('[data-role="months"]').value;
    state.selectedMonths[id] = months;
    body = { plan: card.querySelector('[data-role="plan"]').value, months: Number(months), extend: true };
  } else {
    const currentlySuspended = button.dataset.suspended === 'true';
    if (!currentlySuspended && !confirm('確定暫停這間商店？客戶將無法送出新訂單。')) return;
    body = { suspended: !currentlySuspended };
  }
  button.disabled = true;
  try {
    await api(`/api/platform/merchants/${encodeURIComponent(id)}/subscription`, { method: 'PATCH', body: JSON.stringify(body) });
    toast(action === 'activate' ? '方案已開通／延長' : body.suspended ? '商店已暫停' : '商店已恢復');
    await load();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

if (state.token) showDashboard();
