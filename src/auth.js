const crypto = require('crypto');

const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAuth(options = {}) {
  const password = options.password || process.env.ADMIN_PASSWORD || process.env.PASSWORD;
  const secret = options.secret || process.env.SESSION_SECRET || password;

  function sign(payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  }

  function issueToken(merchantId = process.env.MERCHANT_ID || 'default-store', extra = {}) {
    if (!secret) throw new Error('尚未設定 SESSION_SECRET');
    const payload = Buffer.from(JSON.stringify({ issuedAt: Date.now(), merchantId, ...extra })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function readToken(token) {
    if (!token || !secret) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return Number.isFinite(data.issuedAt) && Date.now() - data.issuedAt < TOKEN_LIFETIME_MS ? data : null;
    } catch {
      return null;
    }
  }
  function verifyToken(token) { return Boolean(readToken(token)); }

  function login(req, res) {
    if (!password) return res.status(503).json({ error: '管理密碼尚未設定' });
    if (!safeEqual(req.body?.password, password)) {
      return res.status(401).json({ error: '密碼不正確' });
    }
    return res.json({ token: issueToken(process.env.MERCHANT_ID || 'default-store') });
  }

  function requireAdmin(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = readToken(token);
    if (!session) return res.status(401).json({ error: '請重新登入' });
    req.merchantId = session.merchantId || process.env.MERCHANT_ID || 'default-store';
    req.session = session;
    return next();
  }

  return { login, requireAdmin, issueToken, verifyToken, readToken };
}

module.exports = { createAuth };
