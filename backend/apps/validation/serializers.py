from rest_framework import serializers
from .models import CustomRule, RuleProposal, RuleTemplate, ValidationResult


class ValidationResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ValidationResult
        fields = [
            'id', 'rule_id', 'rule_name', 'result', 'reason',
            'evaluated_value', 'expected_condition', 'severity',
            'is_overridden', 'override_reason', 'overridden_by', 'overridden_at',
            'created_at',
        ]


NUMERIC_OPERATORS = ('gte', 'lte', 'eq')
TEXT_OPERATORS = ('must_contain', 'must_not_contain')


class CustomRuleSerializer(serializers.ModelSerializer):
    rule_id = serializers.ReadOnlyField()

    class Meta:
        model = CustomRule
        fields = [
            'id', 'rule_id', 'description', 'template', 'field_name', 'operator',
            'compare_field', 'number_value', 'factor', 'text_value',
            'severity', 'enabled', 'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def validate(self, attrs):
        current = getattr(self, 'instance', None)

        def get(key):
            if key in attrs:
                return attrs[key]
            return getattr(current, key, None) if current else None

        template = get('template')
        operator = get('operator') or ''
        errors = {}

        if template == RuleTemplate.NUMBER_COMPARE:
            if operator not in NUMERIC_OPERATORS:
                errors['operator'] = 'Must be one of: gte, lte, eq.'
            if get('number_value') is None:
                errors['number_value'] = 'A number to compare against is required.'
        elif template == RuleTemplate.FIELD_COMPARE:
            if operator not in NUMERIC_OPERATORS:
                errors['operator'] = 'Must be one of: gte, lte, eq.'
            if not get('compare_field'):
                errors['compare_field'] = 'A second field to compare against is required.'
            factor = get('factor')
            if factor is not None and factor <= 0:
                errors['factor'] = 'Factor must be greater than zero.'
        elif template == RuleTemplate.DATE_ORDER:
            if not get('compare_field'):
                errors['compare_field'] = 'The earlier date field is required.'
        elif template == RuleTemplate.TEXT_CHECK:
            if operator not in TEXT_OPERATORS:
                errors['operator'] = 'Must be must_contain or must_not_contain.'
            if not (get('text_value') or '').strip():
                errors['text_value'] = 'At least one word or phrase is required.'
        elif template == RuleTemplate.TERM_LENGTH:
            if operator not in NUMERIC_OPERATORS:
                errors['operator'] = 'Must be one of: gte, lte, eq.'
            if get('number_value') is None:
                errors['number_value'] = 'A number of months is required.'
        elif template == RuleTemplate.ALLOWED_VALUES:
            if not (get('text_value') or '').strip():
                errors['text_value'] = 'At least one allowed value is required.'
        elif template in (RuleTemplate.REQUIRED_FIELD, RuleTemplate.MANUAL_CHECK):
            pass
        else:
            errors['template'] = 'Unknown template.'

        if template != RuleTemplate.MANUAL_CHECK and not (get('field_name') or '').strip():
            errors['field_name'] = 'A field is required.'
        if not (get('description') or '').strip():
            errors['description'] = 'A description is required.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class RuleProposalSerializer(serializers.ModelSerializer):
    created_rule_id = serializers.CharField(source='created_rule.rule_id', read_only=True, default=None)

    class Meta:
        model = RuleProposal
        fields = [
            'id', 'source_filename', 'source_quote', 'source_page',
            'proposal_type', 'description', 'confidence',
            'target_rule_id', 'config_changes',
            'template', 'field_name', 'operator', 'compare_field',
            'number_value', 'factor', 'text_value', 'severity',
            'status', 'decided_by', 'decided_at', 'decision_reason',
            'created_rule_id', 'created_at',
        ]
        read_only_fields = fields
