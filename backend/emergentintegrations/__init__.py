"""Lightweight shim for emergentintegrations used for local development.

This stub implements the minimal API surface the app imports:
- emergentintegrations.llm.chat.LlmChat
- emergentintegrations.llm.chat.UserMessage
- emergentintegrations.llm.chat.ImageContent

The real package is expected in production. This stub returns safe defaults
so the backend can start for local development without the external package.
"""

__all__ = ["llm"]

