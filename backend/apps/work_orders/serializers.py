from rest_framework import serializers
from .models import WorkOrder


class WorkOrderSerializer(serializers.ModelSerializer):
    unit_label = serializers.CharField(source='unit.label', read_only=True)
    unit_external_id = serializers.CharField(source='unit.external_unit_id', read_only=True)
    inspection_id = serializers.IntegerField(source='inspection.id', read_only=True, default=None)
    inspection_images = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()
    assigned_to_email = serializers.SerializerMethodField()

    def get_inspection_images(self, obj):
        if not obj.inspection_id:
            return []
        from apps.common.media import build_signed_media_url
        request = self.context.get('request')
        return [
            {
                'id': img.id,
                'url': build_signed_media_url(img.image.url, request),
                'original_filename': img.original_filename,
            }
            for img in obj.inspection.images.all()
            if img.image
        ]

    class Meta:
        model = WorkOrder
        fields = [
            'id', 'unit', 'unit_label', 'unit_external_id',
            'inspection_id', 'inspection_images', 'finding',
            'title', 'description', 'priority', 'status',
            'generated_by', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at', 'rejection_reason',
            'assigned_to', 'assigned_to_name', 'assigned_to_email', 'assigned_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'status', 'generated_by', 'approved_by', 'approved_at',
            'rejected_by', 'rejected_at',
            'assigned_to_name', 'assigned_to_email', 'assigned_at',
            'created_at', 'updated_at',
        ]

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.get_full_name() or obj.assigned_to.username
        return None

    def get_assigned_to_email(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.email
        return None


class WorkOrderCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkOrder
        fields = ['unit', 'title', 'description', 'priority']


class WorkOrderUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkOrder
        fields = ['title', 'description', 'priority']


class WorkOrderRejectSerializer(serializers.Serializer):
    rejection_reason = serializers.CharField(min_length=1)


class WorkOrderBulkActionSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), min_length=1)
    rejection_reason = serializers.CharField(required=False, allow_blank=True)
