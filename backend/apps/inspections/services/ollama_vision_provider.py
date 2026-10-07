import base64
import json
import logging
import os
import re
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Optional

from .mock_vision_provider import VisionFinding

logger = logging.getLogger(__name__)

PROMPT = """You are an expert property inspector reviewing a photo taken inside a residential unit.

Carefully look for any of the following issues:
- Water damage, staining, mold, or damp patches
- Cracks in walls, ceilings, or floors
- Broken, damaged, or worn fixtures (taps, handles, lights, switches)
- Damaged or deteriorating surfaces (paint peeling, rust, scratches)
- Appliance or equipment issues (HVAC, hot water, kitchen appliances)
- Structural concerns (sagging, misalignment, gaps)
- General maintenance needs

Reply with ONLY a valid JSON array. Do not include any explanation or text outside the JSON.

Format:
[
  {
    "category": "damage|equipment|fixture|general",
    "equipment_name": "Specific item or area (e.g. 'Bathroom Wall', 'Kitchen Ceiling', 'Door Handle')",
    "condition": "good|fair|poor|critical",
    "damage_description": "Precise description of what is wrong",
    "confidence": 0.75,
    "evidence": "What specifically in the image shows this"
  }
]

Rules:
- Only include findings with confidence >= 0.55
- If nothing is wrong, return exactly: []
- Confidence should reflect how clearly visible the issue is"""


class OllamaVisionProvider:
    PROVIDER_NAME = 'ollama_vision'

    def __init__(self):
        from django.conf import settings
        self.base_url = str(getattr(settings, 'OLLAMA_BASE_URL', 'http://localhost:11434')).rstrip('/')
        self.model = getattr(settings, 'OLLAMA_VISION_MODEL', 'llava:7b')
        self.timeout = int(os.environ.get('OLLAMA_VISION_TIMEOUT', '120'))

    def _image_to_base64(self, image_path: str) -> str:
        with open(image_path, 'rb') as f:
            return base64.b64encode(f.read()).decode('utf-8')

    def _extract_json(self, text: str) -> list:
        """Extract JSON array from model response, tolerating surrounding text."""
        text = text.strip()

        # Try direct parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Find first [...] block
        match = re.search(r'\[.*?\]', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        # Model said "no issues" in plain text
        lower = text.lower()
        if any(phrase in lower for phrase in ['no issues', 'nothing wrong', 'no problems', 'no damage', '[]']):
            return []

        logger.warning("Ollama vision: could not parse JSON from response: %s", text[:200])
        return []

    def _generate(self, image_b64: str) -> str:
        """Transport: send the prompt + image, return the raw reply text.
        Subclasses override this to target a different API with the same
        prompt and finding parsing."""
        payload = json.dumps({
            'model': self.model,
            'prompt': PROMPT,
            'images': [image_b64],
            'stream': False,
        }).encode('utf-8')

        req = urllib.request.Request(
            f'{self.base_url}/api/generate',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode('utf-8'))
        except urllib.error.URLError as exc:
            logger.error("Ollama vision: connection error: %s", exc)
            raise RuntimeError(f"Ollama not reachable at {self.base_url}: {exc}") from exc
        except Exception as exc:
            logger.error("Ollama vision: request failed: %s", exc)
            raise
        return body.get('response', '')

    def analyze(self, image_id: int, image_path: str) -> list[VisionFinding]:
        try:
            image_b64 = self._image_to_base64(image_path)
        except OSError as exc:
            logger.error("Ollama vision: could not read image %s: %s", image_path, exc)
            return []

        response_text = self._generate(image_b64)
        raw_findings = self._extract_json(response_text)

        findings = []
        for item in raw_findings:
            if not isinstance(item, dict):
                continue
            confidence = float(item.get('confidence', 0))
            if confidence < 0.55:
                continue
            findings.append(VisionFinding(
                category=str(item.get('category', 'general')),
                equipment_name=str(item.get('equipment_name', '')),
                condition=str(item.get('condition', 'fair')),
                damage_description=str(item.get('damage_description', '')),
                confidence=min(1.0, max(0.0, confidence)),
                evidence=str(item.get('evidence', '')),
                image_id=image_id,
            ))

        logger.info("Ollama vision: %d findings for image_id=%d", len(findings), image_id)
        return findings
