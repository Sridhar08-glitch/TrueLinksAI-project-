"""Evaluates owner-authored CustomRule records against extracted lease fields.

Each rule is an instance of a fixed template; the logic here is written and
tested once, and owners only supply parameters (field, operator, value).
Results use the same RuleEvaluation shape as the built-in R1–R7 rules, so
they flow through the same storage, review UI, and override workflow.
"""
import re
from datetime import date
from typing import Optional

from .validation_engine import RuleEvaluation

# Fields owners can reference, with display labels for the rule-builder UI.
RULE_FIELDS = [
    ('rent_amount', 'Monthly rent'),
    ('deposit_amount', 'Security deposit'),
    ('annual_rent', 'Annual rent'),
    ('start_date', 'Start date'),
    ('end_date', 'End date'),
    ('tenant_name', 'Tenant name'),
    ('landlord_name', 'Landlord name'),
    ('unit_id', 'Unit reference'),
    ('currency', 'Currency'),
    ('rent_frequency', 'Rent frequency'),
    ('escalation_clause', 'Escalation clause'),
    ('renewal_terms', 'Renewal terms'),
    ('termination_terms', 'Termination terms'),
]

_FIELD_LABELS = dict(RULE_FIELDS)
_OPERATOR_TEXT = {'gte': 'at least', 'lte': 'at most', 'eq': 'exactly'}


def _label(field_name: str) -> str:
    return _FIELD_LABELS.get(field_name, field_name)


def _raw(fields: dict, key: str):
    value = fields.get(key)
    if value is None or value == 'NOT_FOUND' or value == '':
        return None
    return value


def _num(fields: dict, key: str) -> Optional[float]:
    value = _raw(fields, key)
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _date(fields: dict, key: str) -> Optional[date]:
    value = _raw(fields, key)
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def evaluate_custom_rules(fields: dict) -> list[RuleEvaluation]:
    from django.db import Error as DatabaseError
    from apps.validation.models import CustomRule
    try:
        rules = list(CustomRule.objects.filter(enabled=True).order_by('id'))
    except (DatabaseError, RuntimeError):
        # Custom rules are an optional layer on top of R1–R7; without database
        # access (e.g. pure-engine unit tests) the built-in rules still run.
        return []
    return [_evaluate(rule, fields) for rule in rules]


def _evaluate(rule, fields: dict) -> RuleEvaluation:
    evaluators = {
        'number_compare': _eval_number_compare,
        'field_compare': _eval_field_compare,
        'required_field': _eval_required_field,
        'date_order': _eval_date_order,
        'text_check': _eval_text_check,
        'term_length': _eval_term_length,
        'allowed_values': _eval_allowed_values,
        'manual_check': _eval_manual_check,
    }
    evaluator = evaluators.get(rule.template)
    if evaluator is None:
        return _result(rule, 'UNDETERMINED', f'Unknown rule template "{rule.template}".', None, '')
    return evaluator(rule, fields)


def _result(rule, result: str, reason: str, evaluated_value, condition: str) -> RuleEvaluation:
    return RuleEvaluation(
        rule_id=rule.rule_id,
        rule_name=rule.description[:255],
        result=result,
        reason=reason,
        evaluated_value=evaluated_value,
        expected_condition=condition[:512],
        severity=rule.severity,
    )


def _eval_number_compare(rule, fields: dict) -> RuleEvaluation:
    condition = f'{rule.field_name} {rule.operator} {rule.number_value:g}'
    value = _num(fields, rule.field_name)
    if value is None:
        return _result(rule, 'UNDETERMINED',
                       f'{_label(rule.field_name)} could not be extracted as a number.',
                       None, condition)
    passed = {
        'gte': value >= rule.number_value,
        'lte': value <= rule.number_value,
        'eq': abs(value - rule.number_value) < 0.01,
    }.get(rule.operator, False)
    word = _OPERATOR_TEXT.get(rule.operator, rule.operator)
    if passed:
        reason = f'{_label(rule.field_name)} ({value:g}) is {word} {rule.number_value:g}.'
    else:
        reason = f'{_label(rule.field_name)} ({value:g}) is not {word} {rule.number_value:g}.'
    return _result(rule, 'PASS' if passed else 'FAIL', reason,
                   {rule.field_name: value, 'required': rule.number_value}, condition)


