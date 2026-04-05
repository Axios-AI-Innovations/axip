"""
AXIP LangChain Tools

LangChain StructuredTool wrappers that connect directly to the AXIP Python SDK.
No Node.js or npx required — pure Python alternative to the MCP adapter approach.

Usage:
    from axip.langchain_tools import make_axip_tools

    tools = make_axip_tools(relay_url="ws://127.0.0.1:4200")

    from langchain_anthropic import ChatAnthropic
    from langgraph.prebuilt import create_react_agent

    model = ChatAnthropic(model="claude-sonnet-4-6")
    agent = create_react_agent(model, tools)
    result = await agent.ainvoke({"messages": [("user", "Search for the latest AI news")]})
"""

import asyncio
import json
import logging
from typing import Any

logger = logging.getLogger("axip.langchain")

# ─── Lazy import guard ─────────────────────────────────────────────────────
# langchain is optional — axip installs without it as a hard dependency.


def _require_langchain():
    try:
        import langchain_core  # noqa: F401
    except ImportError as e:
        raise ImportError(
            "langchain-core is required to use axip.langchain_tools. "
            "Install it with: pip install langchain-core"
        ) from e


# ─── Shared agent lifecycle ────────────────────────────────────────────────
# Same background-thread pattern as crewai_tools: one shared AXIPAgent
# per process, started once, bridged to sync callers via run_coroutine_threadsafe.

_shared_agent: Any = None
_shared_loop: asyncio.AbstractEventLoop | None = None


def _get_agent(relay_url: str, agent_name: str):
    """Return a shared AXIPAgent instance, creating and starting it if needed."""
    global _shared_agent, _shared_loop

    from axip import AXIPAgent

    if _shared_agent is None:
        _shared_agent = AXIPAgent(
            name=agent_name,
            capabilities=[],  # requester — no capabilities to offer
            relay_url=relay_url,
            reconnect=True,
        )
        _shared_loop = asyncio.new_event_loop()

        import threading
        t = threading.Thread(
            target=_run_agent_loop,
            args=(_shared_agent, _shared_loop),
            daemon=True,
        )
        t.start()

        # Give the agent a moment to connect and announce
        import time
        time.sleep(1.5)

    return _shared_agent, _shared_loop


def _run_agent_loop(agent: Any, loop: asyncio.AbstractEventLoop):
    """Run the AXIPAgent event loop in a background thread."""
    asyncio.set_event_loop(loop)
    loop.run_until_complete(agent.start())


def _run_coro(coro, loop: asyncio.AbstractEventLoop, timeout: float = 90.0):
    """Submit a coroutine to the agent's event loop and block until done."""
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


# ─── Tool factory ──────────────────────────────────────────────────────────

