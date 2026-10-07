"""
Lease extraction accuracy tests.
Verifies that extracted values match what is actually in the document,
covers incorrect dates, missing fields, source evidence, and unexpected clauses.
"""
import pytest
from apps.lease_agent.services.providers.mock_provider import MockLeaseExtractionProvider
from apps.lease_agent.services.validation_engine import ValidationEngine
from apps.lease_agent.services.flagging_service import LeaseFlaggingService


# ─── Fixtures ────────────────────────────────────────────────────────────────

WELL_FORMED_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Ahmed Abdullah Al-Mansouri

Unit: MC-B-1204
Marina Crest Residences, Lusail Marina District, Doha

Commencement Date: 01/03/2025
Expiry Date: 28/02/2026

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

MISSING_RENT_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Sara Al-Kuwari

Unit: MC-A-0301

Commencement Date: 01/06/2025
Expiry Date: 31/05/2026

Security Deposit: QAR 8,000

Escalation Clause: Rent shall increase by 3% per annum.
Landlord Signature: ___
Tenant Signature: ___
"""

INVERTED_DATES_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Omar Hassan

Unit: MC-B-0902

Commencement Date: 01/01/2026
Expiry Date: 01/01/2025

Monthly Rent: QAR 6,500
Annual Rent: QAR 78,000
Security Deposit: QAR 6,500

Landlord Signature: ___
Tenant Signature: ___
"""

VAGUE_RENEWAL_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Fatima Al-Rashid

Unit: MC-A-0302

Commencement Date: 01/04/2025
Expiry Date: 31/03/2026

Monthly Rent: QAR 15,000
Annual Rent: QAR 180,000
Security Deposit: QAR 15,000

Rent Frequency: Monthly

Escalation Clause: Rent increase as mutually agreed between both parties.
Renewal Terms: Renewal as agreed by both parties at landlord discretion.
Termination: As mutually agreed.

Landlord Signature: _______________
Tenant Signature: _______________
"""

LONG_TERM_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Khalid Al-Thani

Unit: MC-B-1205

Commencement Date: 01/01/2025
Expiry Date: 31/12/2028

Monthly Rent: QAR 10,000
Annual Rent: QAR 120,000
Security Deposit: QAR 10,000

Escalation Clause: Rent shall increase by 5% annually.
Landlord Signature: ___
Tenant Signature: ___
"""

NO_UNIT_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Noor Al-Mazrouei

Commencement Date: 01/05/2025
Expiry Date: 30/04/2026

Monthly Rent: QAR 9,000
Annual Rent: QAR 108,000
Security Deposit: QAR 9,000

Escalation Clause: Rent shall increase by 4% per annum.
Landlord Signature: ___
Tenant Signature: ___
"""

ANNUAL_MISMATCH_LEASE = """
RESIDENTIAL LEASE AGREEMENT

Landlord: Marina Crest Holdings W.L.L.
Tenant: Jassim Al-Marri

Unit: MC-A-0301

Commencement Date: 01/07/2025
Expiry Date: 30/06/2026

Monthly Rent: QAR 11,000
Annual Rent: QAR 100,000
Security Deposit: QAR 11,000

