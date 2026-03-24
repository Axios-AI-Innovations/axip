/**
 * AXIP SDK — Cryptographic Identity
 *
 * ed25519 keypair generation, message signing, and signature verification.
 * Each agent gets a persistent identity stored at ~/.axip/<name>/identity.json.
 * Uses tweetnacl for all cryptographic operations.
 */

import nacl from 'tweetnacl';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ─── Base64 Helpers ────────────────────────────────────────────

export function toBase64(uint8Array) {
  return Buffer.from(uint8Array).toString('base64');
}

export function fromBase64(b64String) {
  return new Uint8Array(Buffer.from(b64String, 'base64'));
}

// ─── Key Operations ────────────────────────────────────────────

/**
 * Generate a new ed25519 keypair.
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generateKeypair() {
  return nacl.sign.keyPair();
}

/**
 * Format a public key for the AXIP message envelope.
 * @param {Uint8Array} publicKey
 * @returns {string} "ed25519:<base64>"
 */
export function formatPubkey(publicKey) {
  return `ed25519:${toBase64(publicKey)}`;
}

/**
 * Extract raw public key bytes from a formatted pubkey string.
 * @param {string} formatted - "ed25519:<base64>"
 * @returns {Uint8Array}
 */
export function parsePubkey(formatted) {
  const prefix = 'ed25519:';
  if (!formatted.startsWith(prefix)) {
    throw new Error(`Invalid pubkey format: ${formatted}`);
  }
  return fromBase64(formatted.slice(prefix.length));
}

// ─── Signing and Verification ──────────────────────────────────

/**
 * Sign a message with the agent's secret key.
 * @param {string} message - The message string to sign
 * @param {Uint8Array} secretKey - 64-byte ed25519 secret key
 * @returns {string} "ed25519:<base64 signature>"
 */
export function sign(message, secretKey) {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return `ed25519:${toBase64(signature)}`;
}

/**
 * Verify a detached signature.
 * @param {string} message - The original message string
 * @param {string} signature - "ed25519:<base64 signature>"
 * @param {Uint8Array} publicKey - 32-byte ed25519 public key
 * @returns {boolean}
 */
export function verify(message, signature, publicKey) {
  try {
    const prefix = 'ed25519:';
    if (!signature.startsWith(prefix)) return false;
    const sigBytes = fromBase64(signature.slice(prefix.length));
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, sigBytes, publicKey);
  } catch {
    return false;
  }
}

// ─── Identity Persistence ──────────────────────────────────────

/**
 * Load an existing identity or create a new one.
 * Identities are stored at ~/.axip/<name>/identity.json with chmod 600.
 *
 * @param {string} name - Agent name (used as directory name)
 * @returns {{ agentId: string, publicKey: Uint8Array, secretKey: Uint8Array, pubkeyFormatted: string }}
 */
export function loadOrCreateIdentity(name = 'default') {
  const axipDir = join(homedir(), '.axip', name);
  const identityPath = join(axipDir, 'identity.json');

  if (existsSync(identityPath)) {
    // Load existing identity
    const data = JSON.parse(readFileSync(identityPath, 'utf-8'));
    const publicKey = fromBase64(data.publicKey);
    const secretKey = fromBase64(data.secretKey);

    return {
      agentId: data.agentId,
      publicKey,
      secretKey,
      pubkeyFormatted: formatPubkey(publicKey)
    };
  }

  // Generate new identity
  const keypair = generateKeypair();

  // Derive a human-readable agent ID from the public key
  const agentId = `${name}-${toBase64(keypair.publicKey).slice(0, 8).replace(/[+/=]/g, 'x')}`;

  const data = {
    agentId,
    publicKey: toBase64(keypair.publicKey),
    secretKey: toBase64(keypair.secretKey),
    createdAt: new Date().toISOString()
  };

  // Write with restricted permissions
  mkdirSync(axipDir, { recursive: true });
  writeFileSync(identityPath, JSON.stringify(data, null, 2));
  chmodSync(identityPath, 0o600);

  console.log(`[crypto] New identity created: ${agentId}`);
  console.log(`[crypto] Stored at: ${identityPath}`);

  return {
    agentId,
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    pubkeyFormatted: formatPubkey(keypair.publicKey)
  };
}
