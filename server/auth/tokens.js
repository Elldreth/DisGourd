const crypto = require('crypto');
const { config } = require('../config');

// ---- JWT (HS256, hand-rolled to avoid dependencies) ----
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function base64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// Loaded on first use: requiring the database opens it, and this module is
// required before tests set DB_PATH.
const db = () => require('../db');

// Tokens carry the user's token version (P6-02); a password change bumps it,
// so older tokens stop verifying. Tokens from before v25 have none: 0.
// Tokens also carry the signed-in device's session id (`sid`, P9-03).
function createToken(userId, username, sid) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const ver = db().getTokenVersion(userId) || 0;
  const payload = base64urlJson({ sub: userId, name: username, ver, ...(sid ? { sid } : {}), iat: now, exp: now + TOKEN_TTL_SECONDS });
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifyToken(token) {
  try {
    const [headerB, payloadB, signature] = token.split('.');
    if (!headerB || !payloadB || !signature) return null;
    const data = `${headerB}.${payloadB}`;
    const expected = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(payloadB, 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    // Signed out by a password change, or the account is gone.
    const current = db().getTokenVersion(payload.sub);
    if (current === null || (payload.ver || 0) !== current) return null;
    // Signed out on the devices list (P9-03): its session is gone. Tokens
    // from before sessions existed have no sid and run until they expire.
    if (payload.sid) {
      const session = db().getSession(payload.sid);
      if (!session || Number(session.userId) !== Number(payload.sub)) return null;
      db().touchSession(session);
    }
    return payload;
  } catch {
    return null;
  }
}

// The verified token's payload for a request ({ sub, sid?, … }), or null.
// Only from the Authorization header: a token in the URL ends up in logs
// (P11-07). `parsedUrl` stays in the signature for the callers.
function authPayload(req, parsedUrl) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return verifyToken(token);
}

function authUserId(req, parsedUrl) {
  const payload = authPayload(req, parsedUrl);
  return payload ? payload.sub : null;
}

module.exports = { TOKEN_TTL_SECONDS, createToken, verifyToken, authUserId, authPayload };
