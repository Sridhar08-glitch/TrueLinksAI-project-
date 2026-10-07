from django.db import models


class RuleResult(models.TextChoices):
    PASS = 'PASS', 'Pass'
    FAIL = 'FAIL', 'Fail'
    UNDETERMINED = 'UNDETERMINED', 'Undetermined'


class RuleSeverity(models.TextChoices):
    LOW = 'low', 'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH = 'high', 'High'


class RuleTemplate(models.TextChoices):
    NUMBER_COMPARE = 'number_compare', 'Field compared to a number'
    FIELD_COMPARE = 'field_compare', 'Field compared to another field'
    REQUIRED_FIELD = 'required_field', 'Field must be present'
    DATE_ORDER = 'date_order', 'Date must be after another date'
    TEXT_CHECK = 'text_check', 'Text must / must not contain words'
    TERM_LENGTH = 'term_length', 'Lease term length (months) compared to a number'
    ALLOWED_VALUES = 'allowed_values', 'Field must be one of a list of values'
    # Always evaluates UNDETERMINED: the requirement appears on every lease's
    # scorecard for a human to verify (and override) — policy statements that
    # no automated check can express still become enforceable rules.
    MANUAL_CHECK = 'manual_check', 'Manual check — a human verifies on every lease'


class CustomRule(models.Model):
    """An owner-authored rule, composed from a fixed template.

    Owners pick a template and fill in parameters (field, operator, value) —
    the evaluation logic for each template lives in custom_rule_engine.py.
    Nothing an owner enters is ever executed as code.
    """
    description = models.CharField(max_length=500)
    template = models.CharField(max_length=20, choices=RuleTemplate.choices)
    # Blank for manual_check rules, which reference no extracted field.
    field_name = models.CharField(max_length=100, blank=True)
    # gte/lte/eq (number & field compare) · must_contain/must_not_contain (text)
    operator = models.CharField(max_length=20, blank=True)
    compare_field = models.CharField(max_length=100, blank=True)
    number_value = models.FloatField(null=True, blank=True)
    factor = models.FloatField(default=1.0)
    text_value = models.CharField(max_length=500, blank=True)
    severity = models.CharField(
        max_length=10, choices=RuleSeverity.choices, default=RuleSeverity.MEDIUM
    )
    enabled = models.BooleanField(default=True)
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def rule_id(self) -> str:
        # Owner rules continue the numbering after the 7 ruleset rules.
        return f'R{7 + self.pk}'

    def __str__(self):
        return f'{self.rule_id}: {self.description[:60]}'


class ProposalType(models.TextChoices):
    # Adjust a built-in rule's thresholds/severity (R1–R7).
    RULE_UPDATE = 'rule_update', 'Update a built-in rule'
    # Create a new template-based custom rule (R8+).
    CUSTOM_RULE = 'custom_rule', 'New custom rule'
    # Understood, but no safe template can automate it — a developer must add the check.
    NEEDS_DEVELOPER = 'needs_developer', 'Needs a developer'


class ProposalStatus(models.TextChoices):
    PENDING = 'pending', 'Pending review'
    APPROVED = 'approved', 'Approved'
    REJECTED = 'rejected', 'Rejected'


class RuleProposal(models.Model):
    """A rule proposed by the policy-import agent, awaiting the owner's decision.

    Proposals are extracted from an uploaded policy document (or ruleset JSON)
    and mapped onto safe structures only: threshold updates for R1–R7, or
    template parameters for a new custom rule. Nothing from the document is
    ever executed; a proposal that fits no template becomes NEEDS_DEVELOPER.
    """
    source_filename = models.CharField(max_length=255)
    source_quote = models.TextField(blank=True)
    source_page = models.IntegerField(null=True, blank=True)
    proposal_type = models.CharField(max_length=20, choices=ProposalType.choices)
    description = models.CharField(max_length=500)
    confidence = models.FloatField(default=0.0)

    # RULE_UPDATE: which built-in rule, and the validated changes to apply.
    target_rule_id = models.CharField(max_length=10, blank=True)
    config_changes = models.JSONField(null=True, blank=True)

    # CUSTOM_RULE: the template parameters (same shape as CustomRule).
    template = models.CharField(max_length=20, choices=RuleTemplate.choices, blank=True)
    field_name = models.CharField(max_length=100, blank=True)
    operator = models.CharField(max_length=20, blank=True)
    compare_field = models.CharField(max_length=100, blank=True)
    number_value = models.FloatField(null=True, blank=True)
    factor = models.FloatField(default=1.0)
    text_value = models.CharField(max_length=500, blank=True)
    severity = models.CharField(
        max_length=10, choices=RuleSeverity.choices, default=RuleSeverity.MEDIUM
    )

    status = models.CharField(
        max_length=10, choices=ProposalStatus.choices, default=ProposalStatus.PENDING
    )
    decided_by = models.CharField(max_length=255, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)
    # Set when an approved CUSTOM_RULE proposal creates its rule.
    created_rule = models.ForeignKey(
        CustomRule, null=True, blank=True, on_delete=models.SET_NULL, related_name='proposals'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Proposal #{self.pk} ({self.proposal_type}): {self.description[:60]}'


class ValidationResult(models.Model):
    lease = models.ForeignKey(
        'leases.Lease', on_delete=models.CASCADE, related_name='validations'
    )
    rule_id = models.CharField(max_length=10)
    rule_name = models.CharField(max_length=255)
    result = models.CharField(max_length=15, choices=RuleResult.choices)
    reason = models.TextField()
    evaluated_value = models.JSONField(null=True, blank=True)
    expected_condition = models.CharField(max_length=512)
    severity = models.CharField(
        max_length=10, choices=RuleSeverity.choices, default=RuleSeverity.MEDIUM
    )
    # Human override of a FAIL/UNDETERMINED result — the rule outcome is
    # preserved; the override records the reviewer's decision and why.
    is_overridden = models.BooleanField(default=False)
    override_reason = models.TextField(blank=True)
    overridden_by = models.CharField(max_length=255, blank=True)
    overridden_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.rule_id}: {self.result} on Lease #{self.lease_id}'
