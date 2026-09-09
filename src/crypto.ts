import { createHash, randomBytes } from "node:crypto";
import * as ed from "@noble/ed25519";
import { canonicalJson } from "./canonical.js";
import type { KeyPair, UnsignedEvent } from "./types.js";

ed.etc.sha512Sync = (...msgs: Uint8Array[]) => {
  const hash = createHash("sha512");
  for (const msg of msgs) hash.update(msg);
  return new Uint8Array(hash.digest());
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 Base32, no padding. */
export function base32EncodeNoPad(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function sha256(data: Uint8Array | string): Uint8Array {
  const hash = createHash("sha256");
  hash.update(typeof data === "string" ? Buffer.from(data, "utf8") : data);
  return new Uint8Array(hash.digest());
}

export function sha256Hex(data: Uint8Array | string): string {
  return Buffer.from(sha256(data)).toString("hex");
}

export function payloadHashOf(payload: Uint8Array | string = ""): string {
  return `sha256:${sha256Hex(payload)}`;
}

export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(32);
  const publicKey = ed.getPublicKey(privateKey);
  return {
    publicKey,
    privateKey,
    publicKeyBase64: Buffer.from(publicKey).toString("base64"),
    privateKeyBase64: Buffer.from(privateKey).toString("base64"),
  };
}

export function decodePublicKey(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export function decodePrivateKey(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export function deriveIdentityId(publicKeyBytes: Uint8Array): string {
  return `id_${base32EncodeNoPad(sha256(publicKeyBytes).slice(0, 16))}`;
}

export function deriveIssuerId(publicKeyBytes: Uint8Array): string {
  return `issuer_${base32EncodeNoPad(sha256(publicKeyBytes).slice(0, 16))}`;
}

export function deriveEventId(parts: {
  issuer_id: string;
  identity_id: string;
  event_type: string;
  timestamp: number;
  sequence: number;
  payload_hash: string;
}): string {
  const material = `${parts.issuer_id}${parts.identity_id}${parts.event_type}${parts.timestamp}${parts.sequence}${parts.payload_hash}`;
  return `evt_${base32EncodeNoPad(sha256(material).slice(0, 16))}`;
}

export function signingDigest(unsigned: UnsignedEvent): Uint8Array {
  return sha256(canonicalJson(unsigned));
}

export function signEvent(
  unsigned: UnsignedEvent,
  issuerPrivateKey: Uint8Array,
): string {
  const sig = ed.sign(signingDigest(unsigned), issuerPrivateKey);
  return Buffer.from(sig).toString("base64");
}

export function verifyEventSignature(
  unsigned: UnsignedEvent,
  signatureBase64: string,
  issuerPublicKeyBase64: string,
): boolean {
  try {
    const sig = Buffer.from(signatureBase64, "base64");
    const pub = decodePublicKey(issuerPublicKeyBase64);
    return ed.verify(sig, signingDigest(unsigned), pub);
  } catch {
    return false;
  }
}

export function stateRootHex(canonicalState: unknown): string {
  return sha256Hex(canonicalJson(canonicalState));
}
