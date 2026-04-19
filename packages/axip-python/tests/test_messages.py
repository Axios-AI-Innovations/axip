"""
Tests for axip.messages — message builders, canonicalization, sign+verify.
Pure unit tests; no relay connection required.
"""

import json
import uuid
from unittest.mock import patch

import pytest

from axip.crypto import generate_keypair, load_or_create_identity, sign, to_base64
from axip.messages import (
    build_announce,
    build_discover,
    build_heartbeat,
    build_message,
    build_task_accept,
    build_task_bid,
    build_task_request,
    build_task_result,
    build_task_verify,
    canonicalize,
    sign_message,
    verify_message,
)


# ─── Fixtures ─────────────────────────────────────────────────────


@pytest.fixture
def identity(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        return load_or_create_identity("test-msg-agent")


# ─── build_message ────────────────────────────────────────────────


def test_build_message_required_fields(identity):
    msg = build_message("announce", identity, "relay", {"key": "value"})
    assert msg["axip"] == "0.1.0"
    assert msg["type"] == "announce"
    assert msg["to"] == "relay"
    assert msg["from"]["agent_id"] == identity.agent_id
    assert msg["from"]["pubkey"] == identity.pubkey_formatted
    assert msg["payload"] == {"key": "value"}
    assert msg["id"].startswith("msg_")
    assert msg["nonce"]
    assert msg["timestamp"].endswith("Z")
    assert msg["signature"] is None


def test_build_message_unique_ids(identity):
    msg1 = build_message("discover", identity, "relay", {})
    msg2 = build_message("discover", identity, "relay", {})
    assert msg1["id"] != msg2["id"]
    assert msg1["nonce"] != msg2["nonce"]


# ─── Canonicalize ─────────────────────────────────────────────────


def test_canonicalize_key_order(identity):
    msg = build_message("heartbeat", identity, "relay", {"status": "online"})
    canonical = canonicalize(msg)
    data = json.loads(canonical)
    keys = list(data.keys())
    assert keys == ["axip", "id", "type", "from", "to", "timestamp", "nonce", "payload"]


def test_canonicalize_no_spaces(identity):
    msg = build_message("heartbeat", identity, "relay", {})
    canonical = canonicalize(msg)
    assert " " not in canonical


def test_canonicalize_deterministic(identity):
    msg = build_message("heartbeat", identity, "relay", {"a": 1, "b": 2})
    c1 = canonicalize(msg)
    c2 = canonicalize(msg)
    assert c1 == c2


def test_canonicalize_excludes_signature(identity):
    msg = build_message("heartbeat", identity, "relay", {})
    msg["signature"] = "ed25519:somesig"
    canonical = canonicalize(msg)
    assert "signature" not in canonical


# ─── sign_message and verify_message ─────────────────────────────


def test_sign_sets_signature(identity):
    msg = build_message("heartbeat", identity, "relay", {})
    assert msg["signature"] is None
    sign_message(msg, identity.signing_key)
    assert msg["signature"] is not None
    assert msg["signature"].startswith("ed25519:")


def test_verify_valid_signature(identity):
    msg = build_message("announce", identity, "relay", {"capabilities": ["web_search"]})
    sign_message(msg, identity.signing_key)
    assert verify_message(msg)


def test_verify_tampered_payload(identity):
    msg = build_message("announce", identity, "relay", {"capabilities": ["web_search"]})
    sign_message(msg, identity.signing_key)
    msg["payload"]["capabilities"] = ["code_execution"]
    assert not verify_message(msg)


def test_verify_tampered_type(identity):
    msg = build_message("announce", identity, "relay", {})
    sign_message(msg, identity.signing_key)
    msg["type"] = "malicious"
    assert not verify_message(msg)


def test_verify_missing_signature(identity):
    msg = build_message("announce", identity, "relay", {})
    assert not verify_message(msg)


def test_verify_missing_pubkey(identity):
    msg = build_message("announce", identity, "relay", {})
    sign_message(msg, identity.signing_key)
    del msg["from"]["pubkey"]
    assert not verify_message(msg)


def test_verify_wrong_key(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        id_a = load_or_create_identity("agent-a")
        id_b = load_or_create_identity("agent-b")

    msg = build_message("announce", id_a, "relay", {})
    sign_message(msg, id_a.signing_key)
    # Replace the from pubkey with agent_b's key
    msg["from"]["pubkey"] = id_b.pubkey_formatted
    assert not verify_message(msg)


# ─── Type-Specific Builders ───────────────────────────────────────


def test_build_announce(identity):
    msg = build_announce(identity, capabilities=["web_search", "summarize"], name="my-agent")
    assert msg["type"] == "announce"
    assert msg["to"] == "relay"
    assert msg["payload"]["capabilities"] == ["web_search", "summarize"]
    assert msg["payload"]["name"] == "my-agent"
    assert msg["payload"]["version"] == "0.1.0"


def test_build_announce_default_pricing(identity):
    msg = build_announce(identity, capabilities=["translate"], name="t")
    assert msg["payload"]["pricing"] == {}


def test_build_announce_custom_pricing(identity):
    pricing = {"web_search": {"price_usd": 0.01}}
    msg = build_announce(identity, capabilities=["web_search"], name="t", pricing=pricing)
    assert msg["payload"]["pricing"] == pricing


def test_build_discover(identity):
    msg = build_discover(identity, capability="code_review")
    assert msg["type"] == "discover"
    assert msg["payload"]["capability"] == "code_review"
    assert msg["payload"]["constraints"] == {}


def test_build_task_request(identity):
    msg = build_task_request(
        identity, "relay",
        description="Summarize this article",
        capability="summarize",
        reward=0.02,
    )
    assert msg["type"] == "task_request"
    assert msg["payload"]["capability_required"] == "summarize"
    assert msg["payload"]["description"] == "Summarize this article"
    assert msg["payload"]["reward"] == 0.02
    assert msg["payload"]["task_id"].startswith("task_")


def test_build_task_request_custom_task_id(identity):
    msg = build_task_request(
        identity, "relay",
        task_id="task_custom_123",
        description="test",
        capability="web_search",
    )
    assert msg["payload"]["task_id"] == "task_custom_123"


def test_build_task_bid(identity):
    msg = build_task_bid(
        identity, "requester-abc",
        task_id="task_123",
        price=0.05,
        eta_seconds=15,
        confidence=0.95,
    )
    assert msg["type"] == "task_bid"
    assert msg["payload"]["task_id"] == "task_123"
    assert msg["payload"]["price_usd"] == 0.05
    assert msg["payload"]["estimated_time_seconds"] == 15
    assert msg["payload"]["confidence"] == 0.95
    assert msg["payload"]["bid_id"].startswith("bid_")


def test_build_task_accept(identity):
    msg = build_task_accept(identity, "provider-xyz", task_id="task_123", bid_id="bid_456")
    assert msg["type"] == "task_accept"
    assert msg["payload"]["task_id"] == "task_123"
    assert msg["payload"]["bid_id"] == "bid_456"


def test_build_task_result(identity):
    output = {"result": "Paris", "confidence": 0.99}
    msg = build_task_result(
        identity, "requester-abc",
        task_id="task_123",
        output=output,
        status="completed",
    )
    assert msg["type"] == "task_result"
    assert msg["payload"]["task_id"] == "task_123"
    assert msg["payload"]["output"] == output
    assert msg["payload"]["status"] == "completed"


def test_build_task_verify_success(identity):
    msg = build_task_verify(
        identity, "provider-xyz",
        task_id="task_123",
        verified=True,
        quality_score=0.9,
    )
    assert msg["type"] == "task_verify"
    assert msg["payload"]["verified"] is True
    assert msg["payload"]["quality_score"] == 0.9


def test_build_task_verify_reject(identity):
    msg = build_task_verify(identity, "provider-xyz", task_id="task_123", verified=False)
    assert msg["payload"]["verified"] is False


def test_build_heartbeat(identity):
    msg = build_heartbeat(identity, status="online", active_tasks=2, load=0.3)
    assert msg["type"] == "heartbeat"
    assert msg["payload"]["status"] == "online"
    assert msg["payload"]["active_tasks"] == 2
    assert msg["payload"]["load"] == 0.3


# ─── Full lifecycle sign + verify ─────────────────────────────────


def test_full_task_lifecycle_signatures(tmp_path):
    """Every message in a task lifecycle should sign and verify correctly."""
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        requester = load_or_create_identity("requester")
        provider = load_or_create_identity("provider")

    task_id = f"task_{uuid.uuid4()}"
    bid_id = f"bid_{uuid.uuid4()}"

    messages = [
        build_announce(requester, capabilities=[], name="requester"),
        build_announce(provider, capabilities=["web_search"], name="provider"),
        build_discover(requester, capability="web_search"),
        build_task_request(requester, provider.agent_id, task_id=task_id,
                           description="Search news", capability="web_search", reward=0.01),
        build_task_bid(provider, requester.agent_id, task_id=task_id,
                       bid_id=bid_id, price=0.01),
        build_task_accept(requester, provider.agent_id, task_id=task_id, bid_id=bid_id),
        build_task_result(provider, requester.agent_id, task_id=task_id,
                          output={"result": "news here"}),
        build_task_verify(requester, provider.agent_id, task_id=task_id,
                          verified=True, quality_score=0.95),
        build_heartbeat(provider),
    ]

    identities = {
        requester.agent_id: requester,
        provider.agent_id: provider,
    }

    for msg in messages:
        sender_id = msg["from"]["agent_id"]
        identity = identities[sender_id]
        sign_message(msg, identity.signing_key)
        assert verify_message(msg), f"Signature verification failed for {msg['type']}"
