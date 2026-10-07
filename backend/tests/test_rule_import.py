"""Tests for the rules import feature: new templates, ruleset JSON import,
and the policy-document Rules Agent (extract → sanitize → review → apply)."""
import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.lease_agent.services import ruleset_store
from apps.lease_agent.services.custom_rule_engine import evaluate_custom_rules
from apps.validation.models import CustomRule, RuleProposal
from apps.validation.services.policy_import import (
    MockPolicyProvider, sanitize_proposal, sanitize_proposals,
)

pytestmark = pytest.mark.django_db

TEST_RULESET = {
    'ruleset_name': 'Test Standards',
    'version': '1.0',
    'rules': [
        {'id': 'R1', 'description': 'Deposit at least one month.', 'check': 'deposit >= rent * n',
         'severity': 'high', 'enabled': True, 'config': {'min_deposit_months': 1}},
        {'id': 'R3', 'description': 'Term limit.', 'check': 'term <= n',
         'severity': 'medium', 'enabled': True, 'config': {'max_term_months': 36}},
    ],
}


@pytest.fixture
def ruleset_file(tmp_path, settings):
    settings.SAMPLE_DATA_DIR = str(tmp_path)
    path = tmp_path / 'owner_ruleset.json'
    path.write_text(json.dumps(TEST_RULESET), encoding='utf-8')
    return path


# ── New custom-rule templates ────────────────────────────────────────────────

def _result_for(rule, fields):
    return next(r for r in evaluate_custom_rules(fields) if r.rule_id == rule.rule_id)


def test_term_length_template():
    rule = CustomRule.objects.create(
        description='Term must be at most 24 months',
        template='term_length', field_name='start_date',
        operator='lte', number_value=24,
    )
    # 12-month lease (counts the partial final month as a full month)
    ok = {'start_date': '2026-11-01', 'end_date': '2027-10-31'}
    assert _result_for(rule, ok).result == 'PASS'
    # 36-month lease
    long = {'start_date': '2026-01-01', 'end_date': '2029-01-01'}
    assert _result_for(rule, long).result == 'FAIL'
    assert _result_for(rule, {'start_date': '2026-01-01'}).result == 'UNDETERMINED'


def test_allowed_values_template():
    rule = CustomRule.objects.create(
        description='Currency must be QAR or USD',
        template='allowed_values', field_name='currency', text_value='QAR, USD',
    )
    assert _result_for(rule, {'currency': 'qar'}).result == 'PASS'
    assert _result_for(rule, {'currency': 'EUR'}).result == 'FAIL'
    assert _result_for(rule, {}).result == 'UNDETERMINED'


# ── Ruleset JSON import ──────────────────────────────────────────────────────

def test_import_ruleset_applies_known_and_reports_unknown(ruleset_file):
    report = ruleset_store.import_ruleset({
        'rules': [
            {'id': 'R1', 'severity': 'medium', 'config': {'min_deposit_months': 2}},
            {'id': 'R99', 'description': 'A rule we do not have logic for.'},
        ],
    })
    assert report['applied'] == ['R1']
    assert report['skipped'][0]['id'] == 'R99'

    saved = json.loads(ruleset_file.read_text(encoding='utf-8'))
    r1 = next(r for r in saved['rules'] if r['id'] == 'R1')
    assert r1['config']['min_deposit_months'] == 2
    assert r1['severity'] == 'medium'


def test_import_ruleset_rejects_bad_values_without_breaking_others(ruleset_file):
    report = ruleset_store.import_ruleset({
        'rules': [
            {'id': 'R1', 'severity': 'catastrophic'},
            {'id': 'R3', 'config': {'max_term_months': 24}},
        ],
    })
    assert report['applied'] == ['R3']
    assert 'severity' in report['skipped'][0]['reason']


def test_import_ruleset_requires_rules_list(ruleset_file):
    with pytest.raises(ruleset_store.RulesetError):
        ruleset_store.import_ruleset({'not_rules': []})


# ── Mock policy provider: statements → safe proposals ────────────────────────

POLICY_TEXT = (
    'The security deposit must be at least two months of rent. '
    'The lease term shall not exceed 24 months. '
    'The lease term must be at least 12 months. '
    'Monthly rent must be at least QAR 4,000. '
    'The annual rent must be at most QAR 300,000. '
    'Rent frequency must be monthly. '
    'All rents shall be payable in QAR. '
    'Termination terms must be present in the lease. '
    'Renewal terms must mention written notice. '
    'The tenant must provide a no-objection certificate from their employer.'
)


