"""
LangChain + AXIP Example (Direct Python SDK)

Demonstrates using AXIP tools with LangChain/LangGraph via the Python SDK.
No Node.js or npx required — pure Python.

Setup:
    pip install axip langchain-core langgraph langchain-anthropic

Usage:
    ANTHROPIC_API_KEY=sk-... python langchain_example.py
"""

import asyncio
import os
import sys

# ─── Add local SDK to path for development ────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from axip.langchain_tools import make_axip_tools


async def run_research_agent(query: str, relay_url: str = "ws://127.0.0.1:4200") -> str:
    """
    Run a LangChain ReAct agent that uses AXIP tools to answer a query.

    The agent can:
    - axip_network_status  — check what's available
    - axip_discover_agents — find agents for a capability
    - axip_request_task    — delegate work to AXIP agents
    """
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import HumanMessage
    from langgraph.prebuilt import create_react_agent

    print(f"[example] Connecting to AXIP relay at {relay_url}…")
    tools = make_axip_tools(relay_url=relay_url, agent_name="langchain-demo")

    model = ChatAnthropic(model="claude-haiku-4-5-20251001")
    agent = create_react_agent(model, tools)

    print(f"[example] Query: {query}\n")
    result = await agent.ainvoke({"messages": [HumanMessage(content=query)]})

    answer = result["messages"][-1].content
    return answer


async def run_multi_step_workflow(relay_url: str = "ws://127.0.0.1:4200"):
    """
    Example: multi-step workflow where the agent searches, then summarizes.
    Shows that LangChain can orchestrate multiple AXIP capability calls.
    """
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import HumanMessage
    from langgraph.prebuilt import create_react_agent

    tools = make_axip_tools(relay_url=relay_url, agent_name="langchain-workflow")
    model = ChatAnthropic(model="claude-haiku-4-5-20251001")
    agent = create_react_agent(model, tools)

    query = (
        "First check what agents are available on the AXIP network. "
        "Then search for 'AI agent protocols 2025' and summarize the key findings "
        "in 3 bullet points."
    )

    print(f"[workflow] Running multi-step query: {query[:60]}…\n")
    result = await agent.ainvoke({"messages": [HumanMessage(content=query)]})
    return result["messages"][-1].content


def demo_sync_usage(relay_url: str = "ws://127.0.0.1:4200"):
    """
    Synchronous usage example — for scripts that don't use asyncio.
    LangGraph's ainvoke must be wrapped with asyncio.run().
    """
    answer = asyncio.run(
        run_research_agent(
            "What AI agent frameworks are popular in 2025? Search and summarize.",
            relay_url=relay_url,
        )
    )
    print("\n=== Answer ===")
    print(answer)


if __name__ == "__main__":
    relay_url = os.environ.get("AXIP_RELAY_URL", "ws://127.0.0.1:4200")

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        print("Export it and re-run: export ANTHROPIC_API_KEY=sk-...")
        sys.exit(1)

    mode = sys.argv[1] if len(sys.argv) > 1 else "single"

    if mode == "workflow":
        answer = asyncio.run(run_multi_step_workflow(relay_url))
    else:
        answer = asyncio.run(
            run_research_agent(
                "Search for the latest news on AI agent frameworks and give me a 2-sentence summary.",
                relay_url=relay_url,
            )
        )

    print("\n=== Final Answer ===")
    print(answer)
