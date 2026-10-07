import json
from datetime import date
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass


@dataclass
class RuleEvaluation:
    rule_id: str
    rule_name: str
    result: str  # PASS, FAIL, UNDETERMINED
    reason: str
    evaluated_value: Any
    expected_condition: str
    severity: str = 'medium'


# Mirrors owner_ruleset.json; used only when the file is missing or unreadable.
_FALLBACK_SEVERITIES = {
    'R1': 'high', 'R2': 'medium', 'R3': 'medium', 'R4': 'high',
    'R5': 'high', 'R6': 'low', 'R7': 'high',
}


class ValidationEngine:
    """Evaluates leases against the owner's acceptance standards.

    Rule definitions (description, severity, check condition) come from
    sample_data/owner_ruleset.json; the evaluation logic for each rule is
    implemented in the _check_rN methods. If the ruleset file is missing,
    the engine falls back to the built-in definitions.
    """

    def __init__(self):
        self.ruleset = self._load_ruleset()

    def _load_ruleset(self) -> dict:
        from django.conf import settings
        try:
            path = Path(settings.SAMPLE_DATA_DIR) / 'owner_ruleset.json'
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            return {r['id']: r for r in data.get('rules', []) if r.get('id')}
        except (OSError, json.JSONDecodeError, TypeError, AttributeError):
            return {}

    def _config(self, rule_id: str, key: str, default):
        rule = self.ruleset.get(rule_id) or {}
        value = (rule.get('config') or {}).get(key, default)
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _is_enabled(self, rule_id: str) -> bool:
        rule = self.ruleset.get(rule_id)
        if rule is None:
            return True
        return rule.get('enabled', True) is not False

    def validate(self, fields: dict) -> list[RuleEvaluation]:
        checks = {
            'R1': self._check_r1, 'R2': self._check_r2, 'R3': self._check_r3,
            'R4': self._check_r4, 'R5': self._check_r5, 'R6': self._check_r6,
            'R7': self._check_r7,
        }
        results = [check(fields) for rule_id, check in checks.items() if self._is_enabled(rule_id)]
        for result in results:
            rule = self.ruleset.get(result.rule_id)
            if rule:
                result.rule_name = (rule.get('description') or result.rule_name)[:255]
                result.expected_condition = (rule.get('check') or result.expected_condition)[:512]
            result.severity = (rule or {}).get('severity') or _FALLBACK_SEVERITIES.get(result.rule_id, 'medium')

        from .custom_rule_engine import evaluate_custom_rules
        results.extend(evaluate_custom_rules(fields))
        return results

    def _get_float(self, fields: dict, key: str) -> Optional[float]:
        val = fields.get(key)
        if val is None or val == 'NOT_FOUND' or val == '':
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    def _get_date(self, fields: dict, key: str) -> Optional[date]:
        val = fields.get(key)
        if val is None or val == 'NOT_FOUND' or val == '':
            return None
        try:
            if isinstance(val, date):
                return val
            return date.fromisoformat(str(val))
        except (ValueError, TypeError):
            return None

    def _check_r1(self, fields: dict) -> RuleEvaluation:
        deposit = self._get_float(fields, 'deposit_amount')
        rent = self._get_float(fields, 'rent_amount')
        min_months = self._config('R1', 'min_deposit_months', 1)

        if deposit is None or rent is None:
            return RuleEvaluation(
                rule_id='R1',
                rule_name='Security deposit >= one month rent',
                result='UNDETERMINED',
                reason='deposit_amount or rent_amount could not be extracted.',
                evaluated_value={'deposit': deposit, 'monthly_rent': rent},
                expected_condition='deposit_amount >= monthly_rent',
            )
        required = rent * min_months
        if deposit >= required:
            return RuleEvaluation(
                rule_id='R1',
                rule_name='Security deposit >= one month rent',
                result='PASS',
                reason=f'Deposit ({deposit}) is >= required minimum ({required}, {min_months:g} month(s) of rent).',
                evaluated_value={'deposit': deposit, 'monthly_rent': rent, 'min_deposit_months': min_months},
                expected_condition='deposit_amount >= monthly_rent',
            )
        return RuleEvaluation(
            rule_id='R1',
            rule_name='Security deposit >= one month rent',
            result='FAIL',
            reason=f'Deposit ({deposit}) is below the required minimum ({required}, {min_months:g} month(s) of rent).',
            evaluated_value={'deposit': deposit, 'monthly_rent': rent, 'min_deposit_months': min_months},
            expected_condition='deposit_amount >= monthly_rent',
        )

    def _check_r2(self, fields: dict) -> RuleEvaluation:
        escalation = fields.get('escalation_clause', '')
        if not escalation or escalation == 'NOT_FOUND':
            return RuleEvaluation(
                rule_id='R2',
                rule_name='Defined rent escalation clause',
                result='UNDETERMINED',
                reason='No escalation clause was extracted from the document.',
                evaluated_value=None,
                expected_condition='escalation_clause contains a specific mechanism or percentage',
            )
        import re
        vague = bool(re.search(r'mutually\s+agreed|as\s+agreed|to\s+be\s+agreed|at\s+discretion', str(escalation), re.IGNORECASE))
        has_percent = bool(re.search(r'\d+\s*%', str(escalation)))
        has_mechanism = bool(re.search(r'cpi|index|fixed\s+increase|per\s+annum|annually', str(escalation), re.IGNORECASE))

        if (has_percent or has_mechanism) and not vague:
            return RuleEvaluation(
                rule_id='R2',
                rule_name='Defined rent escalation clause',
                result='PASS',
                reason='Escalation clause contains a specific mechanism or percentage.',
                evaluated_value={'escalation_clause': str(escalation)[:200]},
                expected_condition='escalation_clause contains a specific mechanism or percentage',
            )
        if vague:
            return RuleEvaluation(
                rule_id='R2',
                rule_name='Defined rent escalation clause',
                result='FAIL',
                reason='Escalation clause uses vague language without a specific mechanism.',
                evaluated_value={'escalation_clause': str(escalation)[:200]},
                expected_condition='escalation_clause contains a specific mechanism or percentage',
            )
        return RuleEvaluation(
            rule_id='R2',
            rule_name='Defined rent escalation clause',
            result='UNDETERMINED',
            reason='Escalation clause present but cannot determine if it is sufficiently specific.',
            evaluated_value={'escalation_clause': str(escalation)[:200]},
            expected_condition='escalation_clause contains a specific mechanism or percentage',
        )

    def _check_r3(self, fields: dict) -> RuleEvaluation:
        start = self._get_date(fields, 'start_date')
        end = self._get_date(fields, 'end_date')

        if not start or not end:
            return RuleEvaluation(
                rule_id='R3',
                rule_name='Fixed term <= 36 months',
                result='UNDETERMINED',
                reason='Start or end date not available to calculate term length.',
                evaluated_value=None,
                expected_condition='term_months <= 36',
            )
        months = (end.year - start.year) * 12 + (end.month - start.month)
        max_months = int(self._config('R3', 'max_term_months', 36))
        if months <= max_months:
            return RuleEvaluation(
                rule_id='R3',
                rule_name='Fixed term <= 36 months',
                result='PASS',
                reason=f'Term is {months} months, within the {max_months}-month limit.',
                evaluated_value={'term_months': months, 'max_term_months': max_months},
                expected_condition='term_months <= 36',
            )
        return RuleEvaluation(
            rule_id='R3',
            rule_name='Fixed term <= 36 months',
            result='FAIL',
            reason=f'Term is {months} months, exceeding the {max_months}-month maximum without owner approval.',
            evaluated_value={'term_months': months, 'max_term_months': max_months},
            expected_condition='term_months <= 36',
        )

    def _check_r4(self, fields: dict) -> RuleEvaluation:
        start = self._get_date(fields, 'start_date')
        end = self._get_date(fields, 'end_date')

        if not start or not end:
            return RuleEvaluation(
                rule_id='R4',
                rule_name='Date consistency',
                result='UNDETERMINED',
                reason='Start or end date not available.',
                evaluated_value=None,
                expected_condition='end_date > start_date',
            )
        if end <= start:
            return RuleEvaluation(
                rule_id='R4',
                rule_name='Date consistency',
                result='FAIL',
                reason=f'End date ({end}) is not after start date ({start}).',
                evaluated_value={'start_date': str(start), 'end_date': str(end)},
                expected_condition='end_date > start_date',
            )
        return RuleEvaluation(
            rule_id='R4',
            rule_name='Date consistency',
            result='PASS',
            reason=f'End date ({end}) is after start date ({start}).',
            evaluated_value={'start_date': str(start), 'end_date': str(end)},
            expected_condition='end_date > start_date',
        )

    def _check_r5(self, fields: dict) -> RuleEvaluation:
        tenant = fields.get('tenant_name')
        landlord = fields.get('landlord_name')
        tenant_signed = fields.get('tenant_signed')
        landlord_signed = fields.get('landlord_signed')

        missing = []
        if not tenant or tenant == 'NOT_FOUND':
            missing.append('tenant_name')
        if not landlord or landlord == 'NOT_FOUND':
            missing.append('landlord_name')

        if missing:
            return RuleEvaluation(
                rule_id='R5',
                rule_name='Both parties identified and signed',
                result='UNDETERMINED',
                reason=f'Missing: {", ".join(missing)}.',
                evaluated_value={'tenant': tenant, 'landlord': landlord},
                expected_condition='landlord.present AND tenant.present AND both signed',
            )

        both_signed = bool(tenant_signed) and bool(landlord_signed)
        if both_signed:
            return RuleEvaluation(
                rule_id='R5',
                rule_name='Both parties identified and signed',
                result='PASS',
                reason='Both landlord and tenant are identified and signature indicators found.',
                evaluated_value={'tenant': tenant, 'landlord': landlord, 'signatures_detected': True},
                expected_condition='landlord.present AND tenant.present AND both signed',
            )
        return RuleEvaluation(
            rule_id='R5',
            rule_name='Both parties identified and signed',
            result='UNDETERMINED',
            reason='Parties identified but signature indicators not clearly detected. Manual review required.',
            evaluated_value={'tenant': tenant, 'landlord': landlord, 'signatures_detected': False},
            expected_condition='landlord.present AND tenant.present AND both signed',
        )

    def _check_r6(self, fields: dict) -> RuleEvaluation:
        monthly = self._get_float(fields, 'rent_amount')
        annual = self._get_float(fields, 'annual_rent')

        if monthly is None or annual is None:
            return RuleEvaluation(
                rule_id='R6',
                rule_name='Annual rent = monthly * 12',
                result='UNDETERMINED',
                reason='Monthly or annual rent not available.',
                evaluated_value={'monthly': monthly, 'annual': annual},
                expected_condition='annual_rent == monthly_rent * 12',
            )
        expected_annual = round(monthly * 12, 2)
        tolerance = self._config('R6', 'tolerance_pct', 2.0) / 100.0
        if abs(annual - expected_annual) <= expected_annual * tolerance:
            return RuleEvaluation(
                rule_id='R6',
                rule_name='Annual rent = monthly * 12',
                result='PASS',
                reason=f'Annual rent ({annual}) reconciles with monthly ({monthly}) x 12 = {expected_annual}.',
                evaluated_value={'monthly': monthly, 'annual': annual, 'expected_annual': expected_annual},
                expected_condition='annual_rent == monthly_rent * 12',
            )
        return RuleEvaluation(
            rule_id='R6',
            rule_name='Annual rent = monthly * 12',
            result='FAIL',
            reason=f'Annual rent ({annual}) does not match monthly ({monthly}) x 12 = {expected_annual}.',
            evaluated_value={'monthly': monthly, 'annual': annual, 'expected_annual': expected_annual},
            expected_condition='annual_rent == monthly_rent * 12',
        )

    def _check_r7(self, fields: dict) -> RuleEvaluation:
        from apps.units.models import Unit, OccupancyStatus

        unit_id = fields.get('unit_id')
        if not unit_id or unit_id == 'NOT_FOUND':
            return RuleEvaluation(
                rule_id='R7',
                rule_name='Unit exists and is available',
                result='UNDETERMINED',
                reason='No unit identifier extracted from the document.',
                evaluated_value=None,
                expected_condition='unit_id exists AND unit.status == available',
            )
        try:
            unit = Unit.objects.get(external_unit_id__iexact=str(unit_id).strip())
        except Unit.DoesNotExist:
            return RuleEvaluation(
                rule_id='R7',
                rule_name='Unit exists and is available',
                result='FAIL',
                reason=f'Unit "{unit_id}" not found in property records.',
                evaluated_value={'unit_id': unit_id},
                expected_condition='unit_id exists AND unit.status == available',
            )
        except Unit.MultipleObjectsReturned:
            return RuleEvaluation(
                rule_id='R7',
                rule_name='Unit exists and is available',
                result='UNDETERMINED',
                reason=f'Multiple units matched "{unit_id}". Ambiguous match.',
                evaluated_value={'unit_id': unit_id},
                expected_condition='unit_id exists AND unit.status == available',
            )

        if unit.occupancy_status == OccupancyStatus.AVAILABLE:
            return RuleEvaluation(
                rule_id='R7',
                rule_name='Unit exists and is available',
                result='PASS',
                reason=f'Unit {unit.external_unit_id} exists and is currently available.',
                evaluated_value={'unit_id': unit_id, 'status': unit.occupancy_status},
                expected_condition='unit_id exists AND unit.status == available',
            )
        return RuleEvaluation(
            rule_id='R7',
            rule_name='Unit exists and is available',
            result='FAIL',
            reason=f'Unit {unit.external_unit_id} exists but is currently {unit.occupancy_status}, not available.',
            evaluated_value={'unit_id': unit_id, 'status': unit.occupancy_status},
            expected_condition='unit_id exists AND unit.status == available',
        )
