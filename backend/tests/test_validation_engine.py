import pytest
from apps.lease_agent.services.validation_engine import ValidationEngine


@pytest.fixture
def engine():
    return ValidationEngine()


def test_r1_pass(engine):
    result = engine._check_r1({'deposit_amount': 10000, 'rent_amount': 8000})
    assert result.result == 'PASS'


def test_r1_fail(engine):
    result = engine._check_r1({'deposit_amount': 5000, 'rent_amount': 8000})
    assert result.result == 'FAIL'


def test_r1_undetermined_missing_deposit(engine):
    result = engine._check_r1({'rent_amount': 8000})
    assert result.result == 'UNDETERMINED'


def test_r1_undetermined_missing_rent(engine):
    result = engine._check_r1({'deposit_amount': 8000})
    assert result.result == 'UNDETERMINED'


def test_r1_undetermined_not_found(engine):
    result = engine._check_r1({'deposit_amount': 'NOT_FOUND', 'rent_amount': 8000})
    assert result.result == 'UNDETERMINED'


def test_r3_pass(engine):
    result = engine._check_r3({'start_date': '2024-01-01', 'end_date': '2025-12-31'})
    assert result.result == 'PASS'


def test_r3_fail_exceeds_36_months(engine):
    result = engine._check_r3({'start_date': '2024-01-01', 'end_date': '2027-06-01'})
    assert result.result == 'FAIL'


def test_r4_pass(engine):
    result = engine._check_r4({'start_date': '2024-01-01', 'end_date': '2025-01-01'})
    assert result.result == 'PASS'


def test_r4_fail_end_before_start(engine):
    result = engine._check_r4({'start_date': '2025-01-01', 'end_date': '2024-01-01'})
    assert result.result == 'FAIL'


def test_r6_pass(engine):
    result = engine._check_r6({'rent_amount': 8000, 'annual_rent': 96000})
    assert result.result == 'PASS'


def test_r6_fail(engine):
    result = engine._check_r6({'rent_amount': 8000, 'annual_rent': 90000})
    assert result.result == 'FAIL'


def test_r6_undetermined(engine):
    result = engine._check_r6({'rent_amount': 8000})
    assert result.result == 'UNDETERMINED'


@pytest.mark.django_db
def test_r7_unit_not_found(engine):
    result = engine._check_r7({'unit_id': 'NONEXISTENT-999'})
    assert result.result == 'FAIL'


@pytest.mark.django_db
def test_r7_undetermined_no_unit_id(engine):
    result = engine._check_r7({})
    assert result.result == 'UNDETERMINED'


@pytest.mark.django_db
def test_r7_pass_available_unit(engine, available_unit):
    result = engine._check_r7({'unit_id': available_unit.external_unit_id})
    assert result.result == 'PASS'


@pytest.mark.django_db
def test_r7_fail_occupied_unit(engine, occupied_unit):
    result = engine._check_r7({'unit_id': occupied_unit.external_unit_id})
    assert result.result == 'FAIL'
