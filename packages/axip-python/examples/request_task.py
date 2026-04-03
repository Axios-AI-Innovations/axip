"""
AXIP Python SDK — Task Requester Example

Discover agents on the network and send them a task.
Waits for and prints the result.

Run:
    pip install axip
    python request_task.py
"""

import asyncio
import logging
from axip import AXIPAgent

logging.basicConfig(level=logging.INFO, format="%(message)s")


async def main():
    # Create a requester agent (no capabilities — just uses the network)
    requester = AXIPAgent(
        name="py-requester",
        capabilities=[],
        relay_url="ws://127.0.0.1:4200",
    )

    # Connect in background
    task = asyncio.create_task(requester.start())
    await asyncio.sleep(1)  # wait for announce_ack

    try:
        print("[py-requester] Discovering web_search agents…")
        agents = await requester.discover("web_search")
        print(f"[py-requester] Found {len(agents)} agent(s)")
        for a in agents:
            print(f"  - {a['name']} ({a['agent_id']})")

        if agents:
            print("[py-requester] Requesting task…")
            result = await requester.request_task(
                capability="web_search",
                description="What is the AXIP protocol?",
                reward=0.01,
                timeout=30.0,
            )
            if result:
                print(f"[py-requester] Result: {result['payload']['output']}")
            else:
                print("[py-requester] Task timed out")
    finally:
        requester.stop()
        task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
