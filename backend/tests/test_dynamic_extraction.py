"""
Dynamic extraction tests — proving the system preserves unknown fields,
multiple unexpected clauses, handles missing data, contradictions, source
evidence, schema-free new fields, independent field review, and idempotency.

These tests use the mock provider and synthetic documents designed with clauses
and labels the extraction code was never explicitly programmed to find.
"""
import pytest
import tempfile, os
from apps.lease_agent.services.providers.mock_provider import MockLeaseExtractionProvider
from apps.lease_agent.services.providers.base import ExtractedField

pytestmark = pytest.mark.django_db


@pytest.fixture
def provider():
    return MockLeaseExtractionProvider()


# ─── Synthetic document fixtures ──────────────────────────────────────────────

STANDARD_LEASE_WITH_PET_CLAUSE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Hassan Al-Farsi

Unit: MC-A-0301
Marina Crest Residences, Doha

Commencement Date: 01/04/2025
Expiry Date: 31/03/2026

Monthly Rent: QAR 9,500
Annual Rent: QAR 114,000
Security Deposit: QAR 9,500

Rent Frequency: Monthly

Escalation Clause: Rent shall increase by 5% per annum on each anniversary.
Renewal Terms: Either party may renew with 60 days written notice.
Termination: Early termination requires 3 months written notice.

Pet Policy: No pets of any kind are permitted on the premises.
Smoking Policy: Smoking is strictly prohibited inside the unit and all common areas.
Parking Allocation: One dedicated parking bay is assigned to this unit.

Landlord Signature: _______________
Tenant Signature: _______________
"""

MULTI_UNKNOWN_CLAUSES_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Layla Al-Mutawa

Unit: MC-B-0902
Marina Crest Residences, Doha

Commencement Date: 01/06/2025
Expiry Date: 31/05/2026

Monthly Rent: QAR 11,000
Annual Rent: QAR 132,000
Security Deposit: QAR 11,000

Rent Frequency: Monthly

Escalation Clause: Rent shall increase by 4% annually.

Internet And Utilities: Tenant is responsible for internet, electricity, and water.
Noise Restrictions: No excessive noise between 10 PM and 8 AM.
Guest Policy: Guests may not stay longer than 7 consecutive days without prior written consent.
Subletting Restriction: Subletting or assignment of this lease is not permitted without written landlord consent.
Right Of Entry: Landlord may enter the unit with 24-hour written notice for inspection or maintenance.
Insurance Requirement: Tenant shall maintain contents insurance with a minimum value of QAR 50,000.

Landlord Signature: ___
Tenant Signature: ___
"""

MISSING_SEVERAL_FIELDS_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Tenant: Omar Hassan

Unit: MC-B-1205

Commencement Date: 01/07/2025
"""

CONTRADICTORY_RENT_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Nasser Al-Jaber

Unit: MC-B-1204

Commencement Date: 01/08/2025
Expiry Date: 31/07/2026

Monthly Rent: QAR 12,000
Annual Rent: QAR 144,000
Security Deposit: QAR 12,000

Escalation Clause: Rent shall increase by 5% per annum.

Payment Note: The agreed monthly payment is QAR 12,500 as clarified verbally.

Landlord Signature: ___
Tenant Signature: ___
"""

ENTIRELY_UNKNOWN_STRUCTURE = """
COMMERCIAL PROPERTY USE AGREEMENT

Operator: Marina Crest Facilities LLC
Licensee: Doha Fitness Club Ltd

Premises Reference: COM-G-001
Location: Ground Floor, Marina Crest Tower A

License Start: 01/01/2025
License End: 31/12/2025

Monthly License Fee: QAR 25,000
Refundable Bond: QAR 25,000

Operating Hours: 06:00 to 22:00 daily.
Permitted Use: Fitness centre and ancillary activities only.
Exclusivity Clause: No competing fitness operator shall operate within 500 meters.
Fit-Out Allowance: Licensee receives QAR 50,000 fit-out contribution.
Revenue Share: Operator receives 5% of gross monthly revenue exceeding QAR 200,000.

Operator Signature: ___
Licensee Signature: ___
"""


# ─── Test 1: Standard lease extracts expected fields ─────────────────────────

