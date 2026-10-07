import logging

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status as http_status

from .models import NotificationRead

logger = logging.getLogger(__name__)


def _build_tenant_notifications(user):
    """Notifications for a tenant: activity on their own unit only."""
    from datetime import timedelta
    from django.utils import timezone
    from apps.leases.models import Lease
    from apps.users.models import TenantAssignment
    from apps.work_orders.models import WorkOrder, WorkOrderStatus

    items = []
    unit_ids = list(
        TenantAssignment.objects.filter(tenant=user, is_active=True)
        .values_list('unit_id', flat=True)
    )
    if not unit_ids:
        return items
    recent = timezone.now() - timedelta(days=30)

    try:
        approved_leases = Lease.objects.filter(
            unit_id__in=unit_ids,
            approval_status='approved',
            is_cancelled=False,
            updated_at__gte=recent,
        ).order_by('-updated_at')[:5]
        for lease in approved_leases:
            items.append({
                'id': f'lease:{lease.id}:tenant-approved',
                'title': 'Lease Approved',
                'message': (
                    f'Your lease for {lease.unit.label if lease.unit else "your unit"} was approved'
                    f'{f" ({lease.start_date} to {lease.end_date})" if lease.start_date and lease.end_date else ""}.'
                ),
                'notification_type': 'lease',
                'is_read': False,
                'created_at': lease.updated_at.isoformat(),
                'link': '/tenant/documents',
            })
    except Exception:
        logger.exception('Failed to build tenant lease notifications')

    try:
        wo_status_text = {
            WorkOrderStatus.APPROVED: 'was approved and will be scheduled',
            WorkOrderStatus.IN_PROGRESS: 'is now in progress',
            WorkOrderStatus.COMPLETED: 'has been completed',
        }
        recent_wos = WorkOrder.objects.filter(
            unit_id__in=unit_ids,
            status__in=list(wo_status_text),
            updated_at__gte=recent,
        ).order_by('-updated_at')[:10]
        for wo in recent_wos:
            items.append({
                'id': f'wo:{wo.id}:{wo.status}',
                'title': 'Maintenance Update',
                'message': f'Work order "{wo.title}" {wo_status_text[wo.status]}.',
                'notification_type': 'maintenance',
                'is_read': False,
                'created_at': wo.updated_at.isoformat(),
                'link': '/tenant/maintenance',
            })
    except Exception:
        logger.exception('Failed to build tenant work order notifications')

    return items


def _build_notifications():
    """Synthesize the current notification list. Each item has a STABLE key as its id."""
    from apps.work_orders.models import WorkOrder, WorkOrderStatus
    from apps.leases.models import Lease

    items = []

    try:
        pending_wos = WorkOrder.objects.filter(
            status__in=[WorkOrderStatus.PENDING_APPROVAL, WorkOrderStatus.DRAFT]
        ).order_by('-created_at')[:10]
        for wo in pending_wos:
            items.append({
                'id': f'wo:{wo.id}:pending',
                'title': 'Work Order Awaiting Approval',
                'message': f'"{wo.title}" is pending approval.',
                'notification_type': 'maintenance',
                'is_read': False,
                'created_at': wo.created_at.isoformat(),
                'link': '/work-orders',
            })
    except Exception:
        logger.exception('Failed to build work order notifications')

    try:
        ready_leases = Lease.objects.filter(
            processing_status='completed',
            approval_status='pending_review',
            is_cancelled=False,
        ).order_by('-created_at')[:5]
        for lease in ready_leases:
            name = lease.tenant_name or 'Unknown tenant'
            items.append({
                'id': f'lease:{lease.id}:review',
                'title': 'Lease Ready for Review',
                'message': f'Lease for {name} has been processed and needs review.',
                'notification_type': 'lease',
                'is_read': False,
                'created_at': lease.created_at.isoformat(),
                'link': '/ai-lease-review',
            })
    except Exception:
        logger.exception('Failed to build lease notifications')

    try:
        from datetime import date, timedelta
        from apps.inspections.models import InspectionSchedule

        today = date.today()
        due_schedules = InspectionSchedule.objects.select_related('unit').filter(
            is_active=True,
            next_due_date__lte=today + timedelta(days=7),
        ).order_by('next_due_date')[:10]
        for schedule in due_schedules:
            overdue = schedule.next_due_date < today
            items.append({
                'id': f'schedule:{schedule.id}:due',
                'title': 'Inspection Overdue' if overdue else 'Inspection Due Soon',
                'message': (
                    f'"{schedule.title}" for unit {schedule.unit.label} '
                    f'{"was due" if overdue else "is due"} on {schedule.next_due_date}.'
                ),
                'notification_type': 'inspection',
                'is_read': False,
                'created_at': schedule.next_due_date.isoformat(),
                'link': '/inspections',
            })
    except Exception:
        logger.exception('Failed to build inspection schedule notifications')

    return items


def _items_for(user):
    try:
        role = user.profile.role
    except Exception:
        role = None
    if role == 'tenant':
        return _build_tenant_notifications(user)
    return _build_notifications()


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notifications_view(request):
    items = _items_for(request.user)

    read_keys = set(
        NotificationRead.objects.filter(
            user=request.user,
            notification_key__in=[n['id'] for n in items],
        ).values_list('notification_key', flat=True)
    )
    for n in items:
        n['is_read'] = n['id'] in read_keys

    unread = sum(1 for n in items if not n['is_read'])
    return Response({
        'count': len(items),
        'next': None,
        'previous': None,
        'results': items,
        'unread_count': unread,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_read_view(request, pk=None):
    if not pk:
        return Response({'detail': 'Notification id required.'}, status=http_status.HTTP_400_BAD_REQUEST)
    NotificationRead.objects.get_or_create(user=request.user, notification_key=str(pk))
    return Response({'detail': 'Marked as read.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_all_read_view(request):
    items = _items_for(request.user)
    existing = set(
        NotificationRead.objects.filter(
            user=request.user,
            notification_key__in=[n['id'] for n in items],
        ).values_list('notification_key', flat=True)
    )
    NotificationRead.objects.bulk_create([
        NotificationRead(user=request.user, notification_key=n['id'])
        for n in items if n['id'] not in existing
    ], ignore_conflicts=True)
    return Response({'detail': 'All marked as read.'})
