import pytest

from apps.lease_agent.services.custom_rule_engine import evaluate_custom_rules
from apps.validation.models import CustomRule

pytestmark = pytest.mark.django_db


def _result_for(rule, fields):
    results = evaluate_custom_rules(fields)
    return next(r for r in results if r.rule_id == rule.rule_id)


def test_number_compare_pass_fail_undetermined():
    rule = CustomRule.objects.create(
        description='Rent must be at least 3000',
        template='number_compare', field_name='rent_amount',
        operator='gte', number_value=3000, severity='high',
    )
    assert _result_for(rule, {'rent_amount': '5000'}).result == 'PASS'
    assert _result_for(rule, {'rent_amount': '2000'}).result == 'FAIL'
    assert _result_for(rule, {}).result == 'UNDETERMINED'


def test_field_compare_with_factor():
    rule = CustomRule.objects.create(
        description='Deposit must be at least two months of rent',
        template='field_compare', field_name='deposit_amount',
        operator='gte', compare_field='rent_amount', factor=2.0,
    )
    assert _result_for(rule, {'deposit_amount': '10000', 'rent_amount': '5000'}).result == 'PASS'
    assert _result_for(rule, {'deposit_amount': '6000', 'rent_amount': '5000'}).result == 'FAIL'


def test_required_field():
    rule = CustomRule.objects.create(
        description='Landlord name is required',
        template='required_field', field_name='landlord_name',
    )
    assert _result_for(rule, {'landlord_name': 'Marina Crest'}).result == 'PASS'
    assert _result_for(rule, {'landlord_name': 'NOT_FOUND'}).result == 'FAIL'


def test_date_order():
    rule = CustomRule.objects.create(
        description='End date must be after start date',
        template='date_order', field_name='end_date', compare_field='start_date',
    )
    assert _result_for(rule, {'start_date': '2026-01-01', 'end_date': '2027-01-01'}).result == 'PASS'
    assert _result_for(rule, {'start_date': '2027-01-01', 'end_date': '2026-01-01'}).result == 'FAIL'
    assert _result_for(rule, {'start_date': 'soon'}).result == 'UNDETERMINED'


def test_text_check_must_not_contain():
    rule = CustomRule.objects.create(
        description='Renewal terms must not be vague',
        template='text_check', field_name='renewal_terms',
        operator='must_not_contain', text_value='mutually agreed, to be agreed',
    )
    assert _result_for(rule, {'renewal_terms': 'Renewable at 5% increase'}).result == 'PASS'
    assert _result_for(rule, {'renewal_terms': 'As mutually agreed by parties'}).result == 'FAIL'


def test_disabled_rule_not_evaluated():
    rule = CustomRule.objects.create(
        description='Rent minimum', template='number_compare',
        field_name='rent_amount', operator='gte', number_value=3000, enabled=False,
    )
    assert all(r.rule_id != rule.rule_id for r in evaluate_custom_rules({'rent_amount': '100'}))


def test_rule_ids_continue_after_r7():
    rule = CustomRule.objects.create(
        description='Rent minimum', template='number_compare',
        field_name='rent_amount', operator='gte', number_value=3000,
    )
    assert rule.rule_id == f'R{7 + rule.pk}'


def test_api_create_and_validation_flow(auth_client):
    payload = {
        'description': 'Monthly rent must be at least QAR 3000',
        'template': 'number_compare', 'field_name': 'rent_amount',
        'operator': 'gte', 'number_value': 3000, 'severity': 'high',
    }
    res = auth_client.post('/api/v1/custom-rules/', payload, format='json')
    assert res.status_code == 201, res.data
    assert res.data['rule_id'].startswith('R')
    assert res.data['created_by']

    from apps.lease_agent.services.validation_engine import ValidationEngine
    results = ValidationEngine().validate({'rent_amount': '2500'})
    custom = next(r for r in results if r.rule_id == res.data['rule_id'])
    assert custom.result == 'FAIL'
    assert custom.severity == 'high'


def test_api_rejects_incomplete_rule(auth_client):
    res = auth_client.post('/api/v1/custom-rules/', {
        'description': 'Broken rule', 'template': 'number_compare',
        'field_name': 'rent_amount', 'operator': 'gte',
    }, format='json')
    assert res.status_code == 400
    assert 'number_value' in res.data


def test_api_tenant_cannot_create(tenant_client):
    res = tenant_client.post('/api/v1/custom-rules/', {
        'description': 'x', 'template': 'required_field', 'field_name': 'rent_amount',
    }, format='json')
    assert res.status_code == 403
