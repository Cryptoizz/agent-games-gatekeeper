# Proof Gatekeeper Agent — zkVerify Agent Games

A public HTTPS endpoint that plays **Proof Gatekeeper**: it receives
HMAC-signed transfer tasks from the Agent Games platform, decides
APPROVE/REJECT with deterministic code (the 7-trap checklist), generates a
Groth16 proof of the decision locally with snarkjs, and returns a signed
response — all inside the platform's 60-second deadline (a proof takes
~0.5 s locally).

Read **PROTOCOL.md** first: it is the full protocol spec as extracted from
the official pages and verified against the official circuit, including the
items that are still unconfirmed (HMAC encoding, taskId mapping) and how
practice mode resolves them.

## Layout

```
server.js            Local server (plain node:http). POST /gatekeeper, /agent; GET /health
api/gatekeeper.js    Vercel serverless handler (same core). Served at /api/gatekeeper
lib/handler.js       Shared core: HMAC verify -> preflight/task -> signed response
lib/decide.js        Deterministic 7-trap decision logic
lib/prove.js         snarkjs proof generation, circuit inputs, taskId mapping
lib/seen.js          File-backed proof_tx seen-set (PROOF_REUSED)
lib/hmac.js          HMAC-SHA256 sign/verify (hex or sha256= forms)
lib/field.js         BN128 field helpers, keccak256
lib/kurier.js        Optional best-effort Kurier submission (dormant without key)
circuits/            gatekeeper.wasm, gatekeeper_final.zkey, verification_key.json
test/samples.js      Sample envelopes mirroring the official sample payload
test/prove.test.js   Decision + proof verification tests (incl. circuit negative tests)
test/http.test.js    End-to-end HTTP tests (preflight, signing, reuse)
vercel.json          Includes circuits/** in the function bundle, maxDuration 60
```

## Run locally

```bash
npm install
node server.js            # listens on PORT (default 8787)
# or with a secret:
AGENT_GAMES_HMAC_SECRET=<any test value> node server.js
```

Without `AGENT_GAMES_HMAC_SECRET` the code uses the clearly marked
placeholder `LOCAL_PLACEHOLDER_NOT_FOR_PRODUCTION` so the full
sign/verify path can be exercised locally. **The platform preflight will
fail with that placeholder — by design.** Never deploy with it.

Smoke test:

```bash
curl http://127.0.0.1:8787/health
```

## Tests

```bash
npm test                  # prove.test.js then http.test.js
```

Expected: 18/18 proof tests and 13/13 HTTP tests pass. Logs from the
2026-11-15 build run are in `logs/` (note: `logs/` is gitignored; regenerate
any time with `npm test`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `AGENT_GAMES_HMAC_SECRET` | **Yes, live** | Platform secret from dashboard **Rotate Secret** (revealed once). |
| `AGENT_GAMES_HMAC_FORMAT` | No (`hex`) | Outbound signature form: `hex` or `sha256=`. Inbound accepts both. Flip only if preflight fails on signature. |
| `GATEKEEPER_TASK_ID_MODE` | No (`keccak`) | task_id → field element: `keccak` \| `numeric` \| `hex`. Confirm in practice mode. |
| `KURIER_API_KEY` | No | Enables best-effort Kurier finalization submissions. |
| `SEEN_STORE_PATH` | No | Seen-set JSON path. Default `data/seen.json`; on Vercel use `/tmp/seen.json` (see caveat). |
| `CIRCUITS_DIR` | No | Override circuit artifacts location. |
| `PORT`, `HOST` | No | Local server only (default 8787 / 0.0.0.0). |

## Deploy to Vercel (later — after registration)

Do this only once the dashboard account/agent exists:

1. Install/login the Vercel CLI, link the project from this folder:
   `vercel link`
2. Make sure the circuit artifacts are present in `circuits/`
   (`gatekeeper.wasm`, `gatekeeper_final.zkey`) — `vercel.json` already
   includes `circuits/**` in the function bundle and sets `maxDuration: 60`.
3. Set env vars in the Vercel project (Production):
   - `AGENT_GAMES_HMAC_SECRET` = the one-time plaintext from dashboard
     **Rotate Secret** (do this AFTER deploying once, or rotate again after
     setting it — the secret must match what the dashboard last issued).
   - `SEEN_STORE_PATH` = `/tmp/seen.json`
   - `AGENT_GAMES_HMAC_FORMAT` = `hex` (initially)
   - `GATEKEEPER_TASK_ID_MODE` = `keccak` (initially)
4. Deploy: `vercel deploy --prod`
5. The endpoint URL is `https://<your-deployment>.vercel.app/api/gatekeeper`.
   Register **that full URL** as the agent endpoint on the dashboard.
6. On the dashboard: **Rotate Secret**, copy the one-time plaintext, update
   `AGENT_GAMES_HMAC_SECRET` in Vercel, redeploy/restart, then run
   **preflight** from the dashboard. It must pass before the platform marks
   the agent active.
   - If preflight fails with a signature error: set
     `AGENT_GAMES_HMAC_FORMAT=sha256=`, redeploy, re-run preflight.
7. Run at least one **practice task** from the dashboard practice mode.
   - If the practice proof is rejected: switch `GATEKEEPER_TASK_ID_MODE`
     (`numeric`, then `hex`), redeploy, repeat the practice task.
8. Finish all of the above **before Round 4 opens, Mon 16 Nov 2026 17:30
   WIB** — entries lock while a round is open.

### Caveats

- **Seen-set on Vercel:** `/tmp` is per-instance and ephemeral, so a
  proof_tx seen by one instance may be missed by another. PROOF_REUSED is
  ~11% of tasks; for maximum score, move the seen store to durable storage
  (e.g. Vercel KV / a small external store) before the scored rounds. The
  interface in `lib/seen.js` is the single place to change.
- **Cold starts:** the first request to a cold function loads snarkjs +
  wasm (~1–2 s); proof generation is ~0.5 s warm. Still far inside 60 s.
- **No secrets in git:** `.env` and the circuit binaries are gitignored;
  secrets live only in env vars.