def _eval_field_compare(rule, fields: dict) -> RuleEvaluation:
    factor = rule.factor or 1.0
    condition = f'{rule.field_name} {rule.operator} {rule.compare_field} * {factor:g}'
    left = _num(fields, rule.field_name)
    right = _num(fields, rule.compare_field)
    if left is None or right is None:
        return _result(rule, 'UNDETERMINED',
                       f'{_label(rule.field_name)} or {_label(rule.compare_field)} could not be extracted as a number.',
                       {rule.field_name: left, rule.compare_field: right}, condition)
    target = right * factor
    passed = {
        'gte': left >= target,
        'lte': left <= target,
        'eq': abs(left - target) < 0.01,
    }.get(rule.operator, False)
    word = _OPERATOR_TEXT.get(rule.operator, rule.operator)
    factor_text = '' if factor == 1.0 else f' × {factor:g}'
    if passed:
        reason = (f'{_label(rule.field_name)} ({left:g}) is {word} '
                  f'{_label(rule.compare_field)}{factor_text} ({target:g}).')
    else:
        reason = (f'{_label(rule.field_name)} ({left:g}) is not {word} '
                  f'{_label(rule.compare_field)}{factor_text} ({target:g}).')
    return _result(rule, 'PASS' if passed else 'FAIL', reason,
                   {rule.field_name: left, rule.compare_field: right, 'factor': factor}, condition)


def _eval_required_field(rule, fields: dict) -> RuleEvaluation:
    condition = f'{rule.field_name} is present'
    value = _raw(fields, rule.field_name)
    if value is None:
        return _result(rule, 'FAIL',
                       f'{_label(rule.field_name)} is missing from the document.',
                       None, condition)
    return _result(rule, 'PASS',
                   f'{_label(rule.field_name)} is present.',
                   {rule.field_name: str(value)[:200]}, condition)


def _eval_date_order(rule, fields: dict) -> RuleEvaluation:
    condition = f'{rule.field_name} > {rule.compare_field}'
    later = _date(fields, rule.field_name)
    earlier = _date(fields, rule.compare_field)
    if later is None or earlier is None:
        return _result(rule, 'UNDETERMINED',
                       f'{_label(rule.field_name)} or {_label(rule.compare_field)} could not be parsed as a date.',
                       None, condition)
    if later > earlier:
        reason = f'{_label(rule.field_name)} ({later}) is after {_label(rule.compare_field)} ({earlier}).'
        return _result(rule, 'PASS', reason, {rule.field_name: str(later), rule.compare_field: str(earlier)}, condition)
    reason = f'{_label(rule.field_name)} ({later}) is not after {_label(rule.compare_field)} ({earlier}).'
    return _result(rule, 'FAIL', reason, {rule.field_name: str(later), rule.compare_field: str(earlier)}, condition)


def _eval_term_length(rule, fields: dict) -> RuleEvaluation:
    """Lease term in whole months (start_date → end_date) compared to a number."""
    condition = f'term_months {rule.operator} {rule.number_value:g}'
    start = _date(fields, 'start_date')
    end = _date(fields, 'end_date')
    if start is None or end is None:
        return _result(rule, 'UNDETERMINED',
                       'Start or end date could not be parsed, so the term length is unknown.',
                       None, condition)
    # A lease 2026-11-01 → 2027-10-31 is an 11-month gap but a 12-month term in
    # common usage; count any partial final month as a full month.
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day > start.day:
        months += 1
    passed = {
        'gte': months >= rule.number_value,
        'lte': months <= rule.number_value,
        'eq': months == rule.number_value,
    }.get(rule.operator, False)
    word = _OPERATOR_TEXT.get(rule.operator, rule.operator)
    if passed:
        reason = f'Lease term is {months} month(s), which is {word} {rule.number_value:g}.'
    else:
        reason = f'Lease term is {months} month(s), which is not {word} {rule.number_value:g}.'
    return _result(rule, 'PASS' if passed else 'FAIL', reason,
                   {'term_months': months, 'required': rule.number_value}, condition)


