import calendar
from datetime import date

from django.db import models
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.users.permissions import IsOwnerManagerOrMaintenance
from .models import Unit, OccupancyStatus


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsOwnerManagerOrMaintenance])
def stats_view(request):
    from apps.leases.models import Lease, LeaseField, ReviewStatus, ProcessingStatus, ApprovalStatus
    from apps.work_orders.models import WorkOrder, WorkOrderStatus
    from apps.inspections.models import InspectionFinding, FindingReviewStatus
    from apps.properties.models import Property

    units = Unit.objects.exclude(is_archived=True)
    total_units = units.count()
    available_units = units.filter(occupancy_status=OccupancyStatus.AVAILABLE).count()
    occupied_units = units.filter(occupancy_status=OccupancyStatus.OCCUPIED).count()
    maintenance_units = units.filter(occupancy_status=OccupancyStatus.MAINTENANCE).count()

    pending_lease_reviews = LeaseField.objects.filter(
        review_status=ReviewStatus.PENDING,
        lease__is_cancelled=False,
        lease__processing_status=ProcessingStatus.COMPLETED,
    ).count()
    pending_work_orders = WorkOrder.objects.filter(
        status__in=[WorkOrderStatus.DRAFT, WorkOrderStatus.PENDING_APPROVAL]
    ).count()
    open_issues = InspectionFinding.objects.filter(
        review_status=FindingReviewStatus.PENDING,
        category='damage',
        inspection__is_deleted=False,
    ).count()
    total_properties = Property.objects.count()
    active_leases = Lease.objects.filter(
        approval_status=ApprovalStatus.APPROVED,
        is_cancelled=False,
    ).filter(
        models.Q(end_date__isnull=True) | models.Q(end_date__gte=date.today())
    ).count()

    # Rent collection stats
    from apps.payments.models import PaymentScheduleItem, PaymentStatus
    today = date.today()
    overdue_payments = PaymentScheduleItem.objects.filter(
        PaymentScheduleItem.overdue_q(today), lease__is_cancelled=False,
    ).count()
    collected_this_month = PaymentScheduleItem.objects.filter(
        status=PaymentStatus.PAID,
        paid_at__year=today.year,
        paid_at__month=today.month,
    ).aggregate(s=models.Sum('paid_amount'))['s'] or 0

    return Response({
        'total_units': total_units,
        'available_units': available_units,
        'occupied_units': occupied_units,
        'maintenance_units': maintenance_units,
        'pending_lease_reviews': pending_lease_reviews,
        'pending_work_orders': pending_work_orders,
        'open_issues': open_issues,
        'total_properties': total_properties,
        'active_leases': active_leases,
        'overdue_payments': overdue_payments,
        'collected_this_month': float(collected_this_month),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsOwnerManagerOrMaintenance])
def monthly_stats_view(request):
    from apps.users.models import TenantAssignment

    units = Unit.objects.exclude(is_archived=True)
    total_units = units.count()

    today = date.today()
    result = []

    for i in range(5, -1, -1):
        # First day of the target month
        year = today.year
        month = today.month - i
        while month <= 0:
            month += 12
            year -= 1
        month_last_day = calendar.monthrange(year, month)[1]
        month_start = date(year, month, 1)
        month_end = date(year, month, month_last_day)
        label = month_start.strftime('%b')

        # Count assignments active during this month
        active_count = TenantAssignment.objects.filter(
            created_at__date__lte=month_end,
        ).filter(
            models.Q(is_active=True) | models.Q(move_out_date__gte=month_start)
        ).count()

        occupancy_pct = round(active_count / total_units * 100, 1) if total_units else 0
        result.append({
            'month': label,
            'occupancy': min(occupancy_pct, 100),
        })

    return Response(result)