def test_standard_lease_extracts_expected_predefined_fields(provider):
    """All predefined required fields are extracted from a well-formed lease."""
    pages = [{'page_number': 1, 'text': STANDARD_LEASE_WITH_PET_CLAUSE}]
    result = provider.extract(STANDARD_LEASE_WITH_PET_CLAUSE, pages)
    fields = {f.field_name: f for f in result.fields}

    assert fields['tenant_name'].raw_value != 'NOT_FOUND'
    assert fields['unit_id'].raw_value != 'NOT_FOUND'
    assert fields['start_date'].normalized_value == '2025-04-01'
    assert fields['end_date'].normalized_value == '2026-03-31'
    assert float(fields['rent_amount'].normalized_value) == 9500.0
    assert float(fields['deposit_amount'].normalized_value) == 9500.0


# ─── Test 2: Unexpected clause is preserved ───────────────────────────────────

def test_unexpected_pet_clause_is_preserved(provider):
    """
    'Pet Policy' is not in the predefined field list. The dynamic scanner
    must discover it and return it — either as a dynamic ExtractedField
    or in additional_clauses.
    """
    pages = [{'page_number': 1, 'text': STANDARD_LEASE_WITH_PET_CLAUSE}]
    result = provider.extract(STANDARD_LEASE_WITH_PET_CLAUSE, pages)

    field_names = {f.field_name for f in result.fields}
    additional_clauses = result.raw_output.get('additional_clauses', [])
    clause_types = {c.get('clause_type', '') for c in additional_clauses}
    dynamic_discovered = result.raw_output.get('dynamic_fields_discovered', [])

    # Pet policy must appear somewhere in the output
    found = (
        'pet_policy' in field_names
        or 'pet_policy' in clause_types
        or 'pet_policy' in dynamic_discovered
        or any('pet' in (c.get('title', '') + c.get('raw_text', '')).lower() for c in additional_clauses)
    )
    assert found, (
        f"Pet Policy clause not preserved. Fields: {field_names}, "
        f"Clause types: {clause_types}, Dynamic: {dynamic_discovered}"
    )


# ─── Test 3: Multiple unknown clauses all preserved ───────────────────────────

def test_multiple_unknown_clauses_all_preserved(provider):
    """
    MULTI_UNKNOWN_CLAUSES_LEASE has 6 non-predefined clauses.
    The system must preserve at least 3 of them — it must not stop after
    finding a first unexpected clause.
    """
    pages = [{'page_number': 1, 'text': MULTI_UNKNOWN_CLAUSES_LEASE}]
    result = provider.extract(MULTI_UNKNOWN_CLAUSES_LEASE, pages)

    all_dynamic_names = set(result.raw_output.get('dynamic_fields_discovered', []))
    clause_types = {c.get('clause_type', '') for c in result.raw_output.get('additional_clauses', [])}
    all_discovered = all_dynamic_names | clause_types

    unknown_keywords = ['internet', 'noise', 'guest', 'subletting', 'entry', 'insurance']
    found_count = sum(
        1 for kw in unknown_keywords
        if any(kw in name for name in all_discovered)
    )
    assert found_count >= 3, (
        f"Expected at least 3 unknown clauses preserved, found {found_count}. "
        f"Discovered: {all_discovered}"
    )


# ─── Test 4: Missing values are not fabricated ────────────────────────────────

def test_missing_values_not_fabricated(provider):
    """
    MISSING_SEVERAL_FIELDS_LEASE has no landlord, no rent, no deposit.
    These must return NOT_FOUND — never a fabricated default.
    """
    pages = [{'page_number': 1, 'text': MISSING_SEVERAL_FIELDS_LEASE}]
    result = provider.extract(MISSING_SEVERAL_FIELDS_LEASE, pages)
    fields = {f.field_name: f for f in result.fields}

    assert fields['landlord_name'].raw_value == 'NOT_FOUND', "Landlord name should be NOT_FOUND"
    assert fields['rent_amount'].raw_value == 'NOT_FOUND', "Rent amount should be NOT_FOUND"
    assert fields['deposit_amount'].raw_value == 'NOT_FOUND', "Deposit should be NOT_FOUND"
    assert fields['landlord_name'].confidence == 0.0
    assert fields['rent_amount'].confidence == 0.0


