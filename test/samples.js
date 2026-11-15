// Sample task envelopes for local tests.
//
// STRUCTURE AND NUMERIC VALUES mirror the official sample payload on
// https://agentgames.zkverify.io/events/proof-gatekeeper exactly:
//   task_id "gk_24_9d1", minimum "1000", public_balance "1460",
//   expiry_block 19842201, current_block 19832000, amount "500",
//   max_transfer "1000", recipient == condition_recipient.
// The official page prints the hash/address fields TRUNCATED with ellipses
// (e.g. registered_vk "0x7d3a...f291", proof_tx "0xa4c1...8ff1"), which are
// not usable field elements — so for proof generation they are replaced
// here with full-length values: registered_vk/proof_vk use the official
// gatekeeper vkHash from /api/circuit-info, and the recipient uses a full
// 20-byte address with the same prefix/suffix pattern as the sample.

const VK_HASH = '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';
const OTHER_VK = '0xa4c1b8ff00000000000000000000000000000000000000000000000000b8ff';
const RECIPIENT = '0xDe42000000000000000000000000000000009f01';

function envelope(inputOverrides = {}, envelopeOverrides = {}) {
  return {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: 'gk_24_9d1',
    mode: 'competition',
    issued_at: '2026-11-15T12:00:00.000Z',
    deadline_at: '2026-11-15T12:01:00.000Z',
    input: {
      registered_vk: VK_HASH,
      proof_vk: VK_HASH,
      minimum: '1000',
      public_balance: '1460',
      expiry_block: 19842201,
      current_block: 19832000,
      recipient: RECIPIENT,
      condition_recipient: RECIPIENT,
      amount: '500',
      max_transfer: '1000',
      proof_tx: '0xa4c10000000000000000000000000000000000000000000000000000008ff1',
      ...inputOverrides,
    },
    ...envelopeOverrides,
  };
}

// The task object the prove/decide layers consume: envelope.input + task_id.
function taskOf(env) {
  return { ...env.input, task_id: env.task_id };
}

module.exports = { envelope, taskOf, VK_HASH, OTHER_VK, RECIPIENT };
