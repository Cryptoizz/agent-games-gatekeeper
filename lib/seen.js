// Persistent seen-set for proof_tx (PROOF_REUSED detection).
//
// Maps proof_tx (lowercased) -> task_id that first used it. A proof_tx seen
// again under a DIFFERENT task_id is a reuse; a retry of the same task_id is
// not. Backed by a JSON file (default: <project>/data/seen.json, override
// with SEEN_STORE_PATH). Writes are atomic (tmp file + rename). On serverless
// hosts the project filesystem may be read-only/ephemeral — set
// SEEN_STORE_PATH=/tmp/seen.json there; all I/O failures degrade gracefully
// to the in-memory map and never crash a request.
const fs = require('fs');
const path = require('path');

const STORE_PATH =
  process.env.SEEN_STORE_PATH || path.join(__dirname, '..', 'data', 'seen.json');

let map = null; // Map<string, string>

function load() {
  if (map) return map;
  map = new Map();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
  } catch {
    // missing/corrupt store -> start empty
  }
  return map;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const tmp = STORE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)));
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    console.warn('[seen] could not persist seen-set:', e.message);
  }
}

// Returns the task_id that first used this proof_tx, or undefined.
function seenBy(proofTx) {
  return load().get(String(proofTx).toLowerCase());
}

// Records proof_tx -> taskId if not already present. Returns true if newly recorded.
function record(proofTx, taskId) {
  const m = load();
  const key = String(proofTx).toLowerCase();
  if (m.has(key)) return false;
  m.set(key, String(taskId));
  persist();
  return true;
}

function reset() {
  map = new Map();
  persist();
}

module.exports = { seenBy, record, reset, STORE_PATH };
