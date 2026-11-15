// HMAC helpers for the Agent Games protocol.
//
// The platform signs every inbound envelope with the dashboard-issued secret
// ("Rotate Secret") and puts the signature in the `x-agent-games-signature`
// header. We verify it over the RAW request body BEFORE parsing JSON, and we
// sign every response the same way (header over the raw response body).
//
// FORMAT NOTE (UNCONFIRMED by official docs): the official pages never state
// the exact HMAC algorithm/encoding. The standard assumption — also used by
// public participant implementations — is HMAC-SHA256, lowercase hex digest.
// An alternative `sha256=<hex>` form is supported via AGENT_GAMES_HMAC_FORMAT.
// Inbound verification accepts BOTH forms regardless of the configured
// outbound format, to maximise the chance the preflight passes; the platform
// preflight is the authoritative check and will reveal the right form.
const crypto = require('crypto');

function hmacHex(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function signatureFor(secret, rawBody, format) {
  const hex = hmacHex(secret, rawBody);
  return format === 'sha256=' ? 'sha256=' + hex : hex;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// Accepts plain hex or `sha256=<hex>` inbound, in either case comparing
// against HMAC-SHA256(secret, rawBody) in constant time.
function verifySignature(secret, rawBody, headerValue) {
  if (!secret || !headerValue) return false;
  const expectedHex = hmacHex(secret, rawBody);
  const given = String(headerValue).trim();
  if (safeEqual(given, expectedHex)) return true;
  if (safeEqual(given, 'sha256=' + expectedHex)) return true;
  return false;
}

module.exports = { hmacHex, signatureFor, verifySignature };
