"""Minimal client for any OpenAI-compatible chat-completions API.

Set AI_PROVIDER=openai and point OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL
(and OPENAI_VISION_MODEL for image analysis) at your service. Works with
OpenAI, Groq, Together, Azure OpenAI, and Ollama's own /v1 endpoint — anything
that speaks POST {base}/chat/completions.
"""
import json
import urllib.error
import urllib.request

from django.conf import settings


def chat(prompt: str, *, images_b64: list[str] | None = None,
         json_mode: bool = False, vision: bool = False, timeout: int = 300) -> str:
    """Send one user message (optionally with images) and return the reply text.

    Raises ConnectionError when the API is unreachable or rejects the request,
    and ValueError when the response body is not valid JSON.
    """
    base_url = str(getattr(settings, 'OPENAI_BASE_URL', 'https://api.openai.com/v1')).rstrip('/')
    api_key = getattr(settings, 'OPENAI_API_KEY', '')
    model = (getattr(settings, 'OPENAI_VISION_MODEL', '') if vision else '') \
        or getattr(settings, 'OPENAI_MODEL', 'gpt-4o-mini')

    if images_b64:
        content = [{'type': 'text', 'text': prompt}] + [
            {'type': 'image_url',
             'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}
            for b64 in images_b64
        ]
    else:
        content = prompt

    body = {
        'model': model,
        'messages': [{'role': 'user', 'content': content}],
        'temperature': 0,
    }
    if json_mode:
        body['response_format'] = {'type': 'json_object'}

    req = urllib.request.Request(
        f'{base_url}/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key or "none"}',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            detail = exc.read().decode('utf-8')[:300]
        except OSError:
            pass
        raise ConnectionError(
            f'AI API at {base_url} returned HTTP {exc.code}. {detail}'
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ConnectionError(f'AI API not reachable at {base_url}. Error: {exc}') from exc

    try:
        return data['choices'][0]['message']['content'] or ''
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(f'Unexpected response shape from AI API: {str(data)[:300]}') from exc
