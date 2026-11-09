import asyncio
import uuid
from typing import Any, List, Optional


class ImageContent:
    def __init__(self, image_base64: str):
        self.image_base64 = image_base64


class UserMessage:
    def __init__(self, text: str = "", file_contents: Optional[List[ImageContent]] = None):
        self.text = text
        self.file_contents = file_contents or []


class LlmChat:
    """Minimal LlmChat stub that provides the used methods.

    The real implementation talks to Emergent's LLM. This stub returns
    a harmless JSON string (empty object) so the backend can continue.
    """

    def __init__(self, api_key: str = "", session_id: Optional[str] = None, system_message: str = ""):
        self.api_key = api_key
        self.session_id = session_id or f"stub-{uuid.uuid4().hex}"
        self.system_message = system_message

    def with_model(self, *args: Any, **kwargs: Any) -> "LlmChat":
        return self

    async def send_message(self, user_message: UserMessage) -> str:
        # Simulate a short async call and return an empty JSON object which
        # the server's JSON parsing helpers will accept as valid but empty.
        await asyncio.sleep(0.05)
        return "{}"

