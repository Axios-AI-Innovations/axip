"""
AXIP SDK — Agent Class

The main interface for building AXIP-compatible agents in Python.

Usage:
    from axip import AXIPAgent

    agent = AXIPAgent(
        name="my-agent",
        capabilities=["web_search"],
        relay_url="ws://127.0.0.1:4200",
    )

    @agent.on_task("web_search")
    async def handle_search(task):
        result = do_search(task["payload"]["description"])
        await agent.complete_task(task, output=result)

    import asyncio
    asyncio.run(agent.start())
"""

import asyncio
import json
import logging
import os
from collections.abc import Callable, Awaitable
from typing import Any

import websockets.asyncio.client as ws_client
from websockets.exceptions import ConnectionClosed

from .crypto import load_or_create_identity, Identity
from .messages import (
    build_announce, build_discover, build_task_bid,
    build_task_result, build_heartbeat, sign_message,
    build_message,
)

logger = logging.getLogger("axip")


class AXIPAgent:
    """
    AXIP agent that connects to a relay, announces capabilities,
    and handles inbound task requests.
    """

    def __init__(
        self,
        *,
        name: str,
        capabilities: list[str] | None = None,
        relay_url: str | None = None,
        pricing: dict | None = None,
        metadata: dict | None = None,
        reconnect: bool = True,
        heartbeat_interval: float = 30.0,
    ):
        self.name = name
        self.capabilities = capabilities or []
        self.relay_url = relay_url or os.environ.get("AXIP_RELAY_URL", "ws://127.0.0.1:4200")
        self.pricing = pricing or {}
        self.metadata = metadata or {}
        self.reconnect = reconnect
        self.heartbeat_interval = heartbeat_interval

        self.identity: Identity = load_or_create_identity(name)

        # Event handlers: capability → async callable
        self._task_handlers: dict[str, Callable] = {}
        # Generic message handlers: type → async callable
        self._message_handlers: dict[str, list[Callable]] = {}
        # Pending discover requests: nonce → asyncio.Future
        self._pending_discovers: dict[str, asyncio.Future] = {}

        self._ws = None  # websockets.asyncio.client.ClientConnection
        self._running = False
        self._send_lock = asyncio.Lock()

    # ─── Decorators ───────────────────────────────────────────────

    def on_task(self, capability: str):
        """
        Decorator to register a handler for a specific task capability.

        The handler receives the full task_request message dict.
        It should call await agent.complete_task(task, output=...) when done.
        """
        def decorator(fn: Callable[..., Awaitable]):
            self._task_handlers[capability] = fn
            return fn
        return decorator

    def on(self, msg_type: str):
        """
        Decorator to register a handler for any message type.
        Multiple handlers can be registered for the same type.
        """
        def decorator(fn: Callable[..., Awaitable]):
            self._message_handlers.setdefault(msg_type, []).append(fn)
            return fn
        return decorator

    # ─── Lifecycle ────────────────────────────────────────────────

    async def start(self):
        """
        Connect to the relay and run until stopped.
        Handles reconnection automatically if reconnect=True.
        """
        self._running = True
        while self._running:
            try:
                await self._connect_and_run()
            except (ConnectionClosed, OSError, ConnectionRefusedError) as e:
                if not self._running or not self.reconnect:
                    break
                logger.warning("[axip] Disconnected (%s) — reconnecting in 5s…", e)
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("[axip] Unexpected error: %s — reconnecting in 10s…", e)
                if not self._running or not self.reconnect:
                    break
                await asyncio.sleep(10)

    def stop(self):
        """Signal the agent to stop after the current iteration."""
        self._running = False
        for fut in self._pending_discovers.values():
            if not fut.done():
                fut.cancel()
        self._pending_discovers.clear()

    # ─── Internal: Connection ─────────────────────────────────────

    async def _connect_and_run(self):
        logger.info("[axip] Connecting to %s as %s", self.relay_url, self.name)
        async with ws_client.connect(
            self.relay_url,
            ping_interval=None,  # we handle heartbeats manually
            max_size=1_048_576,  # 1MB — matches relay limit
        ) as ws:
            self._ws = ws
            await self._announce()
            logger.info("[axip] Connected — agent_id: %s", self.identity.agent_id)

            # Run message loop + heartbeat in parallel
            await asyncio.gather(
                self._message_loop(ws),
                self._heartbeat_loop(),
            )

    async def _message_loop(self, ws):
        async for raw in ws:
            try:
                msg = json.loads(raw)
                await self._handle_message(msg)
            except json.JSONDecodeError:
                logger.warning("[axip] Received non-JSON message")
            except Exception as e:
                logger.error("[axip] Error handling message: %s", e)

    async def _heartbeat_loop(self):
        while self._running:
            await asyncio.sleep(self.heartbeat_interval)
            if self._ws is not None:
                try:
                    hb = build_heartbeat(self.identity)
                    sign_message(hb, self.identity.signing_key)
                    await self._send_raw(hb)
                except Exception:
                    break  # connection gone; message loop will handle reconnect

    # ─── Internal: Sending ────────────────────────────────────────

    async def _send_raw(self, msg: dict):
        if self._ws is None:
            raise RuntimeError("Not connected")
        async with self._send_lock:
            await self._ws.send(json.dumps(msg))

    async def _announce(self):
        msg = build_announce(
            self.identity,
            capabilities=self.capabilities,
            name=self.name,
            pricing=self.pricing,
            metadata=self.metadata,
        )
        sign_message(msg, self.identity.signing_key)
        await self._send_raw(msg)

    # ─── Internal: Message Dispatch ───────────────────────────────

    async def _handle_message(self, msg: dict):
        msg_type = msg.get("type")

        # Dispatch to generic handlers
        for handler in self._message_handlers.get(msg_type, []):
            asyncio.ensure_future(handler(msg))

        # Resolve pending discover futures
        if msg_type == "discover_result":
            req_id = msg.get("payload", {}).get("request_id")
            if req_id and req_id in self._pending_discovers:
                fut = self._pending_discovers.pop(req_id)
                if not fut.done():
                    fut.set_result(msg)
            return

        if msg_type == "announce_ack":
            logger.info("[axip] Relay acknowledged: agent_id=%s", self.identity.agent_id)
            return

        if msg_type == "task_request":
            await self._handle_task_request(msg)
            return

        if msg_type == "task_accept":
            # Notify any registered handlers
            return

    async def _handle_task_request(self, msg: dict):
        payload = msg.get("payload", {})
        capability = payload.get("capability_required")
        task_id = payload.get("task_id")
        requester_id = msg.get("from", {}).get("agent_id")

        handler = self._task_handlers.get(capability)
        if handler is None:
            logger.debug("[axip] No handler for capability: %s", capability)
            return

        # Auto-bid: use handler's declared price if set, else bid $0
        price = self.pricing.get(capability, {}).get("price_usd", 0.0)
        bid = build_task_bid(
            self.identity,
            requester_id,
            task_id=task_id,
            price=price,
            model="python",
        )
        sign_message(bid, self.identity.signing_key)
        await self._send_raw(bid)

        # Run the handler — it should call complete_task()
        asyncio.ensure_future(handler(msg))

    # ─── Public API ───────────────────────────────────────────────

    async def send(self, msg_type: str, to: str, payload: dict) -> dict:
        """Send a raw signed message. Returns the sent message."""
        msg = build_message(msg_type, self.identity, to, payload)
        sign_message(msg, self.identity.signing_key)
        await self._send_raw(msg)
        return msg

    async def discover(
        self,
        capability: str,
        *,
        constraints: dict | None = None,
        timeout: float = 10.0,
    ) -> list[dict]:
        """
        Discover agents with a given capability.
        Returns the list of matching agents.
        """
        from .messages import build_discover
        msg = build_discover(self.identity, capability=capability, constraints=constraints)
        sign_message(msg, self.identity.signing_key)

        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending_discovers[msg["id"]] = fut

        await self._send_raw(msg)

        try:
            result = await asyncio.wait_for(fut, timeout=timeout)
            return result.get("payload", {}).get("agents", [])
        except asyncio.TimeoutError:
            self._pending_discovers.pop(msg["id"], None)
            return []

    async def complete_task(
        self,
        task_msg: dict,
        *,
        output: Any,
        actual_cost: float = 0.0,
        actual_time: int = 0,
        model_used: str = "python",
    ):
        """
        Send a task_result back to the requester.
        Call this from within an on_task handler.
        """
        task_id = task_msg["payload"]["task_id"]
        requester_id = task_msg["from"]["agent_id"]

        result = build_task_result(
            self.identity,
            requester_id,
            task_id=task_id,
            output=output,
            actual_cost=actual_cost,
            actual_time=actual_time,
            model_used=model_used,
        )
        sign_message(result, self.identity.signing_key)
        await self._send_raw(result)
        logger.info("[axip] Task completed: %s", task_id)

    async def request_task(
        self,
        *,
        capability: str,
        description: str,
        reward: float = 0.0,
        constraints: dict | None = None,
        timeout: float = 30.0,
    ) -> dict | None:
        """
        High-level helper: discover an agent, send a task, wait for the result.
        Returns the task_result message or None on timeout.
        """
        agents = await self.discover(capability, constraints=constraints)
        if not agents:
            logger.warning("[axip] No agents found for capability: %s", capability)
            return None

        # Pick the cheapest available agent
        target = min(agents, key=lambda a: a.get("pricing", {}).get(capability, {}).get("price_usd", 999))
        target_id = target["agent_id"]

        from .messages import build_task_request
        task_msg = build_task_request(
            self.identity,
            target_id,
            description=description,
            capability=capability,
            reward=reward,
            constraints=constraints or {},
        )
        sign_message(task_msg, self.identity.signing_key)
        task_id = task_msg["payload"]["task_id"]

        # Wait for task_result
        result_fut: asyncio.Future = asyncio.get_event_loop().create_future()

        async def _on_result(msg):
            if msg.get("payload", {}).get("task_id") == task_id:
                if not result_fut.done():
                    result_fut.set_result(msg)

        handlers = self._message_handlers.setdefault("task_result", [])
        handlers.append(_on_result)

        await self._send_raw(task_msg)
        try:
            return await asyncio.wait_for(result_fut, timeout=timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            try:
                handlers.remove(_on_result)
            except ValueError:
                pass
