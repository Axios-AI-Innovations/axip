"""
AXIP Python SDK — Hello World Example

A minimal agent that handles "echo" capability tasks.
Connect to a local relay and respond to task requests.

Run:
    pip install axip
    python hello_agent.py
"""

import asyncio
import logging
from axip import AXIPAgent

logging.basicConfig(level=logging.INFO, format="%(message)s")


async def main():
    agent = AXIPAgent(
        name="py-hello",
        capabilities=["echo"],
        relay_url="ws://127.0.0.1:4200",
        pricing={"echo": {"price_usd": 0.001}},
    )

    @agent.on_task("echo")
    async def handle_echo(task):
        description = task["payload"]["description"]
        print(f"[py-hello] Got task: {description}")
        await agent.complete_task(
            task,
            output={"echoed": description},
            model_used="python",
        )

    print(f"[py-hello] Starting agent: {agent.identity.agent_id}")
    await agent.start()


if __name__ == "__main__":
    asyncio.run(main())
