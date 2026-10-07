from rest_framework import serializers
from .models import Lease, LeaseField, LeaseFlag, LeaseClause


class LeaseFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseField
        fields = [
            'id', 'field_name', 'display_label', 'data_type', 'category',
            'extracted_value', 'normalized_value',
            'confidence', 'source_page', 'source_text', 'source_location',
            'review_status', 'reviewed_value', 'reviewed_by', 'reviewed_at',
            'rejection_reason', 'created_at',
        ]
        read_only_fields = ['id', 'extracted_value', 'created_at']


class LeaseFlagSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseFlag
        fields = [
            'id', 'flag_type', 'severity', 'description', 'related_fields',
            'source_reference', 'status', 'reviewer_comment', 'reviewed_by', 'reviewed_at',
        ]


class LeaseSerializer(serializers.ModelSerializer):
    unit_label = serializers.CharField(source='unit.label', read_only=True, default=None)
    unit_external_id = serializers.CharField(source='unit.external_unit_id', read_only=True, default=None)
    open_flags_count = serializers.SerializerMethodField()
    document = serializers.SerializerMethodField()

    class Meta:
        model = Lease
        fields = [
            'id', 'unit', 'unit_label', 'unit_external_id',
            'tenant_name', 'landlord_name', 'start_date', 'end_date',
            'rent_amount', 'currency', 'rent_frequency', 'deposit_amount', 'annual_rent',
            'escalation_clause', 'renewal_terms', 'termination_terms',
            'extracted_unit_id', 'document',
            'processing_status', 'approval_status',
            'processing_started_at', 'processing_completed_at',
            'provider_used', 'processing_error', 'retry_count',
            'is_cancelled', 'cancel_reason', 'cancelled_by', 'cancelled_at',
            'open_flags_count', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'processing_status', 'approval_status',
            'is_cancelled', 'cancel_reason', 'cancelled_by', 'cancelled_at',
            'created_at', 'updated_at',
        ]

    def get_open_flags_count(self, obj):
        # Computed in Python from the prefetched flags to avoid an N+1 query per lease.
        return len([f for f in obj.flags.all() if f.status == 'open'])

    def get_document(self, obj):
        if not obj.document:
            return None
        from apps.common.media import build_signed_media_url
        return build_signed_media_url(obj.document.url, self.context.get('request'))


class LeaseUpdateSerializer(serializers.ModelSerializer):
    """For manual corrections to extracted fields."""
    class Meta:
        model = Lease
        fields = [
            'tenant_name', 'landlord_name', 'start_date', 'end_date',
            'rent_amount', 'currency', 'rent_frequency', 'deposit_amount',
            'annual_rent', 'escalation_clause', 'renewal_terms', 'termination_terms',
            'unit',
        ]


class LeaseUploadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lease
        fields = ['document']


class LeaseManualCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lease
        fields = [
            'unit', 'tenant_name', 'landlord_name',
            'start_date', 'end_date',
            'rent_amount', 'currency', 'rent_frequency',
            'deposit_amount', 'annual_rent',
            'escalation_clause', 'renewal_terms', 'termination_terms',
        ]
        extra_kwargs = {
            'tenant_name': {'required': True},
            'start_date': {'required': True},
            'end_date': {'required': True},
            'rent_amount': {'required': True},
        }


class LeaseApproveSerializer(serializers.Serializer):
    approved_by = serializers.CharField(max_length=255, required=False, default='owner')


class LeaseRejectSerializer(serializers.Serializer):
    rejected_by = serializers.CharField(max_length=255, required=False, default='owner')
    reason = serializers.CharField(required=False, allow_blank=True)


class LeaseCancelSerializer(serializers.Serializer):
    cancel_reason = serializers.CharField(min_length=1)
    # Accepted for backwards compatibility but ignored — the actor is always request.user.
    cancelled_by = serializers.CharField(max_length=255, required=False, allow_blank=True)


class LeaseFieldApproveSerializer(serializers.Serializer):
    # Accepted but ignored — the actor is always request.user.
    reviewed_by = serializers.CharField(max_length=255, required=False, allow_blank=True)
    reviewed_value = serializers.JSONField(required=False)


class LeaseFieldRejectSerializer(serializers.Serializer):
    # Accepted but ignored — the actor is always request.user.
    reviewed_by = serializers.CharField(max_length=255, required=False, allow_blank=True)
    reason = serializers.CharField(required=False, allow_blank=True)


class LeaseFlagReviewSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=['acknowledge', 'resolve', 'dismiss'])
    # Accepted but ignored — the actor is always request.user.
    reviewed_by = serializers.CharField(max_length=255, required=False, allow_blank=True)
    reviewer_comment = serializers.CharField(required=False, allow_blank=True)


class LeaseClauseSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseClause
        fields = [
            'id', 'clause_type', 'title', 'raw_text', 'interpretation',
            'source_type', 'source_page', 'source_text', 'confidence',
            'is_unusual', 'unusual_reason', 'extra_data',
            'review_status', 'reviewed_by', 'reviewed_at', 'created_at',
        ]


class LeaseClauseCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseClause
        fields = [
            'lease', 'clause_type', 'title', 'raw_text', 'interpretation',
            'source_type', 'source_page', 'is_unusual', 'unusual_reason',
        ]


class LeaseClauseUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseClause
        fields = [
            'clause_type', 'title', 'raw_text', 'interpretation',
            'source_type', 'is_unusual', 'unusual_reason', 'review_status',
        ]


class LeaseResolveUnitSerializer(serializers.Serializer):
    unit_id = serializers.IntegerField()
    # Accepted but ignored — the actor is always request.user.
    resolved_by = serializers.CharField(max_length=255, required=False, allow_blank=True)
