import pytest
from apps.lease_agent.services.unit_matcher import UnitMatcher


@pytest.fixture
def matcher():
    return UnitMatcher()


@pytest.mark.django_db
def test_exact_match(matcher, available_unit):
    result = matcher.match(available_unit.external_unit_id)
    assert result.status == 'exact'
    assert result.unit_id == available_unit.id


@pytest.mark.django_db
def test_no_match_nonexistent(matcher):
    result = matcher.match('NONEXISTENT-0000')
    assert result.status == 'no_match'
    assert result.unit_id is None


@pytest.mark.django_db
def test_no_match_empty_string(matcher):
    result = matcher.match('')
    assert result.status == 'no_match'


@pytest.mark.django_db
def test_no_match_not_found_sentinel(matcher):
    result = matcher.match('NOT_FOUND')
    assert result.status == 'no_match'


@pytest.mark.django_db
def test_case_insensitive_match(matcher, available_unit):
    result = matcher.match(available_unit.external_unit_id.lower())
    assert result.status == 'exact'
