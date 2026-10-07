from django.db import models


class WorkOrderPriority(models.TextChoices):
    LOW = 'low', 'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH = 'high', 'High'
    URGENT = 'urgent', 'Urgent'


class WorkOrderStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    PENDING_APPROVAL = 'pending_approval', 'Pending Approval'
    APPROVED = 'approved', 'Approved'
    REJECTED = 'rejected', 'Rejected'
    IN_PROGRESS = 'in_progress', 'In Progress'
    COMPLETED = 'completed', 'Completed'


class WorkOrder(models.Model):
    unit = models.ForeignKey('units.Unit', on_delete=models.PROTECT, related_name='work_orders')
    inspection = models.ForeignKey(
        'inspections.Inspection', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='work_orders'
    )
    finding = models.ForeignKey(
        'inspections.InspectionFinding', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='work_orders'
    )
    title = models.CharField(max_length=255)
    description = models.TextField()
    priority = models.CharField(max_length=10, choices=WorkOrderPriority.choices, default=WorkOrderPriority.MEDIUM)
    status = models.CharField(max_length=20, choices=WorkOrderStatus.choices, default=WorkOrderStatus.DRAFT)
    generated_by = models.CharField(max_length=50, default='ai_agent')
    assigned_to = models.ForeignKey(
        'auth.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_work_orders'
    )
    assigned_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.CharField(max_length=255, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.CharField(max_length=255, null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'WO#{self.id}: {self.title}'
