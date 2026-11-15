# Proof Gatekeeper — Protocol Specification (as implemented)

Event: **Proof Gatekeeper**, zkVerify Agent Games, Season 01 (21 Oct – 21 Nov 2026).
Prize per track: 100,000 VFY (50,000 / 30,000 / 20,000 for 1st/2nd/3rd).
This document records what the official pages state, what was extracted from
the official site's HTML/starter prompts, and what was **empirically verified
against the official circuit** on 2026-11-15. Items that could not be
confirmed are marked **[UNCONFIRMED]** and must be resolved at
registration/dashboard/practice time.

## Sources

- Builder field guide: https://agentgames.zkverify.io/build
- Event page (task format, traps, scoring, entry requirements):
  https://agentgames.zkverify.io/events/proof-gatekeeper
- Registration guide: https://agentgames.zkverify.io/guide
- Circuit info JSON: https://agentgames.zkverify.io/api/circuit-info
- Circuit artifacts: https://agentgames.zkverify.io/circuits/gatekeeper.wasm ,
  https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey
- Rules page: https://agentgames.zkverify.io/rules
- Cross-check (NOT official): a public participant implementation whose
  author probed the same wasm — https://github.com/subastian1998/agent-games-season-01
  Every load-bearing claim taken from it (circuit input names, public-signal
  order, strict expiry) was re-verified locally against the official circuit
  in `test/prove.test.js` before being relied on.

## 1. Transport

- The platform POSTs JSON to the agent's **registered public HTTPS endpoint**
  (the full path as registered, e.g. `https://<host>/api/gatekeeper` — a path
  that 404s fails preflight and every task).
- **Hard deadline: 60 seconds** per response. Late = timeout (−2).
- HTTPS only. Fail closed on timeout/uncertainty.
- One agent per owner in this event; **entries lock while a round is open**.

## 2. HMAC scheme

- Header: `x-agent-games-signature` on **every** inbound request and **every**
  response.
- Inbound: verify the signature over the **RAW request body before parsing
  JSON**; reject on mismatch (this implementation returns HTTP 401 with a
  signed `{error:"bad signature"}` body).
- Outbound: sign the **raw response body** the same way.
- Secret: platform-issued, revealed **once** via dashboard **Rotate Secret**;
  set as env `AGENT_GAMES_HMAC_SECRET`. A local placeholder causes preflight
  to fail with a signature error (officially stated).
- **[UNCONFIRMED] Algorithm/encoding.** No official page states it. Assumed
  (industry standard + public participant implementations): **HMAC-SHA256,
  lowercase hex digest** of the raw body. An alternative `sha256=<hex>` form
  exists in the wild; this implementation sends plain hex by default
  (`AGENT_GAMES_HMAC_FORMAT=sha256=` switches outbound) and **accepts both
  forms inbound**. The platform preflight is the authoritative test — if it
  fails with a signature error, flip the format and re-run preflight.

## 3. Preflight

Before any task, after registration + secret rotation, the platform sends:

```json
{ "type": "agent-games.preflight.v1", "agent_id": "agt_...", "issued_at": "<issued-at>", "nonce": "abc123" }
```

Required response (signed, HTTP 200):

```json
{ "ok": true, "protocolVersion": "v1" }
```

Preflight must pass before the platform marks the agent active. Entry also
requires a passing endpoint **health check** and **at least one practice
task**. Practice mode lives behind the dashboard (`/dashboard/practice`) and
reproduces every trap type unscored. **[UNCONFIRMED]** exact health-check
path/format the platform probes (this implementation answers `GET /health`
and `GET /` with JSON 200s).

## 4. Task envelope (inbound)

```json
{
  "type":        "agent-games.proof-gatekeeper.v1",
  "task_id":     "gk_24_9d1",
  "mode":        "competition",
  "issued_at":   "<issued-at>",
  "deadline_at": "<deadline-at>",
  "input": {
    "registered_vk":       "0x7d3a...f291",
    "proof_vk":            "0xa4c1...b8ff",
    "minimum":             "1000",
    "public_balance":      "1460",
    "expiry_block":        19842201,
    "current_block":       19832000,
    "recipient":           "0xDe42...9f01",
    "condition_recipient": "0xDe42...9f01",
    "amount":              "500",
    "max_transfer":        "1000",
    "proof_tx":            "0xa4c1...8ff1"
  }
}
```

Notes:
- The official samples print hash/address fields **truncated with ellipses**;
  real envelopes carry full values. `minimum`, `public_balance`, `amount`,
  `max_transfer` are decimal **strings**; `expiry_block`/`current_block` are
  JSON numbers in the event-page sample (strings accepted too — the code
  normalises via `BigInt(String(x))`).
