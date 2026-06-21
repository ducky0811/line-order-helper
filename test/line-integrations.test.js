const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { LocalLineIntegrationStore, credentials, publicIntegration } = require('../src/line-integrations');

test('每店 LINE 憑證加密保存且公開資料不含密鑰', async () => {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-encryption-key-which-stays-stable';
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-integrations-'));
    const store = new LocalLineIntegrationStore(dir); await store.init();
    const row = await store.save('store-a', { enabled: true, official_account_id: '@storea', channel_access_token: 'access-token-a', channel_secret: 'secret-a' });
    assert.notEqual(row.channel_access_token_encrypted, 'access-token-a');
    assert.notEqual(row.channel_secret_encrypted, 'secret-a');
    assert.equal(credentials(row).channelAccessToken, 'access-token-a');
    assert.equal(credentials(row).channelSecret, 'secret-a');
    const safe = publicIntegration(row, 'https://shop.example.com');
    assert.equal(safe.configured, true);
    assert.equal(JSON.stringify(safe).includes('access-token-a'), false);
    assert.equal(safe.webhook_url, 'https://shop.example.com/webhook/store-a');
  } finally { if (previous == null) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = previous; }
});
