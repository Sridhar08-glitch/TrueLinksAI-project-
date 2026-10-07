"""Tests for AI_PROVIDER=openai — any OpenAI-compatible API behind the same
interfaces, prompts, and safety behavior as the Ollama providers."""
import json

import pytest

from apps.common import openai_compat

pytestmark = pytest.mark.django_db


def _patch_chat(monkeypatch, reply: str):
    calls = {}

    def fake_chat(prompt, **kwargs):
        calls['prompt'] = prompt
        calls['kwargs'] = kwargs
        return reply

    monkeypatch.setattr(openai_compat, 'chat', fake_chat)
    return calls


# ── Factory selection ────────────────────────────────────────────────────────

def test_factories_select_openai_providers(settings):
    settings.AI_PROVIDER = 'openai'

    from apps.lease_agent.services.lease_extraction_service import _get_provider
    assert _get_provider('openai').PROVIDER_NAME == 'openai'

    from apps.inspections.services.inspection_analysis_service import _default_provider
    assert _default_provider().PROVIDER_NAME == 'openai_vision'

    from apps.validation.services.policy_import import get_policy_provider
    assert get_policy_provider().PROVIDER_NAME == 'openai'


# ── Lease extraction ─────────────────────────────────────────────────────────

def test_openai_lease_extraction_parses_and_backfills_provenance(monkeypatch):
    reply = json.dumps({
        'tenant_name': 'Amira Hassan',
        'landlord_name': 'Marina Crest Holdings W.L.L.',
        'unit_id': 'MC-B-1204',
        'start_date': '2026-11-01',
        'end_date': '2027-10-31',
        'rent_amount': 7500,
        'currency': 'QAR',
        'rent_frequency': 'monthly',
        'deposit_amount': 7500,
        'annual_rent': 90000,
        'escalation_clause': None,
        'renewal_terms': None,
        'termination_terms': None,
        'landlord_signed': False,
        'tenant_signed': False,
        'additional_clauses': [],
    })
    calls = _patch_chat(monkeypatch, reply)

    from apps.lease_agent.services.providers.openai_provider import OpenAILeaseExtractionProvider
    pages = [{'page_number': 1,
              'text': 'Tenant: Amira Hassan. Monthly Rent: QAR 7,500 commencing 1 November 2026.'}]
    result = OpenAILeaseExtractionProvider().extract('doc text', pages)

    fields = {f.field_name: f for f in result.fields}
    assert fields['tenant_name'].normalized_value == 'Amira Hassan'
    # Provenance backfill works identically to the Ollama provider:
    assert fields['rent_amount'].source_page == 1
    assert fields['start_date'].source_page == 1
    assert calls['kwargs'].get('json_mode') is True


def test_openai_lease_extraction_rejects_invalid_json(monkeypatch):
    _patch_chat(monkeypatch, 'sorry, I cannot do that')
    from apps.lease_agent.services.providers.openai_provider import OpenAILeaseExtractionProvider
    with pytest.raises(ValueError):
        OpenAILeaseExtractionProvider().extract('doc', [])


# ── Vision ───────────────────────────────────────────────────────────────────

def test_openai_vision_parses_findings(monkeypatch, tmp_path):
    reply = json.dumps([{
        'category': 'damage', 'equipment_name': 'Bathroom Wall',
        'condition': 'poor', 'damage_description': 'Visible water staining',
        'confidence': 0.8, 'evidence': 'Brown patch near ceiling',
    }, {
        'category': 'general', 'equipment_name': 'Floor',
        'condition': 'good', 'damage_description': '',
        'confidence': 0.3, 'evidence': 'low-confidence noise',
    }])
    calls = _patch_chat(monkeypatch, reply)

    image = tmp_path / 'photo.jpg'
    image.write_bytes(b'\xff\xd8\xff\xe0 not a real jpeg')

    from apps.inspections.services.openai_vision_provider import OpenAIVisionProvider
    findings = OpenAIVisionProvider().analyze(1, str(image))

    # Confidence floor applies exactly as in the Ollama provider.
    assert len(findings) == 1
    assert findings[0].equipment_name == 'Bathroom Wall'
    assert calls['kwargs'].get('vision') is True
    assert calls['kwargs'].get('images_b64')


# ── Rules Agent ──────────────────────────────────────────────────────────────

def test_openai_policy_provider_feeds_the_same_sanitizer(monkeypatch):
    reply = json.dumps({'proposals': [{
        'proposal_type': 'rule_update', 'target_rule_id': 'R1',
        'config_changes': {'min_deposit_months': 2},
        'description': 'Deposit must be two months.', 'severity': 'high',
        'source_quote': 'The deposit must be two months of rent.',
    }, {
        'proposal_type': 'custom_rule', 'template': 'exec',
        'field_name': '__import__("os")',
        'description': 'malicious', 'source_quote': 'evil',
    }]})
    _patch_chat(monkeypatch, reply)

    from apps.validation.services.policy_import import OpenAIPolicyProvider, sanitize_proposals
    raws = OpenAIPolicyProvider().extract('policy text', [{'page_number': 1, 'text': 'policy text'}])
    cleans = sanitize_proposals(raws)

    update = next(c for c in cleans if c['proposal_type'] == 'rule_update')
    assert update['config_changes'] == {'min_deposit_months': 2}
    # The whitelist applies regardless of which API produced the output.
    demoted = next(c for c in cleans if c.get('template') == 'manual_check')
    assert demoted['description'] == 'malicious'
