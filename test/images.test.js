const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeImage } = require('../src/images');

test('圖片上傳只接受允許的圖片格式', () => {
  const image = decodeImage(`data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`);
  assert.equal(image.mimeType, 'image/png');
  assert.throws(() => decodeImage('data:text/plain;base64,dGVzdA=='), /只支援/);
});
