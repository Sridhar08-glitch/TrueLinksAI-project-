from django.db import models


class AuditEvent(models.Model):
    entity_type = models.CharField(max_length=50)
    entity_id = models.BigIntegerField()
    action = models.CharField(max_length=100)
    actor = models.CharField(max_length=255)
    previous_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['timestamp']),
        ]

    def __str__(self):
        return f'{self.action} on {self.entity_type}#{self.entity_id} by {self.actor}'