- `mode` can be `"practice"` in practice mode; handling is identical.
- The event page's build checklist phrases step 2 as "call zkVerifyJS to
  confirm the proof is on-chain and its VK matches the registered condition
  VK". In the envelope protocol as published, the VK comparison is over the
  `proof_vk` vs `registered_vk` fields and is enforced by the circuit; no
  separate chain call is needed to decide. (Kurier submission, §7, is the
  on-chain finalization path.)

## 5. Decision rules — the 7 traps

First failing check wins; `reason_code` = trap name. All comparisons are
deterministic; no language model is involved.

| Order | Check | Fail → decision / reason_code |
|---|---|---|
| 1 | `proof_vk == registered_vk` (case-insensitive) | REJECT / `VK_SUBSTITUTION` (~13% of tasks) |
| 2 | `proof_tx` not seen before under a **different** `task_id` | REJECT / `PROOF_REUSED` (~11%) |
| 3 | `public_balance >= minimum` | REJECT / `THRESHOLD_MISMATCH` (~8%) |
| 4 | `current_block < expiry_block` | REJECT / `EXPIRED_CONDITION` (~6%) |
| 5 | `recipient == condition_recipient` (case-insensitive) | REJECT / `RECIPIENT_MISMATCH` (~6%) |
| 6 | `amount <= max_transfer` | REJECT / `AMOUNT_OVERFLOW` (~6%) |
| — | all pass (~50%) | APPROVE / `VALID_CONDITION` |

Boundary behaviour — **empirically verified against the circuit**
(`test/prove.test.js`, 2026-11-15):

- `public_balance == minimum` → VALID (threshold inclusive).
- `amount == max_transfer` → VALID (cap inclusive).
- `current_block == expiry_block` → **EXPIRED** (expiry is STRICT: valid only
  while `current_block < expiry_block`). Witness generation for APPROVE at
  the boundary throws in the official wasm. (A naive reading of the trap
  description suggests `<=` might be fine — it is not; the circuit wins.)
- A platform retry of the **same** `task_id` with the same `proof_tx` is NOT
  a reuse. The seen-set records `proof_tx → task_id` when the reuse check
  runs (after the VK check).
- **[UNCONFIRMED]** Trap priority when several traps co-occur: the circuit
  enforces only the decision bit, not which reason_code is returned; the
  order above follows the official trap listing/build checklist order and
  the reference implementation. Scoring text says a correct REJECT is
  "detected trap correctly identified" — if practice tasks reveal a
  different expected priority, reorder `lib/decide.js` (single place).

Malformed envelopes (missing/non-numeric required fields) →
`REJECT` / `INVALID_TASK`, no proof. (`INVALID_TASK` is an implementation
choice, not an official reason_code.)

## 6. Response schema (outbound)

HTTP 200, `application/json`, signed (§2). Base shape from the event page:

```json
{ "decision": "REJECT", "reason_code": "VK_SUBSTITUTION", "proof_tx": "0xa4c1...8ff1" }
```

On every **provable** task the response additionally carries the locally
generated Groth16 proof and its public signals (per the /build guide step
05 and the Gatekeeper starter prompt, which specifies the signed response as
`{ decision, reason_code, proof, public_signals }`):

```json
{
  "decision":       "APPROVE",
  "reason_code":    "VALID_CONDITION",
  "proof_tx":       "0x...",
  "proof": {
    "pi_a": ["...", "...", "1"],
    "pi_b": [["...", "..."], ["...", "..."], ["1", "0"]],
    "pi_c": ["...", "...", "1"],
    "protocol": "groth16",
    "curve": "bn128"
  },
  "public_signals": ["...", "...13 decimal strings total..."]
}
```

- `proof_tx` echoes the task's `proof_tx` (an optional on-chain audit
  pointer per the /build guide).
- **PROOF_REUSED responses carry NO proof** — the event page states
  PROOF_REUSED tasks "have no proof to submit" and are excluded from the
  reliability bonus.
- If proof generation ever fails, the decision is still returned without
  `proof`/`public_signals` (costs −2 for that task, but the decision itself
  is scored; the service never crashes and never approves by default —
  decisions come only from `lib/decide.js`).
- Scoring: correct decision **+12**, incorrect APPROVE **−6**, incorrect
  REJECT **−3**, timeout **−2**, missing/invalid proof **−2**, reliability
  bonus **+0..+5** per round (share of provable tasks whose proof verified;
  PROOF_REUSED excluded). Ties: more correct decisions, then fewer timeouts,
  then shared rank/prize split.

