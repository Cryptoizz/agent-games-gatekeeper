// Core request handler shared by the local server (server.js) and the
// Vercel serverless function (api/gatekeeper.js).
//
// handleRequest({ method, path, rawBody, headers }) ->
//   { status, body (object), sign (bool) }
//
// Behaviour:
//   GET  /health            -> readiness info (unsigned)
//   GET  /                  -> service info (unsigned)
//   POST <any path>         -> protocol endpoint (register the full path):
//        1. Verify x-agent-games-signature over the RAW body BEFORE parsing.
//           Bad signature -> 401 (signed error body).
//        2. Preflight envelope {type:"agent-games.preflight.v1"} ->
//           200 { ok:true, protocolVersion:"v1" }, signed.
//        3. Gatekeeper task envelope -> decide + prove -> signed JSON:
//           { decision, reason_code, proof_tx, proof, public_signals }
//           PROOF_REUSED and INVALID_TASK responses carry no proof.
//           If proof generation fails, the decision is still returned
//           without a proof (never crash, never approve by accident — the
//           decision itself comes from deterministic code).
//   Everything fails closed: malformed JSON -> REJECT/INVALID_TASK once the
//   signature check has passed; unexpected errors -> 500 signed error.
const { verifySignature, signatureFor } = require('./hmac');
const { decide } = require('./decide');
const { proveTask, TASK_ID_MODE } = require('./prove');
const { submitProof } = require('./kurier');

// LOCAL PLACEHOLDER — for local tests only. In production this MUST be the
// platform-issued secret from the dashboard "Rotate Secret", supplied via
// the AGENT_GAMES_HMAC_SECRET environment variable. A placeholder secret
// will fail the platform preflight with a signature error (by design).
const PLACEHOLDER_SECRET = 'LOCAL_PLACEHOLDER_NOT_FOR_PRODUCTION';
const HMAC_SECRET = process.env.AGENT_GAMES_HMAC_SECRET || PLACEHOLDER_SECRET;
const HMAC_FORMAT = process.env.AGENT_GAMES_HMAC_FORMAT || 'hex'; // or 'sha256='
const KURIER_API_KEY = process.env.KURIER_API_KEY || '';
const PROVE_TIMEOUT_MS = Number(process.env.PROVE_TIMEOUT_MS || 50000);

const REQUIRED_FIELDS = [
  'registered_vk',
  'proof_vk',
  'minimum',
  'public_balance',
  'expiry_block',
  'current_block',
  'recipient',
  'condition_recipient',
  'amount',
  'max_transfer',
];

function sign(bodyString) {
  return signatureFor(HMAC_SECRET, bodyString, HMAC_FORMAT);
}

async function handleGatekeeper(obj) {
  const input = obj && typeof obj === 'object' ? obj.input || {} : {};
  const task = { ...input, task_id: obj.task_id || input.task_id || '' };
  const proofTx = String(input.proof_tx || '');

  for (const f of REQUIRED_FIELDS) {
    if (input[f] === undefined || input[f] === null || input[f] === '') {
      return {
        status: 200,
        sign: true,
        body: { decision: 'REJECT', reason_code: 'INVALID_TASK', proof_tx: proofTx },
      };
    }
  }

  let verdict;
  try {
    verdict = decide(task);
  } catch (e) {
    // e.g. non-numeric amount/balance fields — fail closed.
    console.error('[gatekeeper] decide() failed:', e.message);
    return {
      status: 200,
      sign: true,
      body: { decision: 'REJECT', reason_code: 'INVALID_TASK', proof_tx: proofTx },
    };
  }
  const { decision, reason_code } = verdict;

  if (reason_code === 'PROOF_REUSED') {
    // No proof exists for a reuse rejection (the circuit has no "seen"
    // input); the event page states PROOF_REUSED tasks are excluded from
    // the reliability bonus, so omitting the proof costs nothing.
    return { status: 200, sign: true, body: { decision, reason_code, proof_tx: proofTx } };
  }

  try {
    const proved = await Promise.race([
      proveTask(task, decision),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('proof generation timeout')), PROVE_TIMEOUT_MS)
      ),
    ]);
    if (KURIER_API_KEY) {
      // Best-effort on-chain finalization pointer; never blocks the response.
      submitProof(KURIER_API_KEY, proved.proof, proved.publicSignals).catch(() => {});
    }
    return {
      status: 200,
      sign: true,
      body: {
        decision,
        reason_code,
        proof_tx: proofTx,
        proof: proved.proof,
        public_signals: proved.publicSignals,
      },
    };
  } catch (e) {
    console.error('[gatekeeper] proof generation failed (decision returned without proof):', e.message);
    return { status: 200, sign: true, body: { decision, reason_code, proof_tx: proofTx } };
  }
}

async function handleRequest({ method, path, rawBody, headers }) {
  const p = String(path || '/').split('?')[0];

  if (method === 'GET' && (p === '/health' || p.endsWith('/health'))) {
    return {
      status: 200,
      sign: false,
      body: {
        ok: true,
        service: 'agent-games-proof-gatekeeper',
        hmacConfigured: process.env.AGENT_GAMES_HMAC_SECRET ? true : false,
        hmacFormat: HMAC_FORMAT,
        taskIdMode: TASK_ID_MODE,
        kurierConfigured: !!KURIER_API_KEY,
        uptimeSec: Math.floor(process.uptime()),
      },
    };
  }
  if (method === 'GET') {
    return {
      status: 200,
      sign: false,
      body: {
        service: 'agent-games-proof-gatekeeper',
        endpoints: ['POST /gatekeeper (also /agent, /api/gatekeeper)', 'GET /health'],
      },
    };
  }
  if (method !== 'POST') {
    return { status: 404, sign: true, body: { error: 'not found' } };
  }

  // 1) HMAC over the RAW body, before parsing.
  const sig = headers && (headers['x-agent-games-signature'] || headers['X-Agent-Games-Signature']);
  if (!verifySignature(HMAC_SECRET, rawBody, sig)) {
    console.warn('[gatekeeper] HMAC mismatch — rejecting request');
    return { status: 401, sign: true, body: { error: 'bad signature' } };
  }

  // 2) Parse.
  let obj;
  try {
    obj = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return {
      status: 200,
      sign: true,
      body: { decision: 'REJECT', reason_code: 'INVALID_TASK', proof_tx: '' },
    };
  }

  // 3) Preflight.
  if (obj && obj.type === 'agent-games.preflight.v1') {
    return { status: 200, sign: true, body: { ok: true, protocolVersion: 'v1' } };
  }

  // 4) Gatekeeper task (any other signed POST is treated as a task envelope).
  return handleGatekeeper(obj);
}

module.exports = {
  handleRequest,
  sign,
  HMAC_SECRET,
  PLACEHOLDER_SECRET,
  HMAC_FORMAT,
};
