// Proof Gatekeeper — local Groth16 proof generation with snarkjs.
//
// Circuit inputs (probed from the official gatekeeper.wasm and cross-checked
// empirically in test/prove.test.js — witness generation succeeds with
// exactly these names and fails if the decision contradicts the circuit):
//   registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
//   currentBlock, recipient, conditionRecipient, amount, maxTransfer,
//   decision (1 = APPROVE, 0 = REJECT), taskId, salt (private, random)
//
// Public signals (13, in order, as returned by snarkjs fullProve):
//   [ bindingHash, registeredVkHash, proofVkHash, minimum, publicBalance,
//     expiryBlock, currentBlock, recipient, conditionRecipient, amount,
//     maxTransfer, decision, taskId ]
// bindingHash is a salt-dependent hash computed inside the circuit; the
// other 12 echo the task fields (as field elements, mod p) + decision.
//
// taskId mapping (OPEN ITEM — confirm in practice mode after registration):
//   The envelope's task_id is a string like "gk_24_9d1"; the circuit needs a
//   field element. Default mode "keccak": keccak256(utf8(task_id)) mod p.
//   Alternatives via GATEKEEPER_TASK_ID_MODE: "numeric" (digits of the id as
//   a decimal number), "hex" (hex chars of the id as a number). This mapping
//   is a single function below — nothing else changes if it must switch.
const crypto = require('crypto');
const path = require('path');
const snarkjs = require('snarkjs');
const { toField, keccak256ModP } = require('./field');

const CIRCUITS_DIR =
  process.env.CIRCUITS_DIR || path.join(__dirname, '..', 'circuits');
const WASM = path.join(CIRCUITS_DIR, 'gatekeeper.wasm');
const ZKEY = path.join(CIRCUITS_DIR, 'gatekeeper_final.zkey');

const TASK_ID_MODE = process.env.GATEKEEPER_TASK_ID_MODE || 'keccak';

function taskIdToField(taskId, mode = TASK_ID_MODE) {
  const id = String(taskId || '');
  if (mode === 'numeric') {
    const digits = id.replace(/\D/g, '');
    return digits ? toField(BigInt(digits)) : 0n;
  }
  if (mode === 'hex') {
    const hex = id.replace(/[^0-9a-fA-F]/g, '');
    return hex ? toField(BigInt('0x' + hex)) : 0n;
  }
  return keccak256ModP([Buffer.from(id, 'utf8')]);
}

// `task` is the envelope's `input` object plus task_id.
function buildInput(task, decision) {
  const salt = '0x' + crypto.randomBytes(32).toString('hex');
  return {
    registeredVkHash: String(task.registered_vk),
    proofVkHash: String(task.proof_vk),
    minimum: String(task.minimum),
    publicBalance: String(task.public_balance),
    expiryBlock: String(task.expiry_block),
    currentBlock: String(task.current_block),
    recipient: String(task.recipient),
    conditionRecipient: String(task.condition_recipient),
    amount: String(task.amount),
    maxTransfer: String(task.max_transfer),
    decision: decision === 'APPROVE' ? '1' : '0',
    taskId: taskIdToField(task.task_id).toString(),
    salt,
  };
}

async function proveTask(task, decision) {
  const input = buildInput(task, decision);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return { proof, publicSignals };
}

let vkCache = null;
async function getVerificationKey() {
  if (!vkCache) vkCache = await snarkjs.zKey.exportVerificationKey(ZKEY);
  return vkCache;
}

async function verifyLocally(publicSignals, proof) {
  const vk = await getVerificationKey();
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}

module.exports = {
  taskIdToField,
  buildInput,
  proveTask,
  verifyLocally,
  getVerificationKey,
  CIRCUITS_DIR,
  WASM,
  ZKEY,
  TASK_ID_MODE,
};
