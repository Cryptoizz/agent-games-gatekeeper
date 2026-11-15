// Proof Gatekeeper — deterministic decision logic (no model in the loop).
//
// The gatekeeper circuit is the referee: it enforces that `decision` matches
// the circuit's own evaluation of the task fields, so a wrong decision fails
// witness generation. This module must therefore mirror the circuit exactly.
//
// Checks — FIRST failing trap wins (reason_code = trap name):
//   VK_SUBSTITUTION    proof_vk != registered_vk            (case-insensitive)
//   PROOF_REUSED       proof_tx already seen under a DIFFERENT task_id
//   THRESHOLD_MISMATCH public_balance < minimum
//   EXPIRED_CONDITION  current_block >= expiry_block        (STRICT — see below)
//   RECIPIENT_MISMATCH recipient != condition_recipient     (case-insensitive)
//   AMOUNT_OVERFLOW    amount > max_transfer
//   else               APPROVE / VALID_CONDITION
//
// Boundary behaviour (empirically verified against the official circuit in
// test/prove.test.js, 2026-11-15):
//   - public_balance == minimum  -> VALID   (threshold is inclusive)
//   - amount == max_transfer     -> VALID   (cap is inclusive)
//   - current_block == expiry_block -> EXPIRED (expiry is STRICT: a condition
//     is only valid while current_block < expiry_block; witness generation
//     for APPROVE at the boundary fails). NOTE: this differs from a naive
//     reading of the event page; the circuit wins.
//   - proof_tx reuse is tracked per task_id: a platform retry of the SAME
//     task_id is not a reuse. The seen-set records proof_tx when the reuse
//     check runs (i.e. after the VK check passes), mirroring the reference
//     behaviour probed from the circuit ecosystem.
const seen = require('./seen');

function decide(input) {
  const registeredVk = String(input.registered_vk || '').toLowerCase();
  const proofVk = String(input.proof_vk || '').toLowerCase();
  const minimum = BigInt(String(input.minimum));
  const publicBalance = BigInt(String(input.public_balance));
  const expiryBlock = BigInt(String(input.expiry_block));
  const currentBlock = BigInt(String(input.current_block));
  const recipient = String(input.recipient || '').toLowerCase();
  const conditionRecipient = String(input.condition_recipient || '').toLowerCase();
  const amount = BigInt(String(input.amount));
  const maxTransfer = BigInt(String(input.max_transfer));
  const proofTx = String(input.proof_tx || '').toLowerCase();
  const taskId = String(input.task_id || '');

  if (proofVk !== registeredVk) {
    return { decision: 'REJECT', reason_code: 'VK_SUBSTITUTION' };
  }

  if (proofTx) {
    const prevTask = seen.seenBy(proofTx);
    if (prevTask !== undefined && prevTask !== taskId) {
      return { decision: 'REJECT', reason_code: 'PROOF_REUSED' };
    }
    if (prevTask === undefined) seen.record(proofTx, taskId);
  }

  if (publicBalance < minimum) {
    return { decision: 'REJECT', reason_code: 'THRESHOLD_MISMATCH' };
  }
  if (currentBlock >= expiryBlock) {
    return { decision: 'REJECT', reason_code: 'EXPIRED_CONDITION' };
  }
  if (recipient !== conditionRecipient) {
    return { decision: 'REJECT', reason_code: 'RECIPIENT_MISMATCH' };
  }
  if (amount > maxTransfer) {
    return { decision: 'REJECT', reason_code: 'AMOUNT_OVERFLOW' };
  }

  return { decision: 'APPROVE', reason_code: 'VALID_CONDITION' };
}

module.exports = { decide };
