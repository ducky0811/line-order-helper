const crypto = require('crypto');

const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function decodeImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match || !ALLOWED_TYPES.has(match[1])) throw new Error('只支援 JPG、PNG 或 WebP 圖片');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('圖片內容是空的');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('圖片太大，請選擇較小的照片');
  return { mimeType: match[1], extension: ALLOWED_TYPES.get(match[1]), buffer };
}

function createImageService() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';
  const merchant = String(process.env.MERCHANT_ID || 'default-store').replace(/[^a-zA-Z0-9_-]/g, '-');

  return {
    async upload(dataUrl) {
      if (!url || !key) throw new Error('尚未設定 Supabase 圖片儲存空間');
      const image = decodeImage(dataUrl);
      const objectPath = `${merchant}/${crypto.randomUUID()}.${image.extension}`;
      const headers = { apikey: key, 'Content-Type': image.mimeType, 'x-upsert': 'false' };
      if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`;
      const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
        method: 'POST', headers, body: image.buffer
      });
      if (!response.ok) throw new Error(`圖片上傳失敗：${await response.text()}`);
      return `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
    }
  };
}

module.exports = { createImageService, decodeImage, MAX_IMAGE_BYTES };
