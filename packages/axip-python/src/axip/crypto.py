"""
AXIP SDK — Cryptographic Identity

Ed25519 keypair generation, message signing, and signature verification.
Each agent gets a persistent identity stored at ~/.axip/<name>/identity.json.
Uses PyNaCl for all cryptographic operations (compatible with JS tweetnacl).
"""

import base64
import json
import os
import stat
from pathlib import Path
from typing import NamedTuple

import nacl.signing
import nacl.encoding


# ─── Types ────────────────────────────────────────────────────────


class Identity(NamedTuple):
    agent_id: str
    signing_key: nacl.signing.SigningKey   # 32-byte seed → 64-byte secret
    verify_key: nacl.signing.VerifyKey     # 32-byte public key
    pubkey_formatted: str                  # "ed25519:<base64>"


# ─── Base64 Helpers ───────────────────────────────────────────────


def to_base64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def from_base64(s: str) -> bytes:
    return base64.b64decode(s)


# ─── Key Format ───────────────────────────────────────────────────


def format_pubkey(verify_key: nacl.signing.VerifyKey) -> str:
    return f"ed25519:{to_base64(bytes(verify_key))}"


def parse_pubkey(formatted: str) -> nacl.signing.VerifyKey:
    prefix = "ed25519:"
    if not formatted.startswith(prefix):
        raise ValueError(f"Invalid pubkey format: {formatted}")
    raw = from_base64(formatted[len(prefix):])
    return nacl.signing.VerifyKey(raw)


# ─── Signing and Verification ─────────────────────────────────────


def sign(message: str, signing_key: nacl.signing.SigningKey) -> str:
    """
    Sign a string message. Returns "ed25519:<base64 signature>".
    Compatible with JS tweetnacl detached signatures.
    """
    msg_bytes = message.encode("utf-8")
    signed = signing_key.sign(msg_bytes)
    # PyNaCl .sign() returns signature + message; extract just signature
    sig_bytes = signed.signature
    return f"ed25519:{to_base64(sig_bytes)}"


def verify(message: str, signature: str, verify_key: nacl.signing.VerifyKey) -> bool:
    """
    Verify a detached Ed25519 signature.
    """
    try:
        prefix = "ed25519:"
        if not signature.startswith(prefix):
            return False
        sig_bytes = from_base64(signature[len(prefix):])
        msg_bytes = message.encode("utf-8")
        verify_key.verify(msg_bytes, sig_bytes)
        return True
    except Exception:
        return False


# ─── Keypair ──────────────────────────────────────────────────────


def generate_keypair() -> tuple[nacl.signing.SigningKey, nacl.signing.VerifyKey]:
    signing_key = nacl.signing.SigningKey.generate()
    return signing_key, signing_key.verify_key


# ─── Identity Persistence ─────────────────────────────────────────


def load_or_create_identity(name: str = "default") -> Identity:
    """
    Load an existing identity or create a new one.
    Stored at ~/.axip/<name>/identity.json with mode 600.
    Format is compatible with the JS SDK.
    """
    axip_dir = Path.home() / ".axip" / name
    identity_path = axip_dir / "identity.json"

    if identity_path.exists():
        data = json.loads(identity_path.read_text())
        # JS SDK stores the full 64-byte tweetnacl secret key (seed + pubkey)
        # PyNaCl SigningKey accepts the 32-byte seed only
        raw_secret = from_base64(data["secretKey"])
        if len(raw_secret) == 64:
            # tweetnacl format: first 32 bytes are the seed
            seed = raw_secret[:32]
        else:
            seed = raw_secret
        signing_key = nacl.signing.SigningKey(seed)
        verify_key = signing_key.verify_key

        return Identity(
            agent_id=data["agentId"],
            signing_key=signing_key,
            verify_key=verify_key,
            pubkey_formatted=format_pubkey(verify_key),
        )

    # Generate new identity
    signing_key, verify_key = generate_keypair()
    pubkey_b64 = to_base64(bytes(verify_key))
    # Build agent_id like the JS SDK: name + first 8 chars of pubkey (sanitized)
    suffix = pubkey_b64[:8].replace("+", "x").replace("/", "x").replace("=", "x")
    agent_id = f"{name}-{suffix}"

    # Store in JS-compatible format:
    # secretKey = seed (32 bytes) + pubkey (32 bytes) concatenated = 64 bytes
    seed_bytes = bytes(signing_key)
    pubkey_bytes = bytes(verify_key)
    secret_64 = seed_bytes + pubkey_bytes

    data = {
        "agentId": agent_id,
        "publicKey": pubkey_b64,
        "secretKey": to_base64(secret_64),
        "createdAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    axip_dir.mkdir(parents=True, exist_ok=True)
    identity_path.write_text(json.dumps(data, indent=2))
    identity_path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 600

    print(f"[axip] New identity created: {agent_id}")
    print(f"[axip] Stored at: {identity_path}")

    return Identity(
        agent_id=agent_id,
        signing_key=signing_key,
        verify_key=verify_key,
        pubkey_formatted=format_pubkey(verify_key),
    )