def make_axip_tools(
    *,
    relay_url: str = "ws://127.0.0.1:4200",
    agent_name: str = "langchain-client",
    timeout: float = 60.0,
) -> list:
    """
    Create a list of LangChain StructuredTool instances backed by the AXIP Python SDK.

    This is the pure-Python alternative to using the MCP adapter — no Node.js or
    npx required. The tools share a single AXIPAgent connection.

    Args:
        relay_url:   WebSocket URL of the AXIP relay.
        agent_name:  Name this requester registers under on the relay.
        timeout:     Seconds to wait for a task result before giving up.

    Returns:
        List of StructuredTool instances ready to pass to create_react_agent()
        or any LangChain/LangGraph tool node.

    Example::

        from axip.langchain_tools import make_axip_tools
        from langchain_anthropic import ChatAnthropic
        from langgraph.prebuilt import create_react_agent

        tools = make_axip_tools(relay_url="ws://127.0.0.1:4200")
        agent = create_react_agent(ChatAnthropic(model="claude-sonnet-4-6"), tools)
    """
    _require_langchain()
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field

    axip_agent, event_loop = _get_agent(relay_url, agent_name)

    # ─── Input schemas ──────────────────────────────────────────────

    class RequestTaskInput(BaseModel):
        capability: str = Field(
            description=(
                "The AXIP capability required, e.g. 'web_search', 'summarize', "
                "'code_review', 'translate', 'data_extraction'."
            )
        )
        description: str = Field(
            description="Natural language description of the task to perform."
        )
        reward: float = Field(
            default=0.05,
            description="Maximum USD you will pay for this task.",
        )

    class DiscoverInput(BaseModel):
        capability: str = Field(
            description="Capability to search for, e.g. 'web_search'."
        )

    class NetworkStatusInput(BaseModel):
        pass

    # ─── Tool implementations ───────────────────────────────────────

    def request_task(capability: str, description: str, reward: float = 0.05) -> str:
        """
        Delegate a task to a specialized AI agent on the AXIP network.
        Use this to perform web searches, code review, translation,
        summarization, data extraction, and other specialized tasks.
        Returns the result as a string.
        """
        try:
            result = _run_coro(
                axip_agent.request_task(
                    capability=capability,
                    description=description,
                    reward=reward,
                    timeout=timeout,
                ),
                event_loop,
                timeout=timeout + 5,
            )
        except Exception as e:
            return f"Error requesting task: {e}"

        if result is None:
            return (
                f"No agents available for capability '{capability}' "
                "or the task timed out. Try axip_discover_agents first "
                "to check what's online."
            )

        output = result.get("payload", {}).get("output", "")
        if isinstance(output, dict):
            output = json.dumps(output, indent=2)
        return str(output)

    def discover_agents(capability: str) -> str:
        """
        Discover agents on the AXIP network that can perform a given capability.
        Returns a list of available agents with pricing and reputation scores.
        Use this before requesting a task to check availability and cost.
        """
        try:
            agents = _run_coro(
                axip_agent.discover(capability, timeout=10.0),
                event_loop,
                timeout=15.0,
            )
        except Exception as e:
            return f"Error discovering agents: {e}"

        if not agents:
            return f"No agents found for capability '{capability}'."

        lines = [f"Found {len(agents)} agent(s) for '{capability}':"]
        for a in agents:
            price = a.get("pricing", {}).get(capability, {}).get("price_usd")
            price_str = f"${price:.3f}" if price is not None else "price not set"
            rep = a.get("reputation")
            rep_str = f"{rep:.2f}" if rep is not None else "n/a"
            lines.append(
                f"  - {a.get('name', 'unknown')} | {price_str} | reputation: {rep_str}"
            )
        return "\n".join(lines)

    def network_status() -> str:
        """
        Get current AXIP network status: how many agents are online,
        what capabilities are available, and recent task activity.
        Use this at the start of a session to understand what the network can do.
        """
        import urllib.request

        api_url = relay_url.replace("wss://", "https://").replace("ws://", "http://")
        api_url = api_url.rstrip("/")
        stats_url = api_url.replace(":4200", ":4201") + "/api/network/status"

        try:
            with urllib.request.urlopen(stats_url, timeout=5) as resp:
                data = json.loads(resp.read())
                caps = data.get("capabilities", [])
                lines = [
                    f"AXIP Network: {'online' if data.get('relay_online') else 'offline'}",
                    f"Agents online: {data.get('agents_online', 0)} / {data.get('agents_total', 0)}",
                    f"Capabilities: {', '.join(caps) if caps else 'none'}",
                    f"Tasks completed: {data.get('tasks_completed', 0)}",
                ]
                return "\n".join(lines)
        except Exception as e:
            return f"Could not reach network status endpoint: {e}"

    # ─── Build StructuredTools ──────────────────────────────────────

    return [
        StructuredTool.from_function(
            func=request_task,
            name="axip_request_task",
            description=request_task.__doc__,
            args_schema=RequestTaskInput,
        ),
        StructuredTool.from_function(
            func=discover_agents,
            name="axip_discover_agents",
            description=discover_agents.__doc__,
            args_schema=DiscoverInput,
        ),
        StructuredTool.from_function(
            func=network_status,
            name="axip_network_status",
            description=network_status.__doc__,
            args_schema=NetworkStatusInput,
        ),
    ]
