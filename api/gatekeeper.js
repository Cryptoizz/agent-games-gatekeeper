// Vercel serverless handler for the Proof Gatekeeper agent.
// Deploy the project root to Vercel; this function is served at
// /api/gatekeeper — register THAT full URL as the agent endpoint.
//
// It shares lib/handler.js with the local server. The raw request body is
// required for HMAC verification, so body parsing must stay off: if Vercel
// has pre-parsed the body into an object (runtime-dependent), we fall back
// to re-serialising it and log a warning — the platform preflight is the
// authoritative check that raw-body signing works end to end.
const { handleRequest, sign } = require('../lib/handler');

async function readRawBody(req) {
  if (req.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    console.warn('[gatekeeper] req.body arrived pre-parsed; re-serialising (HMAC may mismatch)');
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  try {
    const rawBody = req.method === 'POST' ? await readRawBody(req) : Buffer.alloc(0);
    const result = await handleRequest({
      method: req.method,
      path: req.url,
      rawBody,
      headers: req.headers,
    });
    const body = JSON.stringify(result.body);
    res.setHeader('Content-Type', 'application/json');
    if (result.sign) res.setHeader('x-agent-games-signature', sign(body));
    res.status(result.status).end(body);
  } catch (e) {
    console.error('[gatekeeper] unhandled error:', e);
    const body = JSON.stringify({ error: 'internal error' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('x-agent-games-signature', sign(body));
    res.status(500).end(body);
  }
};

// Next.js-style opt-out (harmless for plain Vercel functions, required if
// this file is ever moved into a Next.js app's pages/api directory).
module.exports.config = { api: { bodyParser: false } };
