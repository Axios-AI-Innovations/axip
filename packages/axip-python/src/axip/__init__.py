"""
AXIP Python SDK

Connect Python agents to the AXIP marketplace protocol.

Quick start:
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

from .agent import AXIPAgent
from .crypto import load_or_create_identity, generate_keypair, sign, verify
from .messages import (
    build_announce, build_discover, build_task_request,
    build_task_bid, build_task_accept, build_task_result,
    build_task_verify, build_heartbeat, canonicalize,
    sign_message, verify_message,
)

__version__ = "0.1.0"
__all__ = [
    "AXIPAgent",
    "load_or_create_identity",
    "generate_keypair",
    "sign",
    "verify",
    "build_announce",
    "build_discover",
    "build_task_request",
    "build_task_bid",
    "build_task_accept",
    "build_task_result",
    "build_task_verify",
    "build_heartbeat",
    "canonicalize",
    "sign_message",
    "verify_message",
]
