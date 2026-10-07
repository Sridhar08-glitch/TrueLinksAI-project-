from datetime import date

from django.db.models import Sum
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter

from apps.audit.services.audit_service import AuditService
from apps.users.permissions import IsOwnerOrManager
from .models import PaymentScheduleItem, PaymentStatus
from .serializers import PaymentScheduleItemSerializer, MarkPaidSerializer


class PaymentScheduleItemViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = PaymentScheduleItemSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['lease']
    ordering_fields = ['due_date', 'amount', 'paid_at']
    ordering = ['due_date']

    def get_queryset(self):
        qs = PaymentScheduleItem.objects.select_related('lease', 'lease__unit').all()
        params = self.request.query_params

        status_param = (params.get('status') or '').strip().lower()
        today = date.today()
        if status_param == PaymentStatus.PAID:
            qs = qs.filter(status=PaymentStatus.PAID)
        elif status_param == PaymentStatus.OVERDUE:
            qs = qs.filter(PaymentScheduleItem.overdue_q(today))
        elif status_param == PaymentStatus.PENDING:
            qs = qs.filter(status=PaymentStatus.PENDING, due_date__gte=today)

        due_before = params.get('due_before')
        if due_before:
            try:
                qs = qs.filter(due_date__lte=date.fromisoformat(due_before))
            except ValueError:
                pass
        due_after = params.get('due_after')
        if due_after:
            try:
                qs = qs.filter(due_date__gte=date.fromisoformat(due_after))
            except ValueError:
                pass
        return qs

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        item = self.get_object()
        if item.status == PaymentStatus.PAID:
            return Response({'detail': 'Payment is already marked as paid.'}, status=status.HTTP_409_CONFLICT)

        serializer = MarkPaidSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        actor = self._actor(request)
        prev = item.effective_status
        item.status = PaymentStatus.PAID
        item.paid_at = timezone.now()
        item.paid_amount = serializer.validated_data.get('paid_amount', item.amount)
        item.payment_method = serializer.validated_data.get('payment_method', '') or ''
        if serializer.validated_data.get('notes'):
            item.notes = serializer.validated_data['notes']
        item.recorded_by = actor
        item.save(update_fields=[
            'status', 'paid_at', 'paid_amount', 'payment_method', 'notes', 'recorded_by',
        ])
        AuditService.log(
            'payment', item.id, 'marked_paid', actor,
            previous_value={'status': prev},
            new_value={'status': PaymentStatus.PAID, 'paid_amount': str(item.paid_amount)},
        )
        return Response(PaymentScheduleItemSerializer(item).data)

    @action(detail=True, methods=['post'], url_path='mark-unpaid')
    def mark_unpaid(self, request, pk=None):
        item = self.get_object()
        if item.status != PaymentStatus.PAID:
            return Response({'detail': 'Payment is not marked as paid.'}, status=status.HTTP_409_CONFLICT)

        actor = self._actor(request)
        item.status = PaymentStatus.PENDING
        item.paid_at = None
        item.paid_amount = None
        item.payment_method = ''
        item.recorded_by = actor
        item.save(update_fields=['status', 'paid_at', 'paid_amount', 'payment_method', 'recorded_by'])
        AuditService.log(
            'payment', item.id, 'marked_unpaid', actor,
            previous_value={'status': PaymentStatus.PAID},
            new_value={'status': item.effective_status},
        )
        return Response(PaymentScheduleItemSerializer(item).data)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        today = date.today()
        qs = PaymentScheduleItem.objects.filter(lease__is_cancelled=False)

        month_items = qs.filter(due_date__year=today.year, due_date__month=today.month)
        total_due = month_items.aggregate(s=Sum('amount'))['s'] or 0
        collected = qs.filter(
            status=PaymentStatus.PAID,
            paid_at__year=today.year, paid_at__month=today.month,
        ).aggregate(s=Sum('paid_amount'))['s'] or 0

        overdue = qs.filter(PaymentScheduleItem.overdue_q(today))
        overdue_count = overdue.count()
        overdue_amount = overdue.aggregate(s=Sum('amount'))['s'] or 0

        collection_rate = round(float(collected) / float(total_due) * 100, 1) if total_due else 0.0

        return Response({
            'total_due_this_month': float(total_due),
            'collected_this_month': float(collected),
            'overdue_count': overdue_count,
            'overdue_amount': float(overdue_amount),
            'collection_rate_pct': collection_rate,
        })
