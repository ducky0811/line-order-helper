const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { LocalStore } = require('../src/store');
const { LocalTenantRegistry } = require('../src/tenants');
const { LocalLineIntegrationStore } = require('../src/line-integrations');
const { LocalSheetIntegrationStore } = require('../src/sheet-integrations');
const { createAuth } = require('../src/auth');

test('平台管理員可查看店家並開通專業版，店家權杖不能進入平台後台', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'platform-admin-'));
  await fs.writeFile(path.join(dir, 'menu.json'), '[]');
  const store = new LocalStore(path.join(dir, 'default'));
  const tenantRegistry = new LocalTenantRegistry(dir);
  const auth = createAuth({ password: 'legacy-password', secret: 'merchant-secret' });
  const bot = { middleware: (_req, _res, next) => next(), handleEvent: async () => null, notifyOrderStatus: async () => null, notifyNewOrder: async () => null };
  const { app } = await createApp({ rootDir: dir, store, tenantRegistry, auth, bot, lineIntegrations: new LocalLineIntegrationStore(dir), sheetIntegrations: new LocalSheetIntegrationStore(dir), sheets: { available: false, serviceAccountEmail: '', saveOrder: async () => null }, lineIdentity: { verify: async () => null }, platformPassword: 'strong-platform-password', platformSecret: 'separate-platform-secret' });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const merchant = await fetch(`${base}/api/admin/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'cake-shop', store_name: '蛋糕店', email: 'owner@example.com', password: 'password123' }) }).then(response => response.json());
    const denied = await fetch(`${base}/api/platform/summary`, { headers: { Authorization: `Bearer ${merchant.token}` } }); assert.equal(denied.status, 401);
    const wrong = await fetch(`${base}/api/platform/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) }); assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/platform/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'strong-platform-password' }) }).then(response => response.json());
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
    const summary = await fetch(`${base}/api/platform/summary`, { headers }).then(response => response.json()); assert.equal(summary.merchants[0].email, 'owner@example.com'); assert.equal(summary.totals.trial, 1);
    const trialReport = await fetch(`${base}/api/admin/reports/sales?range=all`, { headers: { Authorization: `Bearer ${merchant.token}` } }); assert.equal(trialReport.status, 200);
    const basic = await fetch(`${base}/api/platform/merchants/cake-shop/subscription`, { method: 'PATCH', headers, body: JSON.stringify({ plan: 'basic', months: 1 }) }).then(response => response.json()); assert.equal(basic.plan, 'basic');
    const basicReport = await fetch(`${base}/api/admin/reports/sales?range=all`, { headers: { Authorization: `Bearer ${merchant.token}` } }); assert.equal(basicReport.status, 403);
    const updated = await fetch(`${base}/api/platform/merchants/cake-shop/subscription`, { method: 'PATCH', headers, body: JSON.stringify({ plan: 'pro', months: 1 }) }).then(response => response.json()); assert.equal(updated.plan, 'pro'); assert.equal(updated.subscription_status, 'active');
    const account = await fetch(`${base}/api/admin/account`, { headers: { Authorization: `Bearer ${merchant.token}` } }).then(response => response.json()); assert.equal(account.capabilities.sheets, false); assert.equal(account.capabilities.reports, true); assert.equal(account.merchant.plan, 'pro');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
