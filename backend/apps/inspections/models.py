from django.db import models


class ReporterType(models.TextChoices):
    TENANT = 'tenant', 'Tenant'
    INSPECTOR = 'inspector', 'Inspector'
    OWNER = 'owner', 'Owner'


class InspectionStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    ANALYZING = 'analyzing', 'Analyzing'
    COMPLETED = 'completed', 'Completed'
    FAILED = 'failed', 'Failed'


class FindingCategory(models.TextChoices):
    DAMAGE = 'damage', 'Damage'
    EQUIPMENT = 'equipment', 'Equipment'
    FIXTURE = 'fixture', 'Fixture'
    GENERAL = 'general', 'General Condition'


class FindingReviewStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    CONFIRMED = 'confirmed', 'Confirmed'
    DISMISSED = 'dismissed', 'Dismissed'


class Inspection(models.Model):
    unit = models.ForeignKey('units.Unit', on_delete=models.PROTECT, related_name='inspections')
    reporter_type = models.CharField(max_length=20, choices=ReporterType.choices)
    description = models.TextField(blank=True)
    # When set, this inspection documents the state of a unit for a work order
    # (an "after" verification inspection).
    work_order = models.ForeignKey(
        'work_orders.WorkOrder', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='verification_inspections'
    )
    status = models.CharField(max_length=20, choices=InspectionStatus.choices, default=InspectionStatus.PENDING)
    is_deleted = models.BooleanField(default=False)
    analyzed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Inspection #{self.id} — Unit {self.unit.external_unit_id}'


class InspectionSchedule(models.Model):
    """Recurring inspection plan for a unit. run-now creates the Inspection and
    advances next_due_date by frequency_months."""
    unit = models.ForeignKey('units.Unit', on_delete=models.CASCADE, related_name='inspection_schedules')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    frequency_months = models.PositiveSmallIntegerField(default=3)
    next_due_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.title} — Unit {self.unit_id} every {self.frequency_months}mo'


class InspectionImage(models.Model):
    inspection = models.ForeignKey(Inspection, on_delete=models.CASCADE, related_name='images')
    image = models.ImageField(upload_to='inspections/images/')
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.original_filename


class InspectionFinding(models.Model):
    inspection = models.ForeignKey(Inspection, on_delete=models.CASCADE, related_name='findings')
    image = models.ForeignKey(
        InspectionImage, null=True, blank=True, on_delete=models.SET_NULL, related_name='findings'
    )
    category = models.CharField(max_length=20, choices=FindingCategory.choices)
    equipment_name = models.CharField(max_length=255, blank=True)
    condition = models.CharField(max_length=50, blank=True)
    damage_description = models.TextField(blank=True)
    confidence = models.FloatField(null=True, blank=True)
    evidence = models.TextField(blank=True)
    review_status = models.CharField(
        max_length=20, choices=FindingReviewStatus.choices, default=FindingReviewStatus.PENDING
    )

    def __str__(self):
        return f'{self.category} finding on Inspection #{self.inspection_id}'
