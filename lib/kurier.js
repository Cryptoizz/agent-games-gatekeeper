// OPTIONAL, best-effort: submit a generated proof to zkVerify via Kurier so
// it reaches a Finalized on-chain state (the /build Security checklist lists
// "verification reached a finalized state before approval" — in practice the
// gatekeeper response itself carries the local proof + public_signals, and
// the platform re-verifies offline against its own VK; Kurier submission is
// an audit/finalization pointer only and is NOT awaited).
//
// Dormant unless KURIER_API_KEY is set in the environment. Failures are
// swallowed by the caller. Snippet shape follows the official /build page.
const VK_HASH =
  process.env.GATEKEEPER_VK_HASH ||
  '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

async function submitProof(apiKey, proof, publicSignals, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.kurier.xyz/api/v1/submit-proof/${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          proofType: 'groth16',
          vkRegistered: true,
          proofOptions: { library: 'snarkjs', curve: 'bn128' },
          proofData: { proof, publicSignals, vk: VK_HASH },
        }),
      }
    );
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

module.exports = { submitProof, VK_HASH };
