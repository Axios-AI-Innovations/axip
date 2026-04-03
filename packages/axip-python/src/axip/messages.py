"""
AXIP SDK — Message Builders

Builds AXIP protocol message envelopes for all message types.
Compatible with the JS SDK message format.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import nacl.signing

from .crypto import Identity, sign, format_pubkey, parse_pubkey, verify, from_base64


# ─── Canonical JSON for Signing ───────────────────────────────────


def canonicalize(msg: dict) -> str:
    """
    Produce a deterministic JSON string for signing.
    Matches JS SDK canonicalize() — includes fixed top-level key order.
    """
    signable = {
        "axip": msg["axip"],
        "id": msg["id"],
        "type": msg["type"],
        "from": msg["from"],
        "to": msg["to"],
        "timestamp": msg["timestamp"],
        "nonce": msg["nonce"],
        "payload": msg["payload"],
    }
    return json.dumps(signable, separators=(",", ":"))


# ─── Sign and Verify ──────────────────────────────────────────────


def sign_message(msg: dict, signing_key: nacl.signing.SigningKey) -> None:
    """Sign a message in place — sets msg['signature']."""
    canonical = canonicalize(msg)
    msg["signature"] = sign(canonical, signing_key)


def verify_message(msg: dict) -> bool:
    """Verify a message's signature against the embedded public key."""
    if not msg.get("signature") or not msg.get("from", {}).get("pubkey"):
        return False
    try:
        canonical = canonicalize(msg)
        vk = parse_pubkey(msg["from"]["pubkey"])
        return verify(canonical, msg["signature"], vk)
    except Exception:
        return False


# ─── Core Builder ─────────────────────────────────────────────────


def build_message(
    msg_type: str,
    identity: Identity,
    to: str,
    payload: dict,
) -> dict:
    """Build an unsigned AXIP message envelope."""
    return {
        "axip": "0.1.0",
        "id": f"msg_{uuid.uuid4()}",
        "type": msg_type,
        "from": {
            "agent_id": identity.agent_id,
            "pubkey": identity.pubkey_formatted,
        },
        "to": to,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "nonce": str(uuid.uuid4()),
        "payload": payload,
        "signature": None,
    }


# ─── Type-Specific Builders ───────────────────────────────────────


def build_announce(
    identity: Identity,
    *,
    capabilities: list[str],
    name: str,
    pricing: dict | None = None,
    metadata: dict | None = None,
) -> dict:
    return build_message("announce", identity, "relay", {
        "capabilities": capabilities,
        "name": name,
        "pricing": pricing or {},
        "constraints": {},
        "metadata": metadata or {},
        "version": "0.1.0",
    })


def build_discover(
    identity: Identity,
    *,
    capability: str,
    constraints: dict | None = None,
) -> dict:
    return build_message("discover", identity, "relay", {
        "capability": capability,
        "constraints": constraints or {},
    })


def build_task_request(
    identity: Identity,
    to: str,
    *,
    task_id: str | None = None,
    description: str,
    capability: str,
    constraints: dict | None = None,
    reward: float = 0.0,
) -> dict:
    return build_message("task_request", identity, to, {
        "task_id": task_id or f"task_{uuid.uuid4()}",
        "description": description,
        "capability_required": capability,
        "constraints": constraints or {},
        "reward": reward,
    })


def build_task_bid(
    identity: Identity,
    to: str,
    *,
    task_id: str,
    bid_id: str | None = None,
    price: float,
    eta_seconds: int = 30,
    confidence: float = 0.9,
    model: str = "local",
    message: str = "",
) -> dict:
    return build_message("task_bid", identity, to, {
        "task_id": task_id,
        "bid_id": bid_id or f"bid_{uuid.uuid4()}",
        "price_usd": price,
        "estimated_time_seconds": eta_seconds,
        "confidence": confidence,
        "model": model,
        "message": message,
    })


def build_task_accept(
    identity: Identity,
    to: str,
    *,
    task_id: str,
    bid_id: str,
) -> dict:
    return build_message("task_accept", identity, to, {
        "task_id": task_id,
        "bid_id": bid_id,
    })


def build_task_result(
    identity: Identity,
    to: str,
    *,
    task_id: str,
    output: Any,
    status: str = "completed",
    actual_cost: float = 0.0,
    actual_time: int = 0,
    model_used: str = "local",
) -> dict:
    return build_message("task_result", identity, to, {
        "task_id": task_id,
        "status": status,
        "output": output,
        "actual_cost_usd": actual_cost,
        "actual_time_seconds": actual_time,
        "model_used": model_used,
    })


def build_task_verify(
    identity: Identity,
    to: str,
    *,
    task_id: str,
    verified: bool,
    quality_score: float | None = None,
    feedback: str = "",
) -> dict:
    return build_message("task_verify", identity, to, {
        "task_id": task_id,
        "verified": verified,
        "quality_score": quality_score,
        "feedback": feedback,
    })


def build_heartbeat(identity: Identity, *, status: str = "online", active_tasks: int = 0, load: float = 0.0) -> dict:
    return build_message("heartbeat", identity, "relay", {
        "status": status,
        "active_tasks": active_tasks,
        "load": load,
    })
