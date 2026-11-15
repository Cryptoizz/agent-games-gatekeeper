// Local server for the Proof Gatekeeper agent (plain node:http, no framework).
// Usage: node server.js   (PORT env, default 8787)
// Register the FULL path with the platform, e.g. https://<host>/gatekeeper
// (/agent works as an alias; the platform posts to the URL exactly as
// registered — a path that 404s fails preflight and every task).
const http = require('http');
const { handleRequest, sign, HMAC_SECRET, PLACEHOLDER_SECRET } = require('./lib/handler');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const rawBody = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
    const result = await handleRequest({
      method: req.method,
      path: req.url,
      rawBody,
      headers: req.headers,
    });
    const body = JSON.stringify(result.body);
    const headers = { 'Content-Type': 'application/json' };
    if (result.sign) headers['x-agent-games-signature'] = sign(body);
    res.writeHead(result.status, headers);
    res.end(body);
  } catch (e) {
    console.error('[server] unhandled error:', e);
    const body = JSON.stringify({ error: 'internal error' });
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'x-agent-games-signature': sign(body),
    });
    res.end(body);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[gatekeeper] listening on http://${HOST}:${PORT}  (POST /gatekeeper, POST /agent, GET /health)`);
  console.log(
    `[gatekeeper] HMAC secret: ${
      HMAC_SECRET === PLACEHOLDER_SECRET
        ? 'LOCAL PLACEHOLDER (set AGENT_GAMES_HMAC_SECRET before going live — preflight will fail with this)'
        : 'configured from AGENT_GAMES_HMAC_SECRET'
    }`
  );
});
