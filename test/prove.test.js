// Proof-level tests: for each sample task, decide() must return the expected
// decision/reason_code AND the Groth16 proof generated with that decision
// must verify locally against the official verification key (exported from
// gatekeeper_final.zkey). Negative tests assert the circuit REJECTS a wrong
// decision (witness generation throws) — i.e. the circuit is the referee.
//
// Run: node test/prove.test.js
const snarkjs = require('snarkjs');
const { decide } = require('../lib/decide');
const seen = require('../lib/seen');
const { proveTask, verifyLocally, buildInput, taskIdToField, ZKEY } = require('../lib/prove');
const { toField } = require('../lib/field');
const { envelope, taskOf, VK_HASH, OTHER_VK } = require('./samples');

let pass = 0;
let fail = 0;
function report(ok, name, extra = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

async function proveAndVerify(task, decision) {
  const { proof, publicSignals } = await proveTask(task, decision);
  const ok = await verifyLocally(publicSignals, proof);
  return { proof, publicSignals, ok };
}

(async () => {
  seen.reset();
  const vk = await snarkjs.zKey.exportVerificationKey(ZKEY);
  console.log(`verification key: protocol=${vk.protocol} curve=${vk.curve} nPublic=${vk.nPublic}`);

  // ---- Case 1: VALID task from the official sample payload ----------------
  {
    const env = envelope();
    const task = taskOf(env);
    const v = decide(task);
    report(v.decision === 'APPROVE' && v.reason_code === 'VALID_CONDITION',
      'VALID sample -> APPROVE/VALID_CONDITION', `got ${v.decision}/${v.reason_code}`);
    const t0 = Date.now();
    const { publicSignals, ok } = await proveAndVerify(task, v.decision);
    report(ok, 'VALID sample proof verifies locally', `${Date.now() - t0}ms`);
    report(publicSignals.length === 13, 'public signals count == 13', `got ${publicSignals.length}`);
    // Order check for the 12 non-hash signals (index 0 is the salt binding hash):
    const expect = {
      1: toField(VK_HASH).toString(),          // registeredVkHash
      2: toField(VK_HASH).toString(),          // proofVkHash
      3: '1000',                               // minimum
      4: '1460',                               // publicBalance
      5: '19842201',                           // expiryBlock
      6: '19832000',                           // currentBlock
      7: toField(env.input.recipient).toString(), // recipient
      8: toField(env.input.recipient).toString(), // conditionRecipient
      9: '500',                                // amount
      10: '1000',                              // maxTransfer
      11: '1',                                 // decision = APPROVE
      12: taskIdToField(env.task_id).toString(), // taskId (keccak mode)
    };
    let orderOk = true;
    for (const [i, want] of Object.entries(expect)) {
      if (publicSignals[Number(i)] !== want) {
        orderOk = false;
        console.log(`   signal[${i}] = ${publicSignals[i]}, want ${want}`);
      }
    }
    report(orderOk, 'public signals order matches [hash, vk, vk, min, bal, expiry, current, recip, condRecip, amount, max, decision, taskId]');
    console.log('   public_signals:', JSON.stringify(publicSignals));
  }

  // ---- Case 2: VK_SUBSTITUTION --------------------------------------------
  {
    const env = envelope({ proof_vk: OTHER_VK, proof_tx: '0xcase2' });
    const task = taskOf(env);
    const v = decide(task);
    report(v.decision === 'REJECT' && v.reason_code === 'VK_SUBSTITUTION',
      'VK_SUBSTITUTION sample -> REJECT/VK_SUBSTITUTION', `got ${v.decision}/${v.reason_code}`);
    const { publicSignals, ok } = await proveAndVerify(task, v.decision);
    report(ok && publicSignals[11] === '0', 'VK_SUBSTITUTION proof verifies locally (decision=0)');
  }

  // ---- Remaining traps: decision + proof ----------------------------------
  const trapCases = [
    ['THRESHOLD_MISMATCH', { public_balance: '999' }],
    ['EXPIRED_CONDITION (current > expiry)', { current_block: 19842202 }],
    ['RECIPIENT_MISMATCH', { recipient: '0x2222222222222222222222222222222222222222' }],
    ['AMOUNT_OVERFLOW', { amount: '1500' }],
  ];
  let n = 3;
  for (const [name, overrides] of trapCases) {
    const env = envelope({ proof_tx: '0xcase' + n++, ...overrides });
    const task = taskOf(env);
    const v = decide(task);
    const wantReason = name.split(' ')[0];
    const decisionOk = v.decision === 'REJECT' && v.reason_code === wantReason;
    const { ok } = await proveAndVerify(task, v.decision);
    report(decisionOk && ok, `${name} -> REJECT/${wantReason} + proof verifies`,
      `got ${v.decision}/${v.reason_code}, proof=${ok}`);
  }

  // ---- Boundaries -----------------------------------------------------------
  {
    const env = envelope({ public_balance: '1000', proof_tx: '0xcaseb1' });
    const task = taskOf(env);
    const v = decide(task);
    const { ok } = await proveAndVerify(task, v.decision);
    report(v.decision === 'APPROVE' && ok, 'boundary balance == minimum -> APPROVE + proof verifies');
  }
  {
    const env = envelope({ amount: '1000', proof_tx: '0xcaseb2' });
    const task = taskOf(env);
    const v = decide(task);
    const { ok } = await proveAndVerify(task, v.decision);
    report(v.decision === 'APPROVE' && ok, 'boundary amount == max_transfer -> APPROVE + proof verifies');
  }
  {
    // STRICT expiry: current == expiry is EXPIRED.
    const env = envelope({ current_block: 19842201, proof_tx: '0xcaseb3' });
    const task = taskOf(env);
    const v = decide(task);
    const { ok } = await proveAndVerify(task, v.decision);
    report(v.decision === 'REJECT' && v.reason_code === 'EXPIRED_CONDITION' && ok,
      'boundary current == expiry -> REJECT/EXPIRED_CONDITION + proof verifies');
  }

  // ---- Negative tests: the circuit must refuse a wrong decision ------------
  {
    const env = envelope({ proof_tx: '0xcasen1' });
    const task = taskOf(env);
    let threw = false;
    try {
      await proveTask(task, 'REJECT'); // valid task, wrong decision
    } catch { threw = true; }
    report(threw, 'circuit refuses REJECT for a VALID task (witness generation throws)');
  }
  {
    const env = envelope({ proof_vk: OTHER_VK, proof_tx: '0xcasen2' });
    const task = taskOf(env);
    let threw = false;
    try {
      await proveTask(task, 'APPROVE'); // trap task, wrong decision
    } catch { threw = true; }
    report(threw, 'circuit refuses APPROVE for a VK_SUBSTITUTION task');
  }
  {
    const env = envelope({ current_block: 19842201, proof_tx: '0xcasen3' });
    const task = taskOf(env);
    let threw = false;
    try {
      await proveTask(task, 'APPROVE'); // at strict-expiry boundary
    } catch { threw = true; }
    report(threw, 'circuit refuses APPROVE at current == expiry (strict expiry confirmed)');
  }

  // ---- PROOF_REUSED (decision-level; no proof exists for reuse) ------------
  {
    const env = envelope({ proof_tx: '0xcaser1' }, { task_id: 'gk_reuse_a' });
    decide(taskOf(env)); // first use, records the proof_tx
    const env2 = envelope({ proof_tx: '0xcaser1' }, { task_id: 'gk_reuse_b' });
    const v2 = decide(taskOf(env2));
    report(v2.decision === 'REJECT' && v2.reason_code === 'PROOF_REUSED',
      'PROOF_REUSED: same proof_tx under a different task_id');
    const v3 = decide(taskOf(env)); // retry of the SAME task_id
    report(v3.decision === 'APPROVE', 'same task_id retry is NOT a reuse');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
