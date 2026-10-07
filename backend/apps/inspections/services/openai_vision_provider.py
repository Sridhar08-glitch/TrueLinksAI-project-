"""Inspection photo analysis via any OpenAI-compatible chat-completions API.

Same prompt, JSON tolerance, confidence bounds, and finding parsing as the
Ollama vision provider — only the transport differs. Needs a vision-capable
model (OPENAI_VISION_MODEL, falling back to OPENAI_MODEL).
"""
import logging

from apps.common import openai_compat
from .ollama_vision_provider import OllamaVisionProvider

logger = logging.getLogger(__name__)


class OpenAIVisionProvider(OllamaVisionProvider):
    PROVIDER_NAME = 'openai_vision'

    def __init__(self):
        from django.conf import settings
        self.base_url = getattr(settings, 'OPENAI_BASE_URL', '')
        self.model = (getattr(settings, 'OPENAI_VISION_MODEL', '')
                      or getattr(settings, 'OPENAI_MODEL', ''))
        self.timeout = 300

    def _generate(self, image_b64: str) -> str:
        from .ollama_vision_provider import PROMPT
        return openai_compat.chat(
            PROMPT, images_b64=[image_b64], vision=True, timeout=self.timeout,
        )
