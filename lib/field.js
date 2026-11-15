// Field-element helpers for the BN128 (alt_bn128) scalar field used by the
// Agent Games gatekeeper circuit (Groth16/BN128, Circom 2.x).
const { keccak_256 } = require('js-sha3');

const FIELD_PRIME = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

function toField(x) {
  // x: hex string (0x..), decimal string, number, or BigInt -> BigInt mod p
  let b;
  if (typeof x === 'bigint') b = x;
  else if (typeof x === 'number') b = BigInt(x);
  else b = BigInt(String(x)); // BigInt() accepts "0x.." hex and decimal strings
  const r = b % FIELD_PRIME;
  return r < 0n ? r + FIELD_PRIME : r;
}

function keccak256Hex(buffers) {
  return '0x' + keccak_256(Buffer.concat(buffers));
}

// keccak256(data) interpreted as a field element (mod p).
function keccak256ModP(buffers) {
  return toField(BigInt(keccak256Hex(buffers)));
}

module.exports = { FIELD_PRIME, toField, keccak256Hex, keccak256ModP };
