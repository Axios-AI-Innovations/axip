"""
OpenAI Agents SDK + AXIP Example (Direct Python SDK)

Demonstrates using AXIP tools with the OpenAI Agents SDK via the Python SDK.
No Node.js or npx required — pure Python.

Setup:
    pip install axip openai-agents

Usage:
    OPENAI_API_KEY=sk-... python openai_agents_example.py
    OPENAI_API_KEY=sk-... python openai_agents_example.py workflow
"""

import asyncio
import os
import sys

# ─── Add local SDK to path for development ────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from axip.openai_agents_tools import make_axip_tools


async def run_research_agent(query: str, relay_url: str = "ws://127.0.0.1:4200") -> str:
    """
    Run an OpenAI Agents SDK agent that uses AXIP tools to answer a query.

    The agent can:
    - axip_network_status  — check what's available
    - axip_discover_agents — find agents for a capability
    - axip_request_task    — delegate work to AXIP agents
    """
    from agents import Agent, Runner

    print(f"[example] Connecting to AXIP relay at {relay_url}…")
    tools = make_axip_tools(relay_url=relay_url, agent_name="openai-agents-demo")

    agent = Agent(
        name="AXIP Research Assistant",
        model="gpt-4o",
        instructions=(
            "You are a research assistant with access to the AXIP agent network. "
            "Use axip_network_status to see what's available, then delegate tasks "
            "to the appropriate AXIP agents via axip_request_task."
        ),
        tools=tools,
    )

    print(f"[example] Query: {query}\n")
    result = await Runner.run(agent, query)
    return result.final_output


async def run_multi_step_workflow(relay_url: str = "ws://127.0.0.1:4200") -> str:
    """
    Example: multi-step workflow where the agent searches, then summarizes.
    Shows that OpenAI Agents SDK can orchestrate multiple AXIP capability calls.
    """
    from agents import Agent, Runner

    tools = make_axip_tools(relay_url=relay_url, agent_name="openai-agents-workflow")

    agent = Agent(
        name="AXIP Workflow Agent",
        model="gpt-4o",
        instructions=(
            "You are a research workflow agent. When given a task: "
            "1. Check the AXIP network status. "
            "2. Use axip_request_task to search the web for relevant info. "
            "3. Use axip_request_task to summarize the findings. "
            "4. Return a clean, structured result."
        ),
        tools=tools,
    )

    query = (
        "First check what agents are available on the AXIP network. "
        "Then search for 'AI agent protocols 2025' and summarize the key findings "
        "in 3 bullet points."
    )

    print(f"[workflow] Running multi-step query: {query[:60]}…\n")
    result = await Runner.run(agent, query)
    return result.final_output


async def run_with_handoff(relay_url: str = "ws://127.0.0.1:4200") -> str:
    """
    Advanced example: two agents with handoff.
    A coordinator agent decides which AXIP capability to use,
    then hands off to a specialist agent that executes it.
    """
    from agents import Agent, Runner, handoff

    tools = make_axip_tools(relay_url=relay_url, agent_name="openai-agents-specialist")

    specialist = Agent(
        name="AXIP Specialist",
        model="gpt-4o-mini",
        instructions=(
            "You are an AXIP task executor. Use the provided tools to complete "
            "the specific task you've been handed off. Return only the result."
        ),
        tools=tools,
    )

    coordinator = Agent(
        name="AXIP Coordinator",
        model="gpt-4o",
        instructions=(
            "You coordinate tasks. Analyze the user's request, then hand off "
            "to the AXIP Specialist to execute it using the AXIP network."
        ),
        handoffs=[handoff(specialist)],
    )

    result = await Runner.run(
        coordinator,
        "Search for the latest news on multi-agent AI systems and give me a brief summary.",
    )
    return result.final_output


if __name__ == "__main__":
    relay_url = os.environ.get("AXIP_RELAY_URL", "ws://127.0.0.1:4200")

    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set.")
        print("Export it and re-run: export OPENAI_API_KEY=sk-...")
        sys.exit(1)

    mode = sys.argv[1] if len(sys.argv) > 1 else "single"

    if mode == "workflow":
        answer = asyncio.run(run_multi_step_workflow(relay_url))
    elif mode == "handoff":
        answer = asyncio.run(run_with_handoff(relay_url))
    else:
        answer = asyncio.run(
            run_research_agent(
                "Search for the latest news on AI agent frameworks and give me a 2-sentence summary.",
                relay_url=relay_url,
            )
        )

    print("\n=== Final Answer ===")
    print(answer)
