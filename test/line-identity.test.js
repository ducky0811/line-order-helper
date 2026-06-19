const test = require('node:test');
const assert = require('node:assert/strict');
const { createLineIdentityService } = require('../src/line-identity');

test('LINE Access Token 必須經 LINE API 驗證後才取得 user ID', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer valid-token');
    return { ok: true, json: async () => ({ userId: 'Uverified' }) };
  };
  try {
    assert.equal(await createLineIdentityService().verify('valid-token'), 'Uverified');
  } finally {
    global.fetch = originalFetch;
  }
});
