from django.db import models
from django.utils import timezone


class ProcessingStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    PROCESSING = 'processing', 'Processing'
    COMPLETED = 'completed', 'Completed'
    FAILED = 'failed', 'Failed'


class ApprovalStatus(models.TextChoices):
    PENDING_REVIEW = 'pending_review', 'Pending Review'
    APPROVED = 'approved', 'Approved'
    REJECTED = 'rejected', 'Rejected'


class ReviewStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    APPROVED = 'approved', 'Approved'
    REJECTED = 'rejected', 'Rejected'
    NEEDS_CORRECTION = 'needs_correction', 'Needs Correction'


class FlagSeverity(models.TextChoices):
    LOW = 'low', 'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH = 'high', 'High'
    CRITICAL = 'critical', 'Critical'


class FlagStatus(models.TextChoices):
    OPEN = 'open', 'Open'
    ACKNOWLEDGED = 'acknowledged', 'Acknowledged'
    RESOLVED = 'resolved', 'Resolved'
    DISMISSED = 'dismissed', 'Dismissed'


class Lease(models.Model):
    unit = models.ForeignKey(
        'units.Unit', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='leases'
    )
    tenant_name = models.CharField(max_length=255, blank=True)
    landlord_name = models.CharField(max_length=255, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    rent_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, blank=True)
    rent_frequency = models.CharField(max_length=20, blank=True)
    deposit_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    annual_rent = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    escalation_clause = models.TextField(blank=True)
    renewal_terms = models.TextField(blank=True)
    termination_terms = models.TextField(blank=True)
    extracted_unit_id = models.CharField(max_length=100, blank=True)

    document = models.FileField(upload_to='leases/documents/')
    # Full plain text extracted from the PDF — powers the AI lease Q&A endpoint.
    extracted_text = models.TextField(null=True, blank=True)
    processing_status = models.CharField(
        max_length=20, choices=ProcessingStatus.choices, default=ProcessingStatus.PENDING
    )
    approval_status = models.CharField(
        max_length=20, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING_REVIEW
    )
    processing_started_at = models.DateTimeField(null=True, blank=True)
    processing_completed_at = models.DateTimeField(null=True, blank=True)
    provider_used = models.CharField(max_length=50, blank=True)
    processing_error = models.TextField(blank=True)
    retry_count = models.IntegerField(default=0)
    is_cancelled = models.BooleanField(default=False)
    cancel_reason = models.TextField(blank=True)
    cancelled_by = models.CharField(max_length=255, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Lease #{self.id} — {self.tenant_name or "unprocessed"}'


class LeaseField(models.Model):
    """
    Stores any extracted field — both predefined business fields and dynamically
    discovered fields. New field types never require a schema migration; only
    a new field_name string is needed.
    """
    lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name='fields')
    field_name = models.CharField(max_length=100)
    display_label = models.CharField(max_length=200, blank=True)
    data_type = models.CharField(max_length=30, blank=True)
    category = models.CharField(max_length=50, blank=True)
    extracted_value = models.JSONField()
    normalized_value = models.JSONField(null=True, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    source_page = models.IntegerField(null=True, blank=True)
    source_text = models.TextField(blank=True)
    source_location = models.JSONField(null=True, blank=True)
    extraction_method = models.CharField(max_length=50, blank=True)
    has_contradiction = models.BooleanField(default=False)
    contradiction_note = models.TextField(blank=True)
    review_status = models.CharField(
        max_length=20, choices=ReviewStatus.choices, default=ReviewStatus.PENDING
    )
    reviewed_value = models.JSONField(null=True, blank=True)
    reviewed_by = models.CharField(max_length=255, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('lease', 'field_name')]

    def __str__(self):
        return f'{self.lease_id} / {self.field_name}'


class LeaseClause(models.Model):
    """Dynamically discovered lease clauses beyond the predefined schema."""

    class SourceType(models.TextChoices):
        EXPLICIT = 'explicit', 'Explicit document statement'
        INTERPRETED = 'interpreted', 'AI interpretation'
        INFERRED = 'inferred', 'Inferred from context'

    lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name='clauses')
    clause_type = models.CharField(max_length=100)
    title = models.CharField(max_length=255)
    raw_text = models.TextField()
    interpretation = models.TextField(blank=True)
    source_type = models.CharField(max_length=20, choices=SourceType.choices, default=SourceType.EXPLICIT)
    source_page = models.IntegerField(null=True, blank=True)
    source_text = models.TextField(blank=True)
    confidence = models.FloatField(null=True, blank=True)
    is_unusual = models.BooleanField(default=False)
    unusual_reason = models.TextField(blank=True)
    extra_data = models.JSONField(default=dict, blank=True)
    review_status = models.CharField(
        max_length=20, choices=ReviewStatus.choices, default=ReviewStatus.PENDING
    )
    reviewed_by = models.CharField(max_length=255, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.clause_type}: {self.title}'


class LeaseFlag(models.Model):
    lease = models.ForeignKey(Lease, on_delete=models.CASCADE, related_name='flags')
    flag_type = models.CharField(max_length=50)
    severity = models.CharField(max_length=10, choices=FlagSeverity.choices)
    description = models.TextField()
    related_fields = models.JSONField(default=list)
    source_reference = models.TextField(blank=True)
    status = models.CharField(
        max_length=20, choices=FlagStatus.choices, default=FlagStatus.OPEN
    )
    reviewer_comment = models.TextField(blank=True)
    reviewed_by = models.CharField(max_length=255, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'{self.flag_type} on Lease #{self.lease_id}'