# ─── Test 5: Contradictory values retained and flagged ────────────────────────

def test_contradictory_values_preserved_not_silently_overwritten(provider):
    """
    CONTRADICTORY_RENT_LEASE states 'Monthly Rent: QAR 12,000' and later
    'the agreed monthly payment is QAR 12,500'. The provider must either:
    - Flag has_contradiction=True on the relevant field, OR
    - Return both values in raw_output with a note

    The key requirement: the contradiction must NOT be silently resolved.
    """
    pages = [{'page_number': 1, 'text': CONTRADICTORY_RENT_LEASE}]
    result = provider.extract(CONTRADICTORY_RENT_LEASE, pages)
    fields = {f.field_name: f for f in result.fields}

    dynamic_discovered = result.raw_output.get('dynamic_fields_discovered', [])

    # Either the rent field is flagged, OR an additional field capturing
    # the conflicting value was discovered
    rent_flagged = fields.get('rent_amount') and fields['rent_amount'].has_contradiction
    conflict_discovered = any(
        'payment' in name or 'note' in name for name in dynamic_discovered
    )

    assert rent_flagged or conflict_discovered, (
        "Contradictory rent values (12,000 vs 12,500) were silently ignored. "
        f"rent field: {fields.get('rent_amount')}, "
        f"dynamic discovered: {dynamic_discovered}"
    )


# ─── Test 6: Source evidence attached to extracted data ───────────────────────

def test_source_evidence_attached_to_discovered_fields(provider):
    """
    Every dynamically discovered field must carry source_page and source_text
    so the reviewer can verify the evidence.
    """
    pages = [{'page_number': 1, 'text': STANDARD_LEASE_WITH_PET_CLAUSE}]
    result = provider.extract(STANDARD_LEASE_WITH_PET_CLAUSE, pages)

    dynamic_fields = [f for f in result.fields if f.extraction_method == 'dynamic_scan']
    for f in dynamic_fields:
        assert f.source_page is not None, (
            f"Dynamic field '{f.field_name}' has no source_page"
        )
        assert f.source_text, (
            f"Dynamic field '{f.field_name}' has empty source_text"
        )


# ─── Test 7: New field types don't require schema changes ─────────────────────

@pytest.mark.django_db
def test_new_field_types_require_no_schema_changes(available_unit):
    """
    Processing an entirely unknown document structure (commercial license)
    must complete without errors. New field names like 'permitted_use' or
    'revenue_share' must be stored as LeaseField records using the existing
    schema — no migration needed.
    """
    from apps.leases.models import Lease, LeaseField
    from apps.lease_agent.services.lease_extraction_service import LeaseExtractionService
    from django.core.files.base import ContentFile

    content = ENTIRELY_UNKNOWN_STRUCTURE.encode('utf-8')
    lease = Lease(unit=available_unit)
    lease.document.save('commercial_test.pdf', ContentFile(b'%PDF-1.4\n' + content))
    lease.save()

    # Pin to the mock provider: the dynamic scanner under test is a mock-provider
    # capability, and the suite must not depend on a live Ollama instance.
    from apps.lease_agent.services.providers.mock_provider import MockLeaseExtractionProvider
    service = LeaseExtractionService(provider=MockLeaseExtractionProvider())
    # Override the pdf extractor to return our synthetic text directly
    class FakePDF:
        def extract(self, path):
            return {
                'full_text': ENTIRELY_UNKNOWN_STRUCTURE,
                'pages': [{'page_number': 1, 'text': ENTIRELY_UNKNOWN_STRUCTURE}],
            }
    service.pdf_extractor = FakePDF()

    # Should not raise
    service.process_lease(lease.id)

    lease.refresh_from_db()
    all_fields = list(LeaseField.objects.filter(lease=lease).values_list('field_name', flat=True))

    # Some dynamic fields from the commercial document must have been persisted
    dynamic = LeaseField.objects.filter(lease=lease, extraction_method='dynamic_scan')
    assert dynamic.count() > 0, (
        f"No dynamic fields persisted for unknown-structure document. Fields found: {all_fields}"
    )


# ─── Test 8: Unknown extracted fields reach the API (reviewable) ──────────────

