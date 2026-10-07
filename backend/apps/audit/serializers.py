from rest_framework import serializers
from .models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = ['id', 'entity_type', 'entity_id', 'action', 'actor',
                  'previous_value', 'new_value', 'timestamp']
