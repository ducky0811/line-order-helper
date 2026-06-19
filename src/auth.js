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

  function issueToken() {
    if (!password || !secret) throw new Error('尚未設定 ADMIN_PASSWORD 與 SESSION_SECRET');
    const payload = Buffer.from(JSON.stringify({ issuedAt: Date.now() })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    if (!token || !secret) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return Number.isFinite(data.issuedAt) && Date.now() - data.issuedAt < TOKEN_LIFETIME_MS;
    } catch {
      return false;
    }
  }

  function login(req, res) {
    if (!password) return res.status(503).json({ error: '管理密碼尚未設定' });
    if (!safeEqual(req.body?.password, password)) {
      return res.status(401).json({ error: '密碼不正確' });
    }
    return res.json({ token: issueToken() });
  }

  function requireAdmin(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!verifyToken(token)) return res.status(401).json({ error: '請重新登入' });
    return next();
  }

  return { login, requireAdmin, issueToken, verifyToken };
}

module.exports = { createAuth };