def test_mock_provider_maps_policy_statements():
    proposals = MockPolicyProvider().extract(
        POLICY_TEXT, [{'page_number': 1, 'text': POLICY_TEXT}]
    )
    updates = [p for p in proposals if p['proposal_type'] == 'rule_update']
    customs = [p for p in proposals if p['proposal_type'] == 'custom_rule']

    deposit = next(p for p in updates if p['target_rule_id'] == 'R1')
    assert deposit['config_changes'] == {'min_deposit_months': 2}
    term = next(p for p in updates if p['target_rule_id'] == 'R3')
    assert term['config_changes'] == {'max_term_months': 24}

    def by(**kw):
        return next(p for p in customs if all(p.get(k) == v for k, v in kw.items()))

    assert by(template='term_length')['number_value'] == 12
    assert by(template='number_compare', field_name='rent_amount')['number_value'] == 4000
    annual = by(template='number_compare', field_name='annual_rent')
    assert annual['operator'] == 'lte' and annual['number_value'] == 300000
    assert by(template='allowed_values', field_name='rent_frequency')['text_value'] == 'monthly'
    assert by(template='allowed_values', field_name='currency')['text_value'] == 'QAR'
    assert by(template='required_field')['field_name'] == 'termination_terms'
    mention = by(template='text_check', field_name='renewal_terms')
    assert mention['operator'] == 'must_contain' and 'notice' in mention['text_value']

    # The no-objection requirement fits no automated template — it becomes a
    # manual-check rule (human verifies per lease), never "lost".
    manual = by(template='manual_check')
    assert 'no-objection' in manual['description']
    # Every proposal carries its evidence.
    assert all(p['source_quote'] for p in proposals)


def test_sanitize_demotes_anything_outside_the_whitelist():
    # Demotions become manual-check rules: nothing executable survives, but
    # the statement stays visible and enforceable via human verification.
    evil = sanitize_proposal({
        'proposal_type': 'custom_rule', 'template': 'exec',
        'field_name': '__import__("os")', 'operator': 'gte',
        'description': 'malicious', 'severity': 'high',
    })
    assert evil['template'] == 'manual_check'
    assert evil['field_name'] == '' and evil['operator'] == ''

    bad_target = sanitize_proposal({
        'proposal_type': 'rule_update', 'target_rule_id': 'R5',
        'config_changes': {'anything': 1}, 'description': 'R5 has no thresholds',
    })
    assert bad_target['template'] == 'manual_check'

    bad_key = sanitize_proposal({
        'proposal_type': 'rule_update', 'target_rule_id': 'R1',
        'config_changes': {'not_a_threshold': 5}, 'description': 'unknown key',
    })
    assert bad_key['template'] == 'manual_check'


def test_sanitize_coerces_sloppy_model_numbers():
    # Small local models return "2 months" or "QAR 3,500" instead of numbers.
    update = sanitize_proposal({
        'proposal_type': 'rule_update', 'target_rule_id': 'R1',
        'config_changes': {'min_deposit_months': '2 months'},
        'description': 'deposit', 'severity': 'high',
    })
    assert update['proposal_type'] == 'rule_update'
    assert update['config_changes'] == {'min_deposit_months': 2}

    custom = sanitize_proposal({
        'proposal_type': 'custom_rule', 'template': 'number_compare',
        'field_name': 'rent_amount', 'operator': 'gte',
        'number_value': 'QAR 3,500', 'description': 'min rent',
    })
    assert custom['proposal_type'] == 'custom_rule'
    assert custom['number_value'] == 3500

    worded = sanitize_proposal({
        'proposal_type': 'rule_update', 'target_rule_id': 'R1',
        'config_changes': {'min_deposit_months': 'two'},
        'description': 'deposit in words',
    })
    assert worded['config_changes'] == {'min_deposit_months': 2}


def test_sanitize_recovers_malformed_target_and_dedupes():
    # llama3.2 has been seen copying the prompt placeholder "R1|R3|R6" as the
    # target and attaching the same merged config to every sentence.
    merged = {
        'proposal_type': 'rule_update', 'target_rule_id': 'R1|R3|R6',
        'config_changes': {'min_deposit_months': 2, 'max_term_months': 24, 'tolerance_pct': 0},
        'description': 'The security deposit must be at least two months of rent.',
        'source_quote': 'The security deposit must be at least two months of rent.',
    }
    result = sanitize_proposals([merged, {**merged, 'description': 'Term sentence'}])
    updates = [p for p in result if p['proposal_type'] == 'rule_update']
    # Split per key (tolerance_pct=0 dropped), duplicates across sentences collapsed.
    assert {p['target_rule_id'] for p in updates} == {'R1', 'R3'}
    assert len(updates) == 2
    r1 = next(p for p in updates if p['target_rule_id'] == 'R1')
    assert r1['config_changes'] == {'min_deposit_months': 2}


# ── End-to-end API flow ──────────────────────────────────────────────────────

def _upload_policy(client):
    file = SimpleUploadedFile('policy.txt', POLICY_TEXT.encode('utf-8'), content_type='text/plain')
    return client.post('/api/v1/rule-proposals/upload/', {'document': file}, format='multipart')


def test_policy_upload_creates_pending_proposals(auth_client, ruleset_file, settings):
    settings.AI_PROVIDER = 'mock'
    response = _upload_policy(auth_client)
    assert response.status_code == 201
    assert len(response.data) >= 5
    assert all(p['status'] == 'pending' for p in response.data)


