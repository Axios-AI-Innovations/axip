"""
Unit tests for AXIPAgent — initialization, decorators, and non-network behavior.
No relay connection required.
"""

import asyncio
from unittest.mock import patch

import pytest

from axip import AXIPAgent
from axip.crypto import load_or_create_identity


# ─── Fixtures ─────────────────────────────────────────────────────


@pytest.fixture
def agent(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        return AXIPAgent(
            name="unit-test-agent",
            capabilities=["web_search", "summarize"],
            relay_url="ws://127.0.0.1:19999",  # nothing listening here
            reconnect=False,
        )


# ─── Initialization ───────────────────────────────────────────────


def test_agent_has_identity(agent):
    assert agent.identity is not None
    assert agent.identity.agent_id.startswith("unit-test-agent-")


def test_agent_capabilities(agent):
    assert "web_search" in agent.capabilities
    assert "summarize" in agent.capabilities


def test_agent_default_relay_url(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        a = AXIPAgent(name="defaults-test")
    assert "127.0.0.1" in a.relay_url or "AXIP_RELAY_URL" in str(a.relay_url)


def test_agent_pricing(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    pricing = {"web_search": {"price_usd": 0.01}}
    with patch("axip.crypto.Path.home", return_value=fake_home):
        a = AXIPAgent(name="priced-agent", capabilities=["web_search"], pricing=pricing)
    assert a.pricing == pricing


def test_agent_initial_state(agent):
    assert agent._running is False
    assert agent._ws is None
    assert len(agent._task_handlers) == 0
    assert len(agent._message_handlers) == 0
    assert len(agent._pending_discovers) == 0


# ─── Decorators ───────────────────────────────────────────────────


def test_on_task_registers_handler(agent):
    @agent.on_task("web_search")
    async def handle_search(task):
        pass

    assert "web_search" in agent._task_handlers
    assert agent._task_handlers["web_search"] is handle_search


def test_on_task_multiple_capabilities(agent):
    @agent.on_task("web_search")
    async def handle_search(task):
        pass

    @agent.on_task("summarize")
    async def handle_summarize(task):
        pass

    assert "web_search" in agent._task_handlers
    assert "summarize" in agent._task_handlers


def test_on_task_overwrite(agent):
    @agent.on_task("web_search")
    async def handler_v1(task):
        pass

    @agent.on_task("web_search")
    async def handler_v2(task):
        pass

    assert agent._task_handlers["web_search"] is handler_v2


def test_on_message_registers_handler(agent):
    @agent.on("announce_ack")
    async def handle_ack(msg):
        pass

    assert "announce_ack" in agent._message_handlers
    assert handle_ack in agent._message_handlers["announce_ack"]


def test_on_message_multiple_handlers(agent):
    @agent.on("heartbeat")
    async def h1(msg):
        pass

    @agent.on("heartbeat")
    async def h2(msg):
        pass

    assert len(agent._message_handlers["heartbeat"]) == 2


def test_on_task_decorator_returns_function(agent):
    async def my_handler(task):
        pass

    result = agent.on_task("web_search")(my_handler)
    assert result is my_handler


def test_on_decorator_returns_function(agent):
    async def my_handler(msg):
        pass

    result = agent.on("announce_ack")(my_handler)
    assert result is my_handler


# ─── stop() cancels pending discovers ─────────────────────────────


def test_stop_cancels_pending_discovers(agent):
    loop = asyncio.new_event_loop()
    try:
        fut = loop.create_future()
        agent._pending_discovers["nonce_123"] = fut
        agent._running = True
        agent.stop()

        assert agent._running is False
        assert len(agent._pending_discovers) == 0
        assert fut.cancelled()
    finally:
        loop.close()


# ─── Connection failure (no server) ───────────────────────────────


@pytest.mark.asyncio
async def test_start_fails_gracefully_no_relay(tmp_path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    with patch("axip.crypto.Path.home", return_value=fake_home):
        a = AXIPAgent(
            name="no-relay-agent",
            relay_url="ws://127.0.0.1:19999",
            reconnect=False,
        )

    # Should return without raising when no relay is available and reconnect=False
    # (start() doesn't reset _running — caller uses stop() for that; just verify it returns)
    await asyncio.wait_for(a.start(), timeout=3.0)
    assert a._ws is None  # never connected
