"""
Ollama local AI provider for lease extraction.
Requires Ollama running locally with a model that supports JSON mode (e.g., llama3.2, mistral).
Configure: AI_PROVIDER=ollama, OLLAMA_BASE_URL=http://localhost:11434, OLLAMA_MODEL=llama3.2
"""
import json
import urllib.request
import urllib.error
from django.conf import settings
from .base import LeaseExtractionProvider, ExtractionResult, ExtractedField


EXTRACTION_PROMPT = """You are a lease document analysis assistant. Analyze the following lease document text and extract structured information.

Return ONLY a valid JSON object with these exact keys. Use null for any field you cannot find.

{
  "tenant_name": "full legal name of tenant/lessee or null",
  "landlord_name": "full legal name of landlord/lessor or null",
  "unit_id": "unit identifier (look for patterns like MC-A-0301 or apartment numbers) or null",
  "start_date": "ISO date YYYY-MM-DD or null",
  "end_date": "ISO date YYYY-MM-DD or null",
  "rent_amount": 0,
  "currency": "3-letter currency code like QAR, USD, EUR or null",
  "rent_frequency": "monthly or quarterly or annually or null",
  "deposit_amount": 0,
  "annual_rent": 0,
  "escalation_clause": "exact text of escalation/rent increase clause or null",
  "renewal_terms": "exact text of renewal clause or null",
  "termination_terms": "exact text of termination clause or null",
  "landlord_signed": false,
  "tenant_signed": false,
  "additional_clauses": []
}

CRITICAL RULES:
- Never invent values. If a field is not in the document, use null.
- Use only information explicitly stated in the document.
- For dates, convert to ISO format YYYY-MM-DD.
- For numeric fields (rent_amount, deposit_amount, annual_rent), return numbers not strings.
- additional_clauses should be a list of objects, each with: clause_type, title, raw_text, interpretation, is_unusual (bool), unusual_reason (string), confidence (0.0-1.0).
- Mark is_unusual=true for any clause that seems non-standard, one-sided, or risky.
- You MUST extract ALL available fields. Do not stop after finding one value.

DOCUMENT TEXT:
"""