def test_approve_custom_rule_proposal_creates_rule(auth_client, ruleset_file, settings):
    settings.AI_PROVIDER = 'mock'
    _upload_policy(auth_client)
    proposal = RuleProposal.objects.filter(
        proposal_type='custom_rule', field_name='rent_amount'
    ).first()
    response = auth_client.post(f'/api/v1/rule-proposals/{proposal.id}/approve/')
    assert response.status_code == 200
    proposal.refresh_from_db()
    assert proposal.status == 'approved'
    assert proposal.created_rule is not None
    assert proposal.created_rule.number_value == 4000

    # The created rule evaluates like any other custom rule.
    result = _result_for(proposal.created_rule, {'rent_amount': '3000'})
    assert result.result == 'FAIL'


def test_approve_rule_update_proposal_changes_ruleset(auth_client, ruleset_file, settings):
    settings.AI_PROVIDER = 'mock'
    _upload_policy(auth_client)
    proposal = RuleProposal.objects.filter(
        proposal_type='rule_update', target_rule_id='R1'
    ).first()
    response = auth_client.post(f'/api/v1/rule-proposals/{proposal.id}/approve/')
    assert response.status_code == 200

    saved = json.loads(ruleset_file.read_text(encoding='utf-8'))
    r1 = next(r for r in saved['rules'] if r['id'] == 'R1')
    assert r1['config']['min_deposit_months'] == 2


def test_manual_check_proposal_approves_into_undetermined_rule(auth_client, ruleset_file, settings):
    settings.AI_PROVIDER = 'mock'
    _upload_policy(auth_client)
    proposal = RuleProposal.objects.filter(template='manual_check').first()
    assert proposal is not None, 'the no-objection statement should become a manual-check proposal'
    response = auth_client.post(f'/api/v1/rule-proposals/{proposal.id}/approve/')
    assert response.status_code == 200
    proposal.refresh_from_db()
    assert proposal.created_rule is not None

    # The rule lands on every lease's scorecard as UNDETERMINED for a human.
    result = _result_for(proposal.created_rule, {'rent_amount': '5000'})
    assert result.result == 'UNDETERMINED'
    assert 'manual verification' in result.reason.lower()


def test_sentence_the_model_failed_to_map_gets_regex_upgraded():
    # Simulates llama3.2 giving up on a clearly mappable statement: the
    # sanitizer retries the source sentence against the pattern matcher.
    upgraded = sanitize_proposals([{
        'proposal_type': 'needs_developer',
        'description': 'Monthly rent must be at least QAR 3,500.',
        'source_quote': 'Monthly rent must be at least QAR 3,500.',
    }])
    assert len(upgraded) == 1
    assert upgraded[0]['template'] == 'number_compare'
    assert upgraded[0]['field_name'] == 'rent_amount'
    assert upgraded[0]['number_value'] == 3500


def test_manual_check_quotes_supporting_document_text():
    rule = CustomRule.objects.create(
        description="Pets are not permitted without the owner's prior written approval.",
        template='manual_check',
    )
    doc = ('LEASE AGREEMENT ... PETS: Pets are not permitted in the leased '
           'premises without prior approval. Any approved pet must be registered.')
    with_evidence = _result_for(rule, {'_document_text': doc})
    assert with_evidence.result == 'UNDETERMINED'
    assert 'possibly relevant text' in with_evidence.reason
    assert 'Pets are not permitted in the leased' in with_evidence.reason

    without = _result_for(rule, {'_document_text': 'No animals section here at all.'})
    assert without.result == 'UNDETERMINED'
    assert 'No related wording' in without.reason


def test_legacy_needs_developer_proposal_cannot_be_approved(auth_client, ruleset_file):
    proposal = RuleProposal.objects.create(
        source_filename='old.pdf', proposal_type='needs_developer',
        description='Legacy unmappable statement',
    )
    response = auth_client.post(f'/api/v1/rule-proposals/{proposal.id}/approve/')
    assert response.status_code == 400


def test_reject_proposal_records_reason(auth_client, ruleset_file, settings):
    settings.AI_PROVIDER = 'mock'
    _upload_policy(auth_client)
    proposal = RuleProposal.objects.filter(status='pending').first()
    response = auth_client.post(
        f'/api/v1/rule-proposals/{proposal.id}/reject/', {'reason': 'Not our policy.'}
    )
    assert response.status_code == 200
    proposal.refresh_from_db()
    assert proposal.status == 'rejected'
    assert proposal.decision_reason == 'Not our policy.'


def test_tenant_cannot_upload_policy(tenant_client, ruleset_file):
    response = _upload_policy(tenant_client)
    assert response.status_code == 403


def test_ruleset_json_import_endpoint(auth_client, ruleset_file):
    payload = json.dumps({
        'rules': [
            {'id': 'R3', 'config': {'max_term_months': 12}},
            {'id': 'R42', 'description': 'unknown'},
        ],
    })
    file = SimpleUploadedFile('ruleset.json', payload.encode('utf-8'), content_type='application/json')
    response = auth_client.post('/api/v1/lease-rules/import/', {'file': file}, format='multipart')
    assert response.status_code == 200
    assert response.data['applied'] == ['R3']
    assert response.data['skipped'][0]['id'] == 'R42'
