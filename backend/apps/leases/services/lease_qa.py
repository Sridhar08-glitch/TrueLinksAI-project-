"""
AI lease Q&A served by a local Ollama model.

The model receives the complete lease record — the verified/structured data
(fields with review status, rule results, flags, clauses, unit, payment
summary) plus the raw document text — so any question about the lease can be
answered, with the structured record taking precedence for facts and numbers.
"""
import json
import urllib.error
import urllib.request

from django.conf import settings

OLLAMA_TIMEOUT_SECONDS = 120

QA_PROMPT_TEMPLATE = """You are a lease assistant for a property owner. Answer the user's question using ONLY the lease record and document below.

RULES:
- The LEASE RECORD sections contain verified, structured data extracted from the document — prefer them for names, numbers, dates, rule results, and statuses.
- The EXTRACTED CLAUSES list is a reliable index of the document's clauses — check it before saying something is missing.
- The FULL DOCUMENT TEXT is the original source — quote from it to support answers about wording.
- Never invent or assume anything that is not in the material below.
- If the question truly cannot be answered from the material, reply exactly: "Not specified in the lease."
- Keep the answer concise and factual.

{context}

QUESTION: {question}

ANSWER:"""


def _ollama_generate(prompt: str) -> dict:
    """POST to Ollama /api/generate. Raises ConnectionError when unreachable."""
    base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://localhost:11434')
    model = getattr(settings, 'OLLAMA_MODEL', 'llama3.2')
    payload = json.dumps({
        'model': model,
        'prompt': prompt,
        'stream': False,
        # The full-record context is bigger than Ollama's 4096-token default.
        'options': {'temperature': 0.0, 'num_ctx': 8192},
    }).encode('utf-8')
    req = urllib.request.Request(
        f'{base_url}/api/generate',
        data=payload,
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT_SECONDS) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ConnectionError(
            f'Ollama not reachable at {base_url}. Ensure Ollama is running: ollama serve. Error: {exc}'
        ) from exc


def _one_line(text, limit=300) -> str:
    return ' '.join(str(text or '').split())[:limit]


def build_lease_context(lease) -> str:
    """Assemble everything the system knows about this lease into one block."""
    parts = []

    unit = lease.unit
    unit_line = (
        f'{unit.external_unit_id} ({unit.label}, {unit.unit_type}, '
        f'{unit.area_sqm} sqm) — occupancy: {unit.occupancy_status}'
    ) if unit else (lease.extracted_unit_id or 'not matched to a unit')
    parts.append('LEASE RECORD — SUMMARY:\n' + '\n'.join([
        f'- Tenant: {lease.tenant_name or "unknown"}',
        f'- Landlord: {lease.landlord_name or "unknown"}',
        f'- Unit: {unit_line}',
        f'- Term: {lease.start_date or "?"} to {lease.end_date or "?"}',
        f'- Rent: {lease.rent_amount or "?"} {lease.currency} {lease.rent_frequency}'
        f' | Annual: {lease.annual_rent or "?"} | Deposit: {lease.deposit_amount or "?"}',
        f'- Processing status: {lease.processing_status}'
        f' | Approval status: {lease.approval_status}',
    ]))

    fields = list(lease.fields.all())
    if fields:
        parts.append('LEASE RECORD — EXTRACTED FIELDS (value | review status):\n' + '\n'.join(
            f'- {f.display_label or f.field_name}: {_one_line(f.normalized_value or f.extracted_value, 200)}'
            f' | {f.review_status}'
            for f in fields
        ))

    validations = list(lease.validations.all().order_by('rule_id'))
    if validations:
        lines = []
        for v in validations:
            line = f'- {v.rule_id} ({v.severity}): {v.result} — {_one_line(v.reason, 220)}'
            if v.is_overridden:
                line += f' [OVERRIDDEN by {v.overridden_by}: {_one_line(v.override_reason, 120)}]'
            lines.append(line)
        parts.append('LEASE RECORD — RULE VALIDATION RESULTS:\n' + '\n'.join(lines))

    flags = list(lease.flags.all())
    if flags:
        parts.append('LEASE RECORD — FLAGS:\n' + '\n'.join(
            f'- [{f.severity}] ({f.status}) {_one_line(f.description, 200)}'
            for f in flags
        ))

    clauses = list(lease.clauses.all()[:30])
    parts.append('EXTRACTED CLAUSES:\n' + ('\n'.join(
        f'- {c.title or c.clause_type}: {_one_line(c.raw_text, 300)}'
        for c in clauses
    ) or '(none extracted)'))

    parts.append('FULL DOCUMENT TEXT:\n' + (lease.extracted_text or '(no text)')[:12000])
    return '\n\n'.join(parts)


def ask_lease_question(lease, question: str) -> dict:
    """Return {'answer': str, 'model': str}. Raises ConnectionError on AI failure."""
    prompt = QA_PROMPT_TEMPLATE.format(
        context=build_lease_context(lease), question=question.strip(),
    )
    if getattr(settings, 'AI_PROVIDER', 'mock') == 'openai':
        from apps.common import openai_compat
        answer = openai_compat.chat(prompt, timeout=120).strip()
        return {
            'answer': answer or 'Not specified in the lease.',
            'model': getattr(settings, 'OPENAI_MODEL', ''),
        }
    data = _ollama_generate(prompt)
    answer = (data.get('response') or '').strip()
    return {
        'answer': answer or 'Not specified in the lease.',
        'model': data.get('model') or getattr(settings, 'OLLAMA_MODEL', 'llama3.2'),
    }