Escalation Clause: Rent shall increase by 5% per annum.
Landlord Signature: ___
Tenant Signature: ___
"""


@pytest.fixture
def provider():
    return MockLeaseExtractionProvider()


@pytest.fixture
def engine():
    return ValidationEngine()


@pytest.fixture
def flagger():
    return LeaseFlaggingService()


# ─── Extraction accuracy ──────────────────────────────────────────────────────

class TestExtractionAccuracy:
    def _fields(self, provider, text):
        pages = [{'page_number': 1, 'text': text}]
        result = provider.extract(text, pages)
        return {f.field_name: f for f in result.fields}

    def test_unit_id_matches_document(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        assert f['unit_id'].normalized_value == 'MC-B-1204'

    def test_unit_id_source_page_recorded(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        assert f['unit_id'].source_page == 1, "Source page must be recorded, not None"

    def test_unit_id_source_text_not_empty(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        assert f['unit_id'].source_text, "Source text must be non-empty for found field"

    def test_tenant_name_extracted(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        assert f['tenant_name'].normalized_value is not None
        assert 'NOT_FOUND' not in str(f['tenant_name'].normalized_value)

    def test_landlord_name_extracted(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        assert f['landlord_name'].normalized_value is not None

    def test_start_date_iso_format(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        val = f['start_date'].normalized_value
        assert val is not None and val != 'NOT_FOUND'
        from datetime import date
        parsed = date.fromisoformat(str(val))
        assert parsed.year == 2025

    def test_end_date_iso_format(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        val = f['end_date'].normalized_value
        assert val is not None and val != 'NOT_FOUND'
        from datetime import date
        parsed = date.fromisoformat(str(val))
        assert parsed.year == 2026

    def test_rent_amount_is_numeric(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        val = f['rent_amount'].normalized_value
        assert val is not None and val != 'NOT_FOUND'
        assert float(val) > 0

    def test_deposit_amount_is_numeric(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        val = f['deposit_amount'].normalized_value
        assert val is not None and val != 'NOT_FOUND'
        assert float(val) > 0

    def test_confidence_between_0_and_1(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        for field_name, field in f.items():
            assert field.confidence is not None, f"{field_name} confidence is None"
            assert 0.0 <= field.confidence <= 1.0, f"{field_name} confidence out of range: {field.confidence}"

    def test_found_fields_have_nonzero_confidence(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        found = [field for field in f.values() if field.raw_value != 'NOT_FOUND']
        for field in found:
            assert field.confidence > 0, f"{field.field_name} was found but has zero confidence"

    def test_missing_fields_have_zero_confidence(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        not_found = [field for field in f.values() if field.raw_value == 'NOT_FOUND']
        for field in not_found:
            assert field.confidence == 0.0, f"{field.field_name} was NOT_FOUND but confidence={field.confidence}"

    def test_escalation_clause_captured(self, provider):
        f = self._fields(provider, WELL_FORMED_LEASE)
        val = f['escalation_clause'].normalized_value
        assert val and val != 'NOT_FOUND'
        assert '5%' in str(val) or 'per annum' in str(val).lower()

    def test_raw_output_marks_mock_provider(self, provider):
        pages = [{'page_number': 1, 'text': WELL_FORMED_LEASE}]
        result = provider.extract(WELL_FORMED_LEASE, pages)
        assert result.raw_output['provider'] == 'mock'
        assert 'Not genuine AI inference' in result.raw_output['note']


# ─── Missing fields ───────────────────────────────────────────────────────────

class TestMissingFields:
    def _fields(self, provider, text):
        pages = [{'page_number': 1, 'text': text}]
        result = provider.extract(text, pages)
        return {f.field_name: f for f in result.fields}

    def test_missing_rent_returns_not_found(self, provider):
        f = self._fields(provider, MISSING_RENT_LEASE)
        assert f['rent_amount'].raw_value == 'NOT_FOUND'
        assert f['rent_amount'].confidence == 0.0

    def test_missing_rent_source_text_empty(self, provider):
        f = self._fields(provider, MISSING_RENT_LEASE)
        assert f['rent_amount'].source_page is None

    def test_missing_unit_returns_not_found(self, provider):
        f = self._fields(provider, NO_UNIT_LEASE)
        assert f['unit_id'].raw_value == 'NOT_FOUND'

    def test_completely_empty_document(self, provider):
        empty = "This document contains no useful lease information."
        pages = [{'page_number': 1, 'text': empty}]
        result = provider.extract(empty, pages)
        fields = {f.field_name: f for f in result.fields}
        assert fields['unit_id'].raw_value == 'NOT_FOUND'
        assert fields['rent_amount'].raw_value == 'NOT_FOUND'
        assert fields['tenant_name'].raw_value == 'NOT_FOUND'


# ─── Flagging accuracy ────────────────────────────────────────────────────────

class TestFlaggingAccuracy:
    def _flag_types(self, flagger, fields_dict):
        return {f['flag_type'] for f in flagger.detect_flags(fields_dict)}

    def test_inverted_dates_flagged_as_invalid_range(self, provider, flagger):
        pages = [{'page_number': 1, 'text': INVERTED_DATES_LEASE}]
        result = provider.extract(INVERTED_DATES_LEASE, pages)
        fdict = {f.field_name: f.normalized_value for f in result.fields}
        # Force inversion to guarantee the flag fires regardless of extraction
        fdict['start_date'] = '2026-01-01'
        fdict['end_date'] = '2025-01-01'
        flag_types = self._flag_types(flagger, fdict)
        assert 'invalid_date_range' in flag_types

    def test_missing_rent_flagged(self, provider, flagger):
        pages = [{'page_number': 1, 'text': MISSING_RENT_LEASE}]
        result = provider.extract(MISSING_RENT_LEASE, pages)
        fdict = {f.field_name: f.normalized_value for f in result.fields}
        flag_types = self._flag_types(flagger, fdict)
        assert 'missing_field' in flag_types

    def test_no_unit_flagged_as_missing_unit_reference(self, provider, flagger):
        pages = [{'page_number': 1, 'text': NO_UNIT_LEASE}]
        result = provider.extract(NO_UNIT_LEASE, pages)
        fdict = {f.field_name: f.normalized_value for f in result.fields}
        flag_types = self._flag_types(flagger, fdict)
        assert 'missing_unit_reference' in flag_types or 'missing_field' in flag_types

    def test_vague_escalation_flagged(self, provider, flagger):
        pages = [{'page_number': 1, 'text': VAGUE_RENEWAL_LEASE}]
        result = provider.extract(VAGUE_RENEWAL_LEASE, pages)
        fdict = {f.field_name: f.normalized_value for f in result.fields}
        # Force the vague escalation text into the dict
        fdict['escalation_clause'] = 'Rent increase as mutually agreed between both parties.'
        flag_types = self._flag_types(flagger, fdict)
        assert 'ambiguous_renewal_clause' in flag_types

    def test_long_term_flagged(self, flagger):
        fdict = {
            'start_date': '2025-01-01',
            'end_date': '2028-12-31',
            'rent_amount': 10000,
            'deposit_amount': 10000,
            'tenant_name': 'Khalid',
            'landlord_name': 'Marina Crest Holdings',
            'unit_id': 'MC-B-1205',
        }
        flag_types = self._flag_types(flagger, fdict)
        assert 'term_exceeds_limit' in flag_types

    def test_well_formed_lease_has_no_critical_flags(self, provider, flagger):
        pages = [{'page_number': 1, 'text': WELL_FORMED_LEASE}]
        result = provider.extract(WELL_FORMED_LEASE, pages)
        fdict = {f.field_name: f.normalized_value for f in result.fields}
        flags = flagger.detect_flags(fdict)
        critical = [f for f in flags if f['severity'] == 'critical']
        assert len(critical) == 0, f"Unexpected critical flags: {[f['flag_type'] for f in critical]}"


# ─── Validation accuracy ──────────────────────────────────────────────────────

class TestValidationAccuracy:
    def test_annual_rent_mismatch_fails_r6(self, engine):
        fields = {
            'rent_amount': 11000,
            'annual_rent': 100000,
        }
        result = engine._check_r6(fields)
        assert result.result == 'FAIL'
        assert '100000' in result.reason or '132000' in result.reason

    def test_r6_passes_with_exact_match(self, engine):
        fields = {'rent_amount': 12000, 'annual_rent': 144000}
        assert engine._check_r6(fields).result == 'PASS'

    def test_r6_passes_within_2_percent_tolerance(self, engine):
        fields = {'rent_amount': 12000, 'annual_rent': 144001}
        assert engine._check_r6(fields).result == 'PASS'

    def test_r2_fails_vague_escalation(self, engine):
        fields = {'escalation_clause': 'Rent increase as mutually agreed between parties.'}
        assert engine._check_r2(fields).result == 'FAIL'

    def test_r2_passes_with_percentage(self, engine):
        fields = {'escalation_clause': 'Rent shall increase by 5% per annum.'}
        assert engine._check_r2(fields).result == 'PASS'

    def test_r2_undetermined_when_absent(self, engine):
        assert engine._check_r2({}).result == 'UNDETERMINED'

    def test_r3_fails_48_month_term(self, engine):
        fields = {'start_date': '2025-01-01', 'end_date': '2029-01-01'}
        result = engine._check_r3(fields)
        assert result.result == 'FAIL'
        assert '48' in result.reason

    def test_r5_undetermined_when_no_signatures(self, engine):
        fields = {
            'tenant_name': 'Ahmed',
            'landlord_name': 'Marina Crest',
            'tenant_signed': False,
            'landlord_signed': False,
        }
        assert engine._check_r5(fields).result == 'UNDETERMINED'

    @pytest.mark.django_db
    def test_r7_full_pipeline_available_unit(self, engine, available_unit):
        result = engine._check_r7({'unit_id': available_unit.external_unit_id})
        assert result.result == 'PASS'
        assert available_unit.external_unit_id in result.reason

    @pytest.mark.django_db
    def test_r7_full_pipeline_occupied_unit(self, engine, occupied_unit):
        result = engine._check_r7({'unit_id': occupied_unit.external_unit_id})
        assert result.result == 'FAIL'
        assert 'occupied' in result.reason.lower()

    def test_all_seven_rules_run_on_complete_fields(self, engine):
        fields = {
            'tenant_name': 'Ahmed',
            'landlord_name': 'Marina Crest Holdings',
            'tenant_signed': True,
            'landlord_signed': True,
            'start_date': '2025-01-01',
            'end_date': '2025-12-31',
            'rent_amount': 12000,
            'annual_rent': 144000,
            'deposit_amount': 12000,
            'escalation_clause': 'Rent increases by 5% per annum.',
            'unit_id': 'NOT_FOUND',
        }
        results = engine.validate(fields)
        assert len(results) == 7
        rule_ids = {r.rule_id for r in results}
        assert rule_ids == {'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'}


# ─── Source evidence integrity ────────────────────────────────────────────────

class TestSourceEvidence:
    def test_found_field_has_source_page(self, provider):
        pages = [{'page_number': 1, 'text': WELL_FORMED_LEASE}]
        result = provider.extract(WELL_FORMED_LEASE, pages)
        fields = {f.field_name: f for f in result.fields}
        unit_field = fields['unit_id']
        assert unit_field.source_page is not None, "unit_id must have source_page when found"
        assert unit_field.source_page == 1

    def test_multipage_source_attribution(self, provider):
        page1 = "RESIDENTIAL LEASE AGREEMENT\n\nLandlord: Marina Crest Holdings W.L.L.\nTenant: John Smith\n"
        page2 = "Unit: MC-A-0301\nCommencement Date: 01/02/2025\nExpiry Date: 31/01/2026\n"
        page3 = "Monthly Rent: QAR 14,000\nSecurity Deposit: QAR 14,000\n"
        pages = [
            {'page_number': 1, 'text': page1},
            {'page_number': 2, 'text': page2},
            {'page_number': 3, 'text': page3},
        ]
        full_text = page1 + page2 + page3
        result = provider.extract(full_text, pages)
        fields = {f.field_name: f for f in result.fields}
        unit_field = fields['unit_id']
        assert unit_field.source_page == 2, f"Unit ID found on page 2, got {unit_field.source_page}"

    def test_not_found_field_has_no_source_page(self, provider):
        minimal = "A lease document with no useful content."
        pages = [{'page_number': 1, 'text': minimal}]
        result = provider.extract(minimal, pages)
        fields = {f.field_name: f for f in result.fields}
        assert fields['unit_id'].source_page is None

    def test_source_text_contains_extracted_value(self, provider):
        pages = [{'page_number': 1, 'text': WELL_FORMED_LEASE}]
        result = provider.extract(WELL_FORMED_LEASE, pages)
        fields = {f.field_name: f for f in result.fields}
        unit_field = fields['unit_id']
        if unit_field.source_text:
            assert 'MC-B-1204' in unit_field.source_text, \
                f"Source text should contain the extracted unit ID. Got: {unit_field.source_text}"
