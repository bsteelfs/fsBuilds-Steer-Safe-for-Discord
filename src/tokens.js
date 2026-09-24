const crypto = require('crypto');

/**
 * Compact, tamper-proof tokens for the links we hand to a browser.
 *
 * Format:  base64url(payload) + "." + base64url(HMAC-SHA256(payload))
 *
 * Used for the /store BUY links and the OAuth `state` value, so a player's
 * Discord id and the product path never ride in a URL as readable, editable
 * query params. This is SIGNING, not encryption — the payload is still readable;
 * the signature only proves the bot minted it and it wasn't altered, and the
 * `exp` field keeps a leaked link from working forever.
 *
 * Secret: LINK_TOKEN_SECRET (any long random string — see .env.example).
 */
function secret() {
  const s = process.env.LINK_TOKEN_SECRET;
  if (!s) throw new Error('LINK_TOKEN_SECRET is not set (see .env.example).');
  return s;
}

/** Signs a small payload object, embedding an expiry `exp` (seconds since epoch). */
function sign(payload, ttlSeconds = 900) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const json = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(json).digest('base64url');
  return `${json}.${sig}`;
}

/**
 * Verifies a token and returns its payload, or null if the signature is invalid,
 * the token is malformed, or it has expired. Callers must treat null as "reject".
 */
function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [json, sig] = token.split('.');
  if (!json || !sig) return null;

  const expected = crypto.createHmac('sha256', secret()).update(json).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null; // length mismatch → not a valid signature
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

module.exports = { sign, verify };
