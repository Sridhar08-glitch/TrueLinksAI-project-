import pytest
from apps.lease_agent.services.providers.mock_provider import MockLeaseExtractionProvider


@pytest.fixture
def provider():
    return MockLeaseExtractionProvider()


SAMPLE_LEASE_TEXT = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Ahmed Al-Mansouri

Unit: MC-B-1204
Property: Marina Crest Residences, Lusail Marina District, Doha

Commencement Date: 01/01/2025
Expiry Date: 31/12/2025

Monthly Rent: QAR 12,000
Annual Rent: QAR 144,000
Security Deposit: QAR 12,000

Rent Frequency: Monthly

Escalation Clause: Rent shall increase by 5% per annum on each anniversary.

Renewal Terms: Either party may renew with 60 days written notice.

Termination: Early termination requires 3 months written notice.

Landlord Signature: _______________
Tenant Signature: _______________
"""


def test_provider_name(provider):
    result = provider.extract(SAMPLE_LEASE_TEXT, [{'page_number': 1, 'text': SAMPLE_LEASE_TEXT}])
    assert result.provider_name == 'mock'


def test_extracts_tenant_name(provider):
    result = provider.extract(SAMPLE_LEASE_TEXT, [{'page_number': 1, 'text': SAMPLE_LEASE_TEXT}])
    fields = {f.field_name: f for f in result.fields}
    assert fields['tenant_name'].normalized_value is not None
    assert fields['tenant_name'].confidence > 0


def test_extracts_unit_id(provider):
    result = provider.extract(SAMPLE_LEASE_TEXT, [{'page_number': 1, 'text': SAMPLE_LEASE_TEXT}])
    fields = {f.field_name: f for f in result.fields}
    assert fields['unit_id'].normalized_value == 'MC-B-1204'
    assert fields['unit_id'].source_page == 1


def test_extracts_rent_amount(provider):
    result = provider.extract(SAMPLE_LEASE_TEXT, [{'page_number': 1, 'text': SAMPLE_LEASE_TEXT}])
    fields = {f.field_name: f for f in result.fields}
    rent = fields['rent_amount']
    # Provider should find a non-zero rent amount
    assert rent.normalized_value is not None and rent.normalized_value != 'NOT_FOUND'
    assert rent.confidence > 0


def test_missing_field_returns_not_found(provider):
    minimal_text = 'This is a lease agreement with no useful data.'
    result = provider.extract(minimal_text, [{'page_number': 1, 'text': minimal_text}])
    fields = {f.field_name: f for f in result.fields}
    assert fields['unit_id'].raw_value == 'NOT_FOUND'
    assert fields['unit_id'].confidence == 0.0


def test_raw_output_marks_provider(provider):
    result = provider.extract(SAMPLE_LEASE_TEXT, [{'page_number': 1, 'text': SAMPLE_LEASE_TEXT}])
    assert result.raw_output['provider'] == 'mock'
    assert 'Not genuine AI inference' in result.raw_output['note']
