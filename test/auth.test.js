const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuth } = require('../src/auth');

test('管理登入權杖可驗證且竄改後失效', () => {
  const auth = createAuth({ password: 'demo-password', secret: 'test-secret' });
  const token = auth.issueToken();
  assert.equal(auth.verifyToken(token), true);
  assert.equal(auth.verifyToken(`${token}broken`), false);
});
