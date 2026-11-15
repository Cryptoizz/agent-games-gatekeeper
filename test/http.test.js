// HTTP end-to-end tests against the local server (server.js) using the
// LOCAL PLACEHOLDER secret (AGENT_GAMES_HMAC_SECRET unset on purpose):
//   - GET /health
//   - signed preflight -> { ok:true, protocolVersion:"v1" } + valid response signature
//   - signed VALID task -> APPROVE with proof + public_signals, signature valid,
//     and the returned proof verifies locally against the official VK
//   - signed VK_SUBSTITUTION task -> REJECT with proof
//   - bad signature -> 401
//   - same proof_tx under a new task_id -> PROOF_REUSED without proof
// Run: node test/http.test.js
const { spawn } = require('child_process');
const path = require('path');
const { hmacHex, verifySignature } = require('../lib/hmac');
const { PLACEHOLDER_SECRET } = require('../lib/handler');
const { verifyLocally } = require('../lib/prove');
const seen = require('../lib/seen');
const { envelope } = require('./samples');

const PORT = 18787;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0;
let fail = 0;
function report(ok, name, extra = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

async function post(pathname, bodyObj, { sign = true, secret = PLACEHOLDER_SECRET } = {}) {
  const raw = JSON.stringify(bodyObj);
  const headers = { 'content-type': 'application/json' };
  if (sign) headers['x-agent-games-signature'] = hmacHex(secret, raw);
  const res = await fetch(BASE + pathname, { method: 'POST', headers, body: raw });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text), sig: res.headers.get('x-agent-games-signature') };
}

async function waitForServer(proc) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

(async () => {
  seen.reset();
  const env = { ...process.env, PORT: String(PORT) };
  delete env.AGENT_GAMES_HMAC_SECRET; // force the local placeholder path
  const proc = spawn('node', [path.join(__dirname, '..', 'server.js')], { env, stdio: 'pipe' });
  proc.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  try {
    report(await waitForServer(proc), 'server starts and /health responds');

    const health = await (await fetch(BASE + '/health')).json();
    report(health.ok === true && health.hmacConfigured === false,
      'health reports placeholder mode (hmacConfigured=false)');

    // Preflight
    const pf = await post('/gatekeeper', {
      type: 'agent-games.preflight.v1', agent_id: 'agt_test', issued_at: '2026-11-15T12:00:00.000Z', nonce: 'abc123',
    });
    report(pf.status === 200 && pf.json.ok === true && pf.json.protocolVersion === 'v1',
      'preflight -> { ok:true, protocolVersion:"v1" }');
    report(verifySignature(PLACEHOLDER_SECRET, pf.text, pf.sig),
      'preflight response signature verifies');

    // VALID task
    const envValid = envelope({ proof_tx: '0xhttpvalid1' });
    const okRes = await post('/gatekeeper', envValid);
    report(okRes.status === 200 && okRes.json.decision === 'APPROVE' && okRes.json.reason_code === 'VALID_CONDITION',
      'VALID task -> APPROVE/VALID_CONDITION', `got ${okRes.json.decision}/${okRes.json.reason_code}`);
    report(!!okRes.json.proof && Array.isArray(okRes.json.public_signals) && okRes.json.public_signals.length === 13,
      'VALID task response carries proof + 13 public_signals');
    report(okRes.json.proof_tx === '0xhttpvalid1', 'VALID task response echoes proof_tx');
    report(verifySignature(PLACEHOLDER_SECRET, okRes.text, okRes.sig),
      'VALID task response signature verifies');
    const proofOk = await verifyLocally(okRes.json.public_signals, okRes.json.proof);
    report(proofOk, 'VALID task response proof verifies against official VK');

    // VK_SUBSTITUTION task (via the /agent alias path)
    const { OTHER_VK } = require('./samples');
    const envVk = envelope({ proof_vk: OTHER_VK, proof_tx: '0xhttpvk1' });
    const vkRes = await post('/agent', envVk);
    report(vkRes.status === 200 && vkRes.json.decision === 'REJECT' && vkRes.json.reason_code === 'VK_SUBSTITUTION' && !!vkRes.json.proof,
      'VK_SUBSTITUTION task (via /agent) -> REJECT/VK_SUBSTITUTION with proof');

    // Bad signature
    const bad = await post('/gatekeeper', envelope({ proof_tx: '0xhttpbad1' }), { secret: 'wrong-secret' });
    report(bad.status === 401, 'bad signature -> 401', `got ${bad.status}`);

    // Missing signature
    const noSig = await post('/gatekeeper', envelope({ proof_tx: '0xhttpbad2' }), { sign: false });
    report(noSig.status === 401, 'missing signature -> 401', `got ${noSig.status}`);

    // PROOF_REUSED over HTTP: same proof_tx, different task_id
    const reuseEnv = envelope({ proof_tx: '0xhttpvalid1' }, { task_id: 'gk_other_task' });
    const reuseRes = await post('/gatekeeper', reuseEnv);
    report(reuseRes.status === 200 && reuseRes.json.reason_code === 'PROOF_REUSED' && !reuseRes.json.proof,
      'PROOF_REUSED -> REJECT/PROOF_REUSED without proof');
  } finally {
    proc.kill('SIGTERM');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