@pytest.mark.django_db
def test_dynamic_fields_are_reviewable_via_api(auth_client, available_unit):
    """
    After processing a document with unexpected fields, those fields must be
    accessible via GET /api/v1/lease-fields/?lease=<id> so the owner can
    review and approve or reject them.
    """
    from apps.leases.models import Lease, LeaseField
    from django.core.files.base import ContentFile

    lease = Lease(unit=available_unit)
    lease.document.save('review_test.pdf', ContentFile(b'%PDF-1.4'))
    lease.save()

    # Create a dynamic field as if the extractor persisted it
    LeaseField.objects.create(
        lease=lease,
        field_name='pet_policy',
        display_label='Pet Policy',
        extraction_method='dynamic_scan',
        category='restrictions',
        extracted_value='No pets of any kind are permitted.',
        normalized_value='No pets of any kind are permitted.',
        confidence=0.65,
        source_page=1,
        source_text='Pet Policy: No pets of any kind are permitted.',
        review_status='pending',
    )

    response = auth_client.get(f'/api/v1/lease-fields/?lease={lease.id}')
    assert response.status_code == 200

    field_names = [item['field_name'] for item in response.data.get('results', response.data)]
    assert 'pet_policy' in field_names, (
        f"Dynamic field 'pet_policy' not returned by API. Got: {field_names}"
    )


# ─── Test 9: Approving one field does not affect others ───────────────────────

@pytest.mark.django_db
def test_approving_one_field_does_not_affect_other_fields(auth_client, available_unit):
    """
    Approving or rejecting a single field must only update that field.
    All other fields on the lease must remain unchanged.
    """
    from apps.leases.models import Lease, LeaseField
    from django.core.files.base import ContentFile

    lease = Lease(unit=available_unit)
    lease.document.save('isolation_test.pdf', ContentFile(b'%PDF-1.4'))
    lease.save()

    f1 = LeaseField.objects.create(
        lease=lease, field_name='tenant_name',
        extraction_method='predefined', extracted_value='Hassan',
        normalized_value='Hassan', confidence=0.88, review_status='pending',
    )
    f2 = LeaseField.objects.create(
        lease=lease, field_name='pet_policy',
        extraction_method='dynamic_scan', extracted_value='No pets.',
        normalized_value='No pets.', confidence=0.65, review_status='pending',
    )

    # Approve f1
    r = auth_client.post(f'/api/v1/lease-fields/{f1.id}/approve/',
                         {'reviewed_by': 'owner@test.com', 'reviewed_value': 'Hassan'}, format='json')
    assert r.status_code == 200, r.data

    # f2 must still be pending
    f2.refresh_from_db()
    assert f2.review_status == 'pending', (
        f"Approving f1 changed f2's status to {f2.review_status}"
    )


# ─── Test 10: Reprocessing does not duplicate records ─────────────────────────

@pytest.mark.django_db
def test_reprocessing_does_not_duplicate_fields(available_unit):
    """
    Running process_lease() twice on the same lease must not create duplicate
    LeaseField or LeaseClause records. The pipeline must clear previous results
    before persisting new ones.
    """
    from apps.leases.models import Lease, LeaseField, LeaseClause
    from apps.lease_agent.services.lease_extraction_service import LeaseExtractionService
    from django.core.files.base import ContentFile

    lease = Lease(unit=available_unit)
    lease.document.save('idempotent_test.pdf', ContentFile(b'%PDF-1.4'))
    lease.save()

    class FakePDF:
        def extract(self, path):
            return {
                'full_text': STANDARD_LEASE_WITH_PET_CLAUSE,
                'pages': [{'page_number': 1, 'text': STANDARD_LEASE_WITH_PET_CLAUSE}],
            }

    service = LeaseExtractionService()
    service.pdf_extractor = FakePDF()

    service.process_lease(lease.id)
    count_after_first = LeaseField.objects.filter(lease=lease).count()
    assert count_after_first > 0

    service.process_lease(lease.id)
    count_after_second = LeaseField.objects.filter(lease=lease).count()

    assert count_after_second == count_after_first, (
        f"Reprocessing created duplicate fields: first={count_after_first}, "
        f"second={count_after_second}"
    )
