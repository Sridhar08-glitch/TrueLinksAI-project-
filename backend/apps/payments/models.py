from datetime import date

from django.db import models


class PaymentStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    PAID = 'paid', 'Paid'
    OVERDUE = 'overdue', 'Overdue'


class PaymentScheduleItem(models.Model):
    """
    One expected rent payment for a lease. Overdue is COMPUTED, not cron-driven:
    a stored 'pending' item whose due_date is in the past is treated as overdue
    by queries and serializers (see effective_status / overdue_q).
    """
    lease = models.ForeignKey(
        'leases.Lease', on_delete=models.CASCADE, related_name='payments'
    )
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10, blank=True)
    status = models.CharField(
        max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    payment_method = models.CharField(max_length=100, blank=True)
    recorded_by = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('lease', 'due_date')]
        ordering = ['due_date']
        indexes = [
            models.Index(fields=['status'], name='payments_item_status_idx'),
            models.Index(fields=['due_date'], name='payments_item_due_date_idx'),
        ]

    def __str__(self):
        return f'Payment for lease #{self.lease_id} due {self.due_date}'

    @property
    def effective_status(self) -> str:
        """pending items past their due date are overdue."""
        if self.status == PaymentStatus.PENDING and self.due_date < date.today():
            return PaymentStatus.OVERDUE
        return self.status

    @staticmethod
    def overdue_q(today=None):
        """Q filter matching items that should be treated as overdue."""
        today = today or date.today()
        return (
            models.Q(status=PaymentStatus.OVERDUE)
            | models.Q(status=PaymentStatus.PENDING, due_date__lt=today)
        )
