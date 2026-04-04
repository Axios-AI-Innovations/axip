"""
CrewAI + AXIP Example

Demonstrates a two-agent CrewAI crew where:
- A Researcher agent uses AXIP to search the web and gather information
- An Analyst agent uses AXIP to summarize and structure the findings

Prerequisites:
    pip install crewai axip
    # Also requires Node.js 18+ for the MCP relay if used via MCP
    # Or connect directly to a local relay:
    #   cd ~/axios-axip && pm2 start all

Usage:
    ANTHROPIC_API_KEY=... python crewai_example.py
    # Or against a public relay:
    AXIP_RELAY_URL=wss://relay.axiosaiinnovations.com python crewai_example.py
"""

import os
import asyncio
from crewai import Agent, Task, Crew, Process
from axip.crewai_tools import make_axip_tools

# ─── Configuration ────────────────────────────────────────────────────────

RELAY_URL = os.environ.get("AXIP_RELAY_URL", "ws://127.0.0.1:4200")

# Create AXIP tools — shared across all agents in this crew
axip_tools = make_axip_tools(
    relay_url=RELAY_URL,
    agent_name="crewai-researcher",
    max_cost=0.25,     # cap total spend at $0.25
    timeout=60.0,
)

# ─── Agents ───────────────────────────────────────────────────────────────

researcher = Agent(
    role="Research Specialist",
    goal=(
        "Use the AXIP network to find accurate, up-to-date information. "
        "Always check axip_network_status first, then use axip_request_task "
        "with the appropriate capability."
    ),
    backstory=(
        "You are an expert research agent that delegates specialized tasks "
        "to the AXIP AI agent marketplace. You know how to pick the right "
        "capability for each task and interpret the results."
    ),
    tools=axip_tools,
    verbose=True,
    allow_delegation=False,
)

analyst = Agent(
    role="Senior Analyst",
    goal=(
        "Synthesize research findings into clear, structured reports. "
        "Use AXIP's summarize capability to distill long content, then "
        "add your own expert analysis on top."
    ),
    backstory=(
        "You are a senior analyst who takes raw research and turns it into "
        "actionable insights. You use AXIP to handle heavy lifting "
        "(summarization, extraction) and focus your effort on interpretation."
    ),
    tools=axip_tools,
    verbose=True,
    allow_delegation=False,
)

# ─── Tasks ────────────────────────────────────────────────────────────────

research_task = Task(
    description=(
        "Research the current state of AI agent communication protocols in 2026. "
        "Use axip_network_status to check what the AXIP network can do, then "
        "use axip_request_task with capability 'web_search' to find recent "
        "developments. Focus on: key protocols, adoption, and notable projects."
    ),
    expected_output=(
        "A detailed research report with findings about AI agent protocols, "
        "including specific examples, projects, and trends found via web search."
    ),
    agent=researcher,
)

analysis_task = Task(
    description=(
        "Take the research findings from the Research Specialist and create "
        "an executive summary. Use axip_request_task with capability 'summarize' "
        "to condense the raw findings, then add your expert analysis: "
        "what are the 3 most important trends, and what should AI developers do next?"
    ),
    expected_output=(
        "A concise executive summary (300-500 words) with:\n"
        "1. Key findings from the research\n"
        "2. Top 3 trends in AI agent protocols\n"
        "3. Recommended next steps for AI developers"
    ),
    agent=analyst,
    context=[research_task],
)

# ─── Crew ─────────────────────────────────────────────────────────────────

crew = Crew(
    agents=[researcher, analyst],
    tasks=[research_task, analysis_task],
    process=Process.sequential,
    verbose=True,
)

# ─── Run ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  AXIP + CrewAI Research Crew")
    print(f"  Relay: {RELAY_URL}")
    print("=" * 60 + "\n")

    result = crew.kickoff()

    print("\n" + "=" * 60)
    print("  FINAL REPORT")
    print("=" * 60)
    print(result)
