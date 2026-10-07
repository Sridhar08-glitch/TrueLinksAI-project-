import re
from datetime import date
from typing import Optional


def _flag(flag_type, severity, description, related_fields=None, source_reference=''):
    return {
        'flag_type': flag_type,
        'severity': severity,
        'description': description,
        'related_fields': related_fields or [],
        'source_reference': source_reference,
    }


class LeaseFlaggingService:
    REQUIRED_FIELDS = [
        'tenant_name', 'landlord_name', 'unit_id',
        'start_date', 'end_date', 'rent_amount', 'deposit_amount',
    ]

    def detect_flags(self, fields: dict) -> list[dict]:
        flags = []

        # Missing required fields
        for field_name in self.REQUIRED_FIELDS:
            value = fields.get(field_name)
            if value is None or value == 'NOT_FOUND' or value == '':
                flags.append(_flag(
                    'missing_field',
                    'high',
                    f'Required field "{field_name}" could not be extracted from the document.',
                    related_fields=[field_name],
                ))

        # Date range validation
        start = fields.get('start_date')
        end = fields.get('end_date')
        if start and end and start != 'NOT_FOUND' and end != 'NOT_FOUND':
            try:
                start_dt = date.fromisoformat(str(start))
                end_dt = date.fromisoformat(str(end))
                if end_dt <= start_dt:
                    flags.append(_flag(
                        'invalid_date_range',
                        'critical',
                        f'End date ({end}) is not after start date ({start}). This is an invalid lease term.',
                        related_fields=['start_date', 'end_date'],
                    ))
                else:
                    months = (end_dt.year - start_dt.year) * 12 + (end_dt.month - start_dt.month)
                    if months > 36:
                        flags.append(_flag(
                            'term_exceeds_limit',
                            'medium',
                            f'Lease term is {months} months, which exceeds the 36-month maximum requiring owner approval.',
                            related_fields=['start_date', 'end_date'],
                        ))
            except (ValueError, TypeError):
                flags.append(_flag(
                    'unparseable_dates',
                    'high',
                    'Start or end date could not be parsed. Manual review required.',
                    related_fields=['start_date', 'end_date'],
                ))

        # Unusual rent amount
        rent = fields.get('rent_amount')
        if rent is not None and rent != 'NOT_FOUND':
            try:
                rent_float = float(rent)
                if rent_float < 1000:
                    flags.append(_flag(
                        'unusually_low_rent',
                        'medium',
                        f'Monthly rent of {rent_float} appears unusually low. Verify currency and amount.',
                        related_fields=['rent_amount'],
                    ))
                elif rent_float > 500000:
                    flags.append(_flag(
                        'unusually_high_rent',
                        'medium',
                        f'Monthly rent of {rent_float} appears unusually high. Verify this is a monthly figure.',
                        related_fields=['rent_amount'],
                    ))
            except (ValueError, TypeError):
                pass

        # Contradiction: annual rent does not reconcile with monthly rent
        annual = fields.get('annual_rent')
        if (rent is not None and rent != 'NOT_FOUND'
                and annual is not None and annual != 'NOT_FOUND'):
            try:
                monthly_float = float(rent)
                annual_float = float(annual)
                expected_annual = monthly_float * 12
                if expected_annual > 0 and abs(annual_float - expected_annual) > expected_annual * 0.02:
                    flags.append(_flag(
                        'rent_reconciliation_mismatch',
                        'high',
                        f'Annual rent ({annual_float}) contradicts monthly rent ({monthly_float}) x 12 = {expected_annual}. '
                        'One of the two figures is likely wrong.',
                        related_fields=['rent_amount', 'annual_rent'],
                    ))
            except (ValueError, TypeError):
                pass

        # Ambiguous renewal clause
        renewal = fields.get('renewal_terms', '')
        if renewal and renewal != 'NOT_FOUND':
            if re.search(r'mutually\s+agreed|as\s+agreed|to\s+be\s+agreed', str(renewal), re.IGNORECASE):
                flags.append(_flag(
                    'ambiguous_renewal_clause',
                    'medium',
                    'Renewal clause uses vague language ("as mutually agreed") without specific terms or notice period.',
                    related_fields=['renewal_terms'],
                    source_reference=str(renewal)[:200],
                ))

        # Missing unit reference
        unit_id = fields.get('unit_id')
        if not unit_id or unit_id == 'NOT_FOUND':
            flags.append(_flag(
                'missing_unit_reference',
                'high',
                'No unit identifier matching the property format was found in the document. Manual unit assignment required.',
                related_fields=['unit_id'],
            ))

        return flags
