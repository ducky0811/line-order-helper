const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { LocalSheetIntegrationStore, spreadsheetId, publicSheetIntegration } = require('../src/sheet-integrations');
const { planCapabilities, retentionPolicy } = require('../src/tenants');
const { friendlySheetsError } = require('../src/app');

test('每間店的 Google 試算表設定互不相通', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sheet-integrations-'));
  const store = new LocalSheetIntegrationStore(dir);
  await store.init();
  await store.save('store-a', { enabled: true, spreadsheet_url: 'https://docs.google.com/spreadsheets/d/abc_A-123/edit', sheet_name: '訂單' });
  await store.save('store-b', { enabled: true, spreadsheet_url: 'sheet_B-456', sheet_name: 'Orders' });
  assert.equal((await store.get('store-a')).spreadsheet_id, 'abc_A-123');
  assert.equal((await store.get('store-b')).spreadsheet_id, 'sheet_B-456');
  assert.equal(publicSheetIntegration(await store.get('store-a'), 'robot@example.com').service_account_email, 'robot@example.com');
  assert.equal(spreadsheetId('https://docs.google.com/spreadsheets/d/demo_789/edit#gid=0'), 'demo_789');
});

test('基本版與專業版權限及保存時間正確', () => {
  assert.deepEqual({ line: planCapabilities({ plan: 'trial' }).line, reports: planCapabilities({ plan: 'trial' }).reports, days: planCapabilities({ plan: 'trial' }).retention_days }, { line: true, reports: true, days: 30 });
  assert.deepEqual({ line: planCapabilities({ plan: 'basic' }).line, reports: planCapabilities({ plan: 'basic' }).reports, days: planCapabilities({ plan: 'basic' }).retention_days }, { line: false, reports: false, days: 365 });
  assert.deepEqual({ line: planCapabilities({ plan: 'pro' }).line, reports: planCapabilities({ plan: 'pro' }).reports, days: planCapabilities({ plan: 'pro' }).retention_days }, { line: true, reports: true, days: 1095 });
  const policy = retentionPolicy({ plan: 'trial', trial_ends_at: '2026-01-15T00:00:00.000Z', expires_at: '2026-01-15T00:00:00.000Z' }, new Date('2026-01-20T00:00:00.000Z'));
  assert.equal(policy.delete_at, '2026-02-14T00:00:00.000Z');
  assert.equal(policy.purge_before, null);
});

test('Google 試算表錯誤會顯示可操作的中文原因', () => {
  assert.match(friendlySheetsError(new Error('找不到名為「訂單」的工作表')), /找不到名為/);
  assert.match(friendlySheetsError(new Error('The caller does not have permission 403')), /編輯權限/);
  assert.match(friendlySheetsError(new Error('Google Sheets API has not been used or is disabled')), /尚未啟用/);
  assert.match(friendlySheetsError(new Error('error: DECODER routines unsupported')), /金鑰/);
});
