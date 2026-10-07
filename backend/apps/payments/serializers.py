from decimal import Decimal

from rest_framework import serializers

from .models import PaymentScheduleItem


class PaymentScheduleItemSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    lease_tenant_name = serializers.CharField(source='lease.tenant_name', read_only=True)
    unit_label = serializers.CharField(source='lease.unit.label', read_only=True, default=None)

    class Meta:
        model = PaymentScheduleItem
        fields = [
            'id', 'lease', 'lease_tenant_name', 'unit_label',
            'due_date', 'amount', 'currency', 'status',
            'paid_at', 'paid_amount', 'payment_method', 'recorded_by',
            'notes', 'created_at',
        ]
        read_only_fields = fields

    def get_status(self, obj):
        # pending + past due date → overdue (computed, no cron needed)
        return obj.effective_status


class MarkPaidSerializer(serializers.Serializer):
    paid_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, min_value=Decimal('0')
    )
    payment_method = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
