from django.db import models


class OccupancyStatus(models.TextChoices):
    AVAILABLE = 'available', 'Available'
    OCCUPIED = 'occupied', 'Occupied'
    MAINTENANCE = 'maintenance', 'Under Maintenance'
    ARCHIVED = 'archived', 'Archived'


class Unit(models.Model):
    external_unit_id = models.CharField(max_length=50, unique=True)
    building = models.ForeignKey(
        'properties.Building', on_delete=models.PROTECT, related_name='units'
    )
    label = models.CharField(max_length=100)
    unit_type = models.CharField(max_length=20)
    bedrooms = models.IntegerField(null=True, blank=True)
    bathrooms = models.IntegerField(null=True, blank=True)
    area_sqm = models.DecimalField(max_digits=8, decimal_places=2)
    parking_bay = models.CharField(max_length=20, blank=True)
    floor_number = models.IntegerField(null=True, blank=True)
    occupancy_status = models.CharField(
        max_length=20, choices=OccupancyStatus.choices, default=OccupancyStatus.AVAILABLE
    )
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.external_unit_id} — {self.label}'

    def has_active_lease(self):
        return self.leases.filter(approval_status='approved', is_cancelled=False).exists()

    def has_open_work_orders(self):
        return self.work_orders.exclude(status__in=['completed', 'rejected']).exists()


class NotificationRead(models.Model):
    """Persists which synthesized notifications a user has marked as read."""
    user = models.ForeignKey('auth.User', on_delete=models.CASCADE, related_name='notification_reads')
    notification_key = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'notification_key')]

    def __str__(self):
        return f'{self.user_id} read {self.notification_key}'