class OllamaLeaseExtractionProvider(LeaseExtractionProvider):
    PROVIDER_NAME = 'ollama'

    def __init__(self):
        self.base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://localhost:11434')
        self.model = getattr(settings, 'OLLAMA_MODEL', 'llama3.2')

    def extract(self, document_text: str, pages: list[dict]) -> ExtractionResult:
        # Truncate very long documents — keep more text for better extraction coverage
        truncated_text = document_text[:20000] if len(document_text) > 20000 else document_text
        extracted = self._generate_json(EXTRACTION_PROMPT + truncated_text)
        return self._build_result(extracted, pages)

    def _generate_json(self, prompt: str) -> dict:
        """Transport: send the prompt, return the parsed JSON object.
        Subclasses override this to target a different API with the same
        prompt and result handling."""
        payload = json.dumps({
            'model': self.model,
            'prompt': prompt,
            'stream': False,
            'format': 'json',
            'options': {'temperature': 0.0},
        }).encode('utf-8')

        req = urllib.request.Request(
            f'{self.base_url}/api/generate',
            data=payload,
            headers={'Content-Type': 'application/json'},
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                response_data = json.loads(resp.read().decode('utf-8'))
        except urllib.error.URLError as exc:
            raise ConnectionError(
                f'Ollama not reachable at {self.base_url}. '
                f'Ensure Ollama is running: ollama serve. Error: {exc}'
            ) from exc

        raw_text = response_data.get('response', '{}')
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f'Ollama returned invalid JSON: {exc}. Raw: {raw_text[:500]}') from exc

    # Metadata for extracted fields — same labels/types/categories as the mock provider
    # so downstream storage and the review UI behave identically for both providers.
    FIELD_META = {
        'tenant_name': ('Tenant Name', 'text', 'parties'),
        'landlord_name': ('Landlord Name', 'text', 'parties'),
        'unit_id': ('Unit Reference', 'text', 'parties'),
        'start_date': ('Commencement Date', 'date', 'dates'),
        'end_date': ('Expiry Date', 'date', 'dates'),
        'rent_amount': ('Monthly Rent', 'amount', 'financial'),
        'currency': ('Currency', 'text', 'financial'),
        'rent_frequency': ('Rent Frequency', 'text', 'financial'),
        'deposit_amount': ('Security Deposit', 'amount', 'financial'),
        'annual_rent': ('Annual Rent', 'amount', 'financial'),
        'escalation_clause': ('Escalation Clause', 'text', 'clauses'),
        'renewal_terms': ('Renewal Terms', 'text', 'clauses'),
        'termination_terms': ('Termination Terms', 'text', 'clauses'),
        'landlord_signed': ('Landlord Signed', 'boolean', 'parties'),
        'tenant_signed': ('Tenant Signed', 'boolean', 'parties'),
    }

    AMOUNT_FIELDS = ('rent_amount', 'deposit_amount', 'annual_rent')

    def _build_result(self, extracted: dict, pages: list[dict]) -> ExtractionResult:
        CORE_FIELDS = list(self.FIELD_META.keys())

        fields = []
        for field_name in CORE_FIELDS:
            value = extracted.get(field_name)

            # The prompt template defaults numeric fields to 0 — a zero (or empty)
            # amount means "not found", never a confident extraction of 0.
            if field_name in self.AMOUNT_FIELDS:
                try:
                    if value is None or str(value).strip() == '' or float(value) == 0:
                        value = None
                except (TypeError, ValueError):
                    value = None
            elif isinstance(value, str) and not value.strip():
                value = None

            raw = str(value) if value is not None else 'NOT_FOUND'
            normalized = value

            # Normalize date strings
            if field_name in ('start_date', 'end_date') and isinstance(value, str):
                normalized = value  # Already requested in ISO format

            # Find source page: amounts and dates rarely appear verbatim
            # (7500.0 vs "QAR 7,500", 2026-11-01 vs "1 November 2026"), so
            # search for their common written variants instead.
            source_page = None
            source_text = ''
            if value is not None:
                if field_name in self.AMOUNT_FIELDS:
                    source_page, source_text = self._locate(self._amount_variants(value), pages)
                elif field_name in ('start_date', 'end_date'):
                    source_page, source_text = self._locate(self._date_variants(str(value)), pages)
                elif isinstance(value, str) and len(value) >= 3:
                    source_page, source_text = self._find_source(value, pages)

            display_label, data_type, category = self.FIELD_META[field_name]
            fields.append(ExtractedField(
                field_name=field_name,
                raw_value=raw,
                normalized_value=normalized,
                confidence=0.85 if value is not None else 0.0,
                source_page=source_page,
                source_text=source_text,
                display_label=display_label,
                data_type=data_type,
                category=category,
                extraction_method='ai_structured',
            ))

        # Dynamic additional clauses are returned separately for the extraction service
        additional_clauses = extracted.get('additional_clauses', [])

        raw_output = {
            'provider': self.PROVIDER_NAME,
            'model': self.model,
            'note': 'Ollama local AI extraction. Values are AI-generated and require human review.',
            'additional_clauses': additional_clauses,
            'raw_extracted': {k: v for k, v in extracted.items() if k != 'additional_clauses'},
        }

        result = ExtractionResult(
            fields=fields,
            provider_name=self.PROVIDER_NAME,
            raw_output=raw_output,
        )
        return result

    def _find_source(self, value: str, pages: list[dict]) -> tuple:
        """Try to find the value text in document pages. Returns (page_number, context)."""
        search_text = str(value)[:50]
        return self._locate([search_text], pages)

    def _locate(self, candidates: list[str], pages: list[dict]) -> tuple:
        """Find the first candidate string present in any page. Returns (page_number, context)."""
        for page in pages:
            text_lower = page['text'].lower()
            for candidate in candidates:
                idx = text_lower.find(candidate.lower())
                if idx != -1:
                    context = page['text'][max(0, idx - 40): idx + len(candidate) + 40]
                    return page['page_number'], context.strip()
        return None, ''

    def _amount_variants(self, value) -> list[str]:
        """Written forms an amount may take in a lease: 7,500 / 7500 / 7,500.00 / 7500.00."""
        try:
            num = float(value)
        except (TypeError, ValueError):
            return []
        if num == int(num):
            whole = int(num)
            return [f'{whole:,}', f'{whole:,}.00', str(whole), f'{whole}.00']
        return [f'{num:,.2f}', f'{num:.2f}', str(num)]

    def _date_variants(self, iso_date: str) -> list[str]:
        """Written forms an ISO date may take in a lease: 1 November 2026, November 1, 2026, 01/11/2026…"""
        from datetime import datetime
        try:
            d = datetime.strptime(iso_date[:10], '%Y-%m-%d')
        except ValueError:
            return [iso_date]
        month = d.strftime('%B')
        return [
            iso_date[:10],
            f'{d.day} {month} {d.year}',
            f'{d.day:02d} {month} {d.year}',
            f'{month} {d.day}, {d.year}',
            f'{month} {d.day:02d}, {d.year}',
            f'{d.day:02d}/{d.month:02d}/{d.year}',
            f'{d.day:02d}-{d.month:02d}-{d.year}',
        ]
