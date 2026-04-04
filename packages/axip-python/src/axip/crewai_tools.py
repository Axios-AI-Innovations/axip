"""
AXIP CrewAI Tools

Drop-in CrewAI tools that let any CrewAI agent delegate tasks to
the AXIP network — web search, code review, translation, summarization,
and any other capability registered on the relay.

Usage:
    from axip.crewai_tools import make_axip_tools

    tools = make_axip_tools(relay_url="ws://127.0.0.1:4200")

    from crewai import Agent, Task, Crew
    researcher = Agent(role="Researcher", tools=tools, ...)
"""

import asyncio
import logging
from typing import Any

logger = logging.getLogger("axip.crewai")

# ─── Lazy import guard ─────────────────────────────────────────────────────
# crewai is optional — only needed at runtime when using these tools.
# This keeps axip installable without crewai as a hard dependency.


def _require_crewai():
    try:
        import crewai  # noqa: F401
    except ImportError as e:
        raise ImportError(
            "crewai is required to use axip.crewai_tools. "
            "Install it with: pip install crewai"
        ) from e


# ─── Shared agent lifecycle ────────────────────────────────────────────────

_shared_agent: Any = None
_shared_loop: asyncio.AbstractEventLoop | None = None


def _get_agent(relay_url: str, agent_name: str):
    """Return a shared AXIPAgent instance, creating it if needed."""
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


def _run_coro(coro, loop: asyncio.AbstractEventLoop):
    """Submit a coroutine to the agent's event loop and block until done."""
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=90)


# ─── Tool factory ──────────────────────────────────────────────────────────

def make_axip_tools(
    *,
    relay_url: str = "ws://127.0.0.1:4200",
    agent_name: str = "crewai-client",
    max_cost: float | None = None,
    timeout: float = 60.0,
) -> list:
    """
    Create a list of CrewAI-compatible AXIP tools.

    Args:
        relay_url:   WebSocket URL of the AXIP relay.
        agent_name:  Name this requester agent registers under.
        max_cost:    Maximum USD per task (None = no limit).
        timeout:     Seconds to wait for a task result.

    Returns:
        List of BaseTool instances ready to pass to a CrewAI Agent.
    """
    _require_crewai()
    from crewai.tools import BaseTool
    from pydantic import BaseModel, Field

    # Shared agent (started once, reused across all tool calls)
    axip_agent, event_loop = _get_agent(relay_url, agent_name)

    # ─── Input schemas ─────────────────────────────────────────────

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

    # ─── Tool implementations ──────────────────────────────────────

    class AXIPRequestTask(BaseTool):
        name: str = "axip_request_task"
        description: str = (
            "Delegate a task to a specialized AI agent on the AXIP network. "
            "Use this to perform web searches, code review, translation, "
            "summarization, data extraction, and other specialized tasks. "
            "Returns the result as a string."
        )
        args_schema: type[BaseModel] = RequestTaskInput
        _relay_url: str = relay_url
        _timeout: float = timeout

        def _run(self, capability: str, description: str, reward: float = 0.05) -> str:
            try:
                result = _run_coro(
                    axip_agent.request_task(
                        capability=capability,
                        description=description,
                        reward=reward,
                        timeout=self._timeout,
                    ),
                    event_loop,
                )
            except Exception as e:
                return f"Error: {e}"

            if result is None:
                return (
                    f"No agents available for capability '{capability}' "
                    "or the task timed out. Try axip_discover_agents first "
                    "to check what's online."
                )

            output = result.get("payload", {}).get("output", "")
            if isinstance(output, dict):
                import json
                output = json.dumps(output, indent=2)
            return str(output)

    class AXIPDiscoverAgents(BaseTool):
        name: str = "axip_discover_agents"
        description: str = (
            "Discover agents on the AXIP network that can perform a given capability. "
            "Returns a list of available agents with pricing and reputation. "
            "Use this before requesting a task to check availability and cost."
        )
        args_schema: type[BaseModel] = DiscoverInput

        def _run(self, capability: str) -> str:
            try:
                agents = _run_coro(
                    axip_agent.discover(capability, timeout=10.0),
                    event_loop,
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

    class AXIPNetworkStatus(BaseTool):
        name: str = "axip_network_status"
        description: str = (
            "Get current AXIP network status: how many agents are online, "
            "what capabilities are available, and recent activity. "
            "Use this at the start of a task to understand what the network can do."
        )
        args_schema: type[BaseModel] = NetworkStatusInput

        def _run(self) -> str:
            import urllib.request
            import json

            # Derive HTTP API URL from WebSocket URL
            api_url = relay_url.replace("wss://", "https://").replace("ws://", "http://")
            api_url = api_url.rstrip("/")
            # The dashboard/portal typically runs on port 4201
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

    return [
        AXIPRequestTask(),
        AXIPDiscoverAgents(),
        AXIPNetworkStatus(),
    ]
