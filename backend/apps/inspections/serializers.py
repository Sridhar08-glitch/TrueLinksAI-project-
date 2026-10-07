from rest_framework import serializers
from .models import Inspection, InspectionImage, InspectionFinding, InspectionSchedule


class InspectionImageSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    class Meta:
        model = InspectionImage
        fields = ['id', 'image', 'original_filename', 'content_type', 'created_at']
        read_only_fields = ['id', 'created_at']

    def get_image(self, obj):
        if not obj.image:
            return None
        from apps.common.media import build_signed_media_url
        return build_signed_media_url(obj.image.url, self.context.get('request'))


class InspectionFindingSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionFinding
        fields = [
            'id', 'image', 'category', 'equipment_name', 'condition',
            'damage_description', 'confidence', 'evidence', 'review_status',
        ]


class InspectionFindingCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionFinding
        fields = [
            'inspection', 'image', 'category', 'equipment_name', 'condition',
            'damage_description', 'confidence', 'evidence',
        ]


class InspectionFindingUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionFinding
        fields = [
            'category', 'equipment_name', 'condition',
            'damage_description', 'confidence', 'evidence', 'review_status',
        ]


class InspectionFindingReviewSerializer(serializers.Serializer):
    review_status = serializers.ChoiceField(choices=['confirmed', 'dismissed'])
    reviewer = serializers.CharField(max_length=255, required=False, default='owner')


class InspectionSerializer(serializers.ModelSerializer):
    images = InspectionImageSerializer(many=True, read_only=True)
    findings = InspectionFindingSerializer(many=True, read_only=True)
    unit_label = serializers.CharField(source='unit.label', read_only=True)
    unit_external_id = serializers.CharField(source='unit.external_unit_id', read_only=True)

    class Meta:
        model = Inspection
        fields = [
            'id', 'unit', 'unit_label', 'unit_external_id',
            'reporter_type', 'description', 'status', 'is_deleted',
            'work_order', 'images', 'findings', 'analyzed_at', 'created_at',
        ]


class InspectionCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Inspection
        fields = ['unit', 'reporter_type', 'description']


class InspectionScheduleSerializer(serializers.ModelSerializer):
    unit_label = serializers.CharField(source='unit.label', read_only=True)
    unit_external_id = serializers.CharField(source='unit.external_unit_id', read_only=True)

    class Meta:
        model = InspectionSchedule
        fields = [
            'id', 'unit', 'unit_label', 'unit_external_id',
            'title', 'description', 'frequency_months',
            'next_due_date', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class InspectionUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Inspection
        fields = ['description', 'reporter_type']