# Words too generic to identify a manual-check topic in a lease document.
_EVIDENCE_STOPWORDS = {
    'must', 'shall', 'should', 'required', 'require', 'requires', 'with',
    'without', 'prior', 'written', 'approval', 'permitted', 'allowed',
    'prohibited', 'lease', 'leased', 'premises', 'tenant', 'landlord',
    'owner', 'owners', 'their', 'provide', 'every', 'from', 'this', 'that',
    'covering', 'full', 'term', 'terms', 'rent', 'rents', 'month', 'months',
}


def _eval_manual_check(rule, fields: dict) -> RuleEvaluation:
    """A policy requirement no automated check can express.

    Always UNDETERMINED so it lands in the human review queue on every lease —
    but the document text is scanned for wording related to the requirement,
    and any match is quoted in the reason so the reviewer knows where to look.
    """
    evidence = _find_manual_evidence(rule.description, fields)
    if evidence:
        reason = (
            f'Requires manual verification: {rule.description} '
            f'— This lease contains possibly relevant text: "{evidence}". '
            f'Review it and record your decision with Override.'
        )
    else:
        reason = (
            f'Requires manual verification: {rule.description} '
            f'— No related wording was found in this lease document. '
            f'Check the document and record your decision with Override.'
        )
    return _result(
        rule, 'UNDETERMINED', reason,
        {'evidence': evidence or None}, 'human verifies this requirement',
    )


def _find_manual_evidence(description: str, fields: dict) -> str:
    """Find a document snippet related to the requirement's distinctive words."""
    text = str(fields.get('_document_text') or '')
    if not text:
        return ''
    words = [w for w in re.findall(r'[a-z]{4,}', description.lower())
             if w not in _EVIDENCE_STOPWORDS]
    # Most specific (longest) words first: "certificate" before "pets" before "paid".
    words.sort(key=len, reverse=True)
    lowered = text.lower()
    for word in words:
        idx = lowered.find(word)
        if idx != -1:
            start = max(0, idx - 60)
            snippet = ' '.join(text[start:idx + 160].split())
            return snippet[:220]
    return ''


def _eval_allowed_values(rule, fields: dict) -> RuleEvaluation:
    """Field value must match one of an owner-supplied list (case-insensitive)."""
    allowed = [t.strip() for t in rule.text_value.split(',') if t.strip()]
    condition = f'{rule.field_name} in [{", ".join(allowed)}]'
    value = _raw(fields, rule.field_name)
    if value is None:
        return _result(rule, 'UNDETERMINED',
                       f'{_label(rule.field_name)} could not be extracted.',
                       None, condition)
    text = str(value).strip().lower()
    if any(text == a.lower() for a in allowed):
        reason = f'{_label(rule.field_name)} ("{value}") is an allowed value.'
        return _result(rule, 'PASS', reason, {rule.field_name: str(value)[:200]}, condition)
    reason = f'{_label(rule.field_name)} ("{value}") is not one of: {", ".join(allowed)}.'
    return _result(rule, 'FAIL', reason, {rule.field_name: str(value)[:200]}, condition)


def _eval_text_check(rule, fields: dict) -> RuleEvaluation:
    terms = [t.strip() for t in rule.text_value.split(',') if t.strip()]
    condition = f'{rule.field_name} {rule.operator} [{", ".join(terms)}]'
    value = _raw(fields, rule.field_name)
    if value is None:
        return _result(rule, 'UNDETERMINED',
                       f'{_label(rule.field_name)} could not be extracted.',
                       None, condition)
    text = str(value).lower()
    found = [t for t in terms if t.lower() in text]
    if rule.operator == 'must_contain':
        if found:
            reason = f'{_label(rule.field_name)} mentions: {", ".join(found)}.'
            return _result(rule, 'PASS', reason, {'found': found}, condition)
        reason = f'{_label(rule.field_name)} does not mention any of: {", ".join(terms)}.'
        return _result(rule, 'FAIL', reason, {'found': []}, condition)
    # must_not_contain
    if found:
        reason = f'{_label(rule.field_name)} contains disallowed wording: {", ".join(found)}.'
        return _result(rule, 'FAIL', reason, {'found': found}, condition)
    reason = f'{_label(rule.field_name)} contains none of the disallowed wording.'
    return _result(rule, 'PASS', reason, {'found': []}, condition)
