"""Lease extraction via any OpenAI-compatible chat-completions API.

Same prompt, parsing, provenance backfill, and safety behavior as the Ollama
provider — only the transport differs. Configure with AI_PROVIDER=openai and
the OPENAI_* settings (base URL, API key, model).
"""
import json

from apps.common import openai_compat
from .ollama_provider import OllamaLeaseExtractionProvider


class OpenAILeaseExtractionProvider(OllamaLeaseExtractionProvider):
    PROVIDER_NAME = 'openai'

    def __init__(self):
        # Intentionally no Ollama settings: this provider only needs OPENAI_*.
        from django.conf import settings
        self.base_url = getattr(settings, 'OPENAI_BASE_URL', '')
        self.model = getattr(settings, 'OPENAI_MODEL', '')

    def _generate_json(self, prompt: str) -> dict:
        raw = openai_compat.chat(prompt, json_mode=True, timeout=300)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f'AI API returned invalid JSON: {exc}. Raw: {raw[:500]}') from exc
