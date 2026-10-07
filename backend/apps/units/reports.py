"""CSV report exports for owners/property managers."""
import csv
from datetime import date

from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

from apps.users.permissions import IsOwnerOrManager
from .models import Unit


def _csv_response(filename: str):
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsOwnerOrManager])
def rent_roll_report(request):
    """One row per approved, non-cancelled lease."""
    from apps.leases.models import Lease, ApprovalStatus

    response = _csv_response('rent_roll.csv')
    writer = csv.writer(response)
    writer.writerow([
        'property', 'building', 'unit', 'tenant_name',
        'start_date', 'end_date', 'rent_amount', 'currency', 'status',
    ])

    today = date.today()
    leases = (
        Lease.objects
        .filter(approval_status=ApprovalStatus.APPROVED, is_cancelled=False)
        .select_related('unit', 'unit__building', 'unit__building__property')
        .order_by('unit__external_unit_id', 'start_date')
    )
    for lease in leases:
        unit = lease.unit
        building = unit.building if unit else None
        prop = building.property if building else None
        if lease.end_date and lease.end_date < today:
            lease_status = 'expired'
        else:
            lease_status = 'active'
        writer.writerow([
            prop.name if prop else '',
            building.name if building else '',
            unit.label if unit else (lease.extracted_unit_id or ''),
            lease.tenant_name,
            lease.start_date or '',
            lease.end_date or '',
            lease.rent_amount if lease.rent_amount is not None else '',
            lease.currency,
            lease_status,
        ])
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsOwnerOrManager])
def occupancy_report(request):
    """One row per unit with its current occupancy and tenant (if assigned)."""
    from apps.users.models import TenantAssignment

    response = _csv_response('occupancy.csv')
    writer = csv.writer(response)
    writer.writerow([
        'property', 'building', 'unit', 'unit_type',
        'occupancy_status', 'tenant', 'move_in_date',
    ])

    assignments = {
        a.unit_id: a
        for a in TenantAssignment.objects.filter(is_active=True).select_related('tenant')
    }
    units = (
        Unit.objects
        .exclude(is_archived=True)
        .select_related('building', 'building__property')
        .order_by('external_unit_id')
    )
    for unit in units:
        assignment = assignments.get(unit.id)
        tenant_name = ''
        move_in = ''
        if assignment:
            tenant = assignment.tenant
            tenant_name = tenant.get_full_name() or tenant.email or tenant.username
            move_in = assignment.move_in_date or ''
        writer.writerow([
            unit.building.property.name if unit.building else '',
            unit.building.name if unit.building else '',
            unit.label,
            unit.unit_type,
            unit.occupancy_status,
            tenant_name,
            move_in,
        ])
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsOwnerOrManager])
def work_orders_report(request):
    """One row per work order."""
    from apps.work_orders.models import WorkOrder, WorkOrderStatus

    response = _csv_response('work_orders.csv')
    writer = csv.writer(response)
    writer.writerow([
        'unit', 'title', 'status', 'priority', 'assigned_to', 'created_at', 'completed_at',
    ])

    work_orders = (
        WorkOrder.objects
        .select_related('unit', 'assigned_to')
        .order_by('-created_at')
    )
    for wo in work_orders:
        assigned = ''
        if wo.assigned_to:
            assigned = wo.assigned_to.get_full_name() or wo.assigned_to.email or wo.assigned_to.username
        # No dedicated completed_at field — updated_at reflects the completion transition.
        completed = wo.updated_at.isoformat() if wo.status == WorkOrderStatus.COMPLETED else ''
        writer.writerow([
            wo.unit.label if wo.unit else '',
            wo.title,
            wo.status,
            wo.priority,
            assigned,
            wo.created_at.isoformat(),
            completed,
        ])
    return response
