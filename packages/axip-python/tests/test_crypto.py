"""
Tests for axip.crypto — key generation, signing, verification, identity persistence.
These are pure unit tests; no relay connection required.
"""

import json
import stat
import tempfile
from pathlib import Path
from unittest.mock import patch

import nacl.signing
import pytest

from axip.crypto import (
    Identity,
    format_pubkey,
    from_base64,
    generate_keypair,
    load_or_create_identity,
    parse_pubkey,
    sign,
    to_base64,
    verify,
)


# ─── Helpers ──────────────────────────────────────────────────────


def _tmp_identity_dir(tmp_path: Path, name: str) -> Path:
    """Return a home dir path that routes ~/.axip/<name>/identity.json into tmp_path."""
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    return fake_home


# ─── Base64 Helpers ───────────────────────────────────────────────


def test_base64_round_trip():
    data = b"\x00\x01\x02\xff\xfe\xfd"
    assert from_base64(to_base64(data)) == data


def test_base64_empty():
    assert from_base64(to_base64(b"")) == b""


# ─── Keypair ──────────────────────────────────────────────────────


def test_generate_keypair_returns_matching_pair():
    sk, vk = generate_keypair()
    assert isinstance(sk, nacl.signing.SigningKey)
    assert isinstance(vk, nacl.signing.VerifyKey)
    # The verify key derived from the signing key must match
    assert bytes(sk.verify_key) == bytes(vk)


def test_generate_keypair_is_random():
    sk1, _ = generate_keypair()
    sk2, _ = generate_keypair()
    assert bytes(sk1) != bytes(sk2)


# ─── Key Format ───────────────────────────────────────────────────


def test_format_pubkey_prefix():
    _, vk = generate_keypair()
    formatted = format_pubkey(vk)
    assert formatted.startswith("ed25519:")


def test_parse_pubkey_round_trip():
    _, vk = generate_keypair()
    formatted = format_pubkey(vk)
    recovered = parse_pubkey(formatted)
    assert bytes(recovered) == bytes(vk)


def test_parse_pubkey_invalid_prefix():
    with pytest.raises(ValueError, match="Invalid pubkey format"):
        parse_pubkey("rsa:AAAA")


# ─── Sign and Verify ──────────────────────────────────────────────


def test_sign_verify_round_trip():
    sk, vk = generate_keypair()
    message = "hello AXIP"
    sig = sign(message, sk)
    assert verify(message, sig, vk)


def test_sign_prefix():
    sk, _ = generate_keypair()
    sig = sign("test", sk)
    assert sig.startswith("ed25519:")


def test_verify_wrong_message():
    sk, vk = generate_keypair()
    sig = sign("correct message", sk)
    assert not verify("tampered message", sig, vk)


def test_verify_wrong_key():
    sk, _ = generate_keypair()
    _, vk2 = generate_keypair()
    sig = sign("hello", sk)
    assert not verify("hello", sig, vk2)


def test_verify_malformed_signature():
    _, vk = generate_keypair()
    assert not verify("hello", "notasig", vk)
    assert not verify("hello", "ed25519:!!!invalid base64!!!", vk)


def test_verify_empty_signature():
    _, vk = generate_keypair()
    assert not verify("hello", "", vk)


def test_sign_unicode():
    sk, vk = generate_keypair()
    message = "こんにちは AXIP 🤖"
    sig = sign(message, sk)
    assert verify(message, sig, vk)


# ─── Identity Persistence ─────────────────────────────────────────


def test_load_or_create_creates_new(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        identity = load_or_create_identity("test-agent")

    assert identity.agent_id.startswith("test-agent-")
    assert isinstance(identity.signing_key, nacl.signing.SigningKey)
    assert isinstance(identity.verify_key, nacl.signing.VerifyKey)
    assert identity.pubkey_formatted.startswith("ed25519:")

    # File must exist at ~/.axip/test-agent/identity.json
    identity_file = fake_home / ".axip" / "test-agent" / "identity.json"
    assert identity_file.exists()


def test_load_or_create_file_permissions(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        load_or_create_identity("perm-test")

    identity_file = fake_home / ".axip" / "perm-test" / "identity.json"
    file_mode = identity_file.stat().st_mode & 0o777
    assert file_mode == 0o600, f"Expected 600, got {oct(file_mode)}"


def test_load_or_create_idempotent(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        id1 = load_or_create_identity("stable-agent")
        id2 = load_or_create_identity("stable-agent")

    assert id1.agent_id == id2.agent_id
    assert bytes(id1.signing_key) == bytes(id2.signing_key)
    assert bytes(id1.verify_key) == bytes(id2.verify_key)


def test_load_or_create_identity_json_format(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        identity = load_or_create_identity("format-test")

    identity_file = fake_home / ".axip" / "format-test" / "identity.json"
    data = json.loads(identity_file.read_text())

    assert "agentId" in data
    assert "publicKey" in data
    assert "secretKey" in data
    assert "createdAt" in data
    # secretKey must be 64-byte (JS tweetnacl compatible)
    secret_bytes = from_base64(data["secretKey"])
    assert len(secret_bytes) == 64


def test_load_existing_js_format_identity(tmp_path):
    """Identity files written by the JS SDK (64-byte secretKey) must load correctly."""
    fake_home = tmp_path / "home"
    fake_home.mkdir()

    # Simulate a JS SDK identity file
    sk, vk = generate_keypair()
    seed_bytes = bytes(sk)
    pubkey_bytes = bytes(vk)
    secret_64 = seed_bytes + pubkey_bytes

    agent_id = "test-jscompat-XXXXXXXX"
    data = {
        "agentId": agent_id,
        "publicKey": to_base64(pubkey_bytes),
        "secretKey": to_base64(secret_64),
        "createdAt": "2026-01-01T00:00:00Z",
    }

    identity_dir = fake_home / ".axip" / "jscompat"
    identity_dir.mkdir(parents=True)
    identity_file = identity_dir / "identity.json"
    identity_file.write_text(json.dumps(data))
    identity_file.chmod(0o600)

    with patch("axip.crypto.Path.home", return_value=fake_home):
        loaded = load_or_create_identity("jscompat")

    assert loaded.agent_id == agent_id
    assert bytes(loaded.signing_key) == seed_bytes
    assert bytes(loaded.verify_key) == pubkey_bytes


def test_loaded_identity_can_sign_and_verify(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()

    with patch("axip.crypto.Path.home", return_value=fake_home):
        id1 = load_or_create_identity("sign-test")
        sig = sign("AXIP protocol test", id1.signing_key)
        id2 = load_or_create_identity("sign-test")  # reload from disk

    assert verify("AXIP protocol test", sig, id2.verify_key)