## 7. Circuit + proof generation

- Circuit: Groth16 / BN128 (Circom 2.x), template `GatekeeperEvaluation`.
- Registered vkHash (zkVerify mainnet), from `/api/circuit-info`:
  `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`
- Verification key exported from the zkey (`circuits/verification_key.json`):
  protocol `groth16`, curve `bn128`, **nPublic = 13**.
- Proofs are generated locally with **snarkjs** `groth16.fullProve`
  (wasm + zkey above). Measured locally: ~0.5 s per proof — far inside the
  60 s deadline. A wrong decision makes witness generation throw (verified),
  so a decision that contradicts the circuit can never be proven.

### Circuit input signals (13 inputs: 12 public + 1 private)

In the order the public ones appear in the public signals:

```
registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
currentBlock, recipient, conditionRecipient, amount, maxTransfer,
decision, taskId, salt (private)
```

- `decision`: `1` = APPROVE, `0` = REJECT.
- `salt`: fresh random 32-byte hex per proof (private input; binds the
  output hash).
- Address/VK fields are passed as the envelope's hex strings; the witness
  calculator reduces them mod p, and the public signals echo the reduced
  field elements.
- `taskId`: **[UNCONFIRMED] mapping.** The envelope's `task_id` is a string
  (`"gk_24_9d1"`); the circuit needs a field element. Default implemented:
  `keccak256(utf8(task_id)) mod p` (env `GATEKEEPER_TASK_ID_MODE=keccak`).
  Alternatives implemented: `numeric` (digits of the id), `hex` (hex chars
  of the id). **This is the #1 thing practice mode must confirm** — if the
  platform rejects the proof on a practice task, switch the mode and retry;
  the mapping is one function in `lib/prove.js`.

### Public signals (13, order verified empirically)

```
[0]  bindingHash        Poseidon-style hash computed in-circuit over the
                        inputs + private salt (platform cannot recompute it;
                        it verifies via the proof itself)
[1]  registeredVkHash   [7]  recipient
[2]  proofVkHash        [8]  conditionRecipient
[3]  minimum            [9]  amount
[4]  publicBalance      [10] maxTransfer
[5]  expiryBlock        [11] decision (1/0)
[6]  currentBlock       [12] taskId (field element, see mapping above)
```

`test/prove.test.js` asserts indices 1–12 exactly for a sample task.

## 8. zkVerify submission (optional)

The /build guide offers two paths to get proofs finalized on zkVerify:
**Kurier** (REST, recommended) or **zkVerifyJS** (direct chain). The
Gatekeeper response itself carries the local proof; the platform re-verifies
it against its own VK. This implementation treats Kurier as an optional,
best-effort, non-blocking finalization pointer, active only when
`KURIER_API_KEY` is set (POST `https://api.kurier.xyz/api/v1/submit-proof/<key>`
with `{ proofType:"groth16", vkRegistered:true, proofOptions:{library:"snarkjs",
curve:"bn128"}, proofData:{ proof, publicSignals, vk: <gatekeeper vkHash> } }`,
per the official /build snippet). Job states: Submitted → IncludedInBlock →
Finalized. **[UNCONFIRMED]** whether scoring requires the Kurier-finalized
reference in addition to the in-response proof — the response schema has no
proof-reference field for Gatekeeper, and a public participant implementation
submits fire-and-forget; practice mode will tell.

## 9. Rounds

8 daily scored rounds, 13–20 Nov 2026, **17:30–03:30 WIB** (4:00 PM–2:00 AM
IST), 8 tasks per agent per round, scores cumulative. Rounds 1–3 are gone;
the first enterable round for a new agent is **Round 4, Mon 16 Nov 2026,
17:30 WIB** — registration + endpoint + secret rotation + preflight +
practice must all complete **before** it opens (entries lock while a round
is open). Season closes 21 Nov 22:00 UTC; judging 22–30 Nov.

## 10. Open items for the registration/dashboard step

1. **HMAC format** — hex vs `sha256=<hex>` (§2). Preflight decides.
2. **taskId → field element mapping** — keccak vs numeric vs hex (§7).
   Practice task decides.
3. **Health-check probe** — exact path/format the platform expects (§3).
4. **Kurier necessity** — whether a Finalized on-chain reference is required
   beyond the in-response proof (§8); if yes, a (free) Kurier API key must
   be obtained and set.
5. **Reason-code priority** on multi-trap tasks (§5).
6. **Seen-set durability** — PROOF_REUSED spans rounds, so the seen store
   must persist across deploys/restarts (on Vercel, point
   `SEEN_STORE_PATH` at durable storage or accept the /tmp limitation).
