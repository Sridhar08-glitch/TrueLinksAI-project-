from django.db.models import ProtectedError
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from apps.users.permissions import ReadStaffWriteOwnerManager
from .models import Unit, OccupancyStatus
from .serializers import UnitSerializer, UnitDetailSerializer, UnitCreateSerializer


class UnitViewSet(viewsets.ModelViewSet):
    queryset = Unit.objects.select_related('building__property__ownership_entity').all().order_by('external_unit_id')
    permission_classes = [IsAuthenticated, ReadStaffWriteOwnerManager]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['occupancy_status', 'unit_type', 'building', 'is_archived']
    search_fields = ['external_unit_id', 'label', 'unit_type', 'building__name']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return UnitDetailSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return UnitCreateSerializer
        return UnitSerializer

    def destroy(self, request, *args, **kwargs):
        unit = self.get_object()
        if unit.has_active_lease():
            return Response(
                {'detail': 'Cannot delete a unit with an active lease. Archive it instead.'},
                status=status.HTTP_409_CONFLICT,
            )
        if unit.has_open_work_orders():
            return Response(
                {'detail': 'Cannot delete a unit with open work orders. Resolve them first or archive the unit.'},
                status=status.HTTP_409_CONFLICT,
            )
        if unit.inspections.exists():
            return Response(
                {'detail': 'Cannot delete a unit with inspection history. Archive it instead.'},
                status=status.HTTP_409_CONFLICT,
            )
        if unit.tenant_assignments.exists():
            return Response(
                {'detail': 'Cannot delete a unit with tenant assignment history. Archive it instead.'},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'detail': 'This unit has related records and cannot be deleted. Archive it instead.'},
                status=status.HTTP_409_CONFLICT,
            )

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        unit = self.get_object()
        if unit.is_archived:
            return Response({'detail': 'Unit is already archived.'}, status=status.HTTP_409_CONFLICT)
        if unit.occupancy_status == OccupancyStatus.OCCUPIED:
            return Response(
                {'detail': 'Cannot archive an occupied unit. End the tenancy or cancel the lease first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        unit.is_archived = True
        unit.occupancy_status = OccupancyStatus.ARCHIVED
        unit.save(update_fields=['is_archived', 'occupancy_status', 'updated_at'])
        from apps.audit.services.audit_service import AuditService
        AuditService.log('unit', unit.id, 'archived', self._actor(request))
        return Response(UnitDetailSerializer(unit, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def unarchive(self, request, pk=None):
        unit = self.get_object()
        if not unit.is_archived:
            return Response({'detail': 'Unit is not archived.'}, status=status.HTTP_409_CONFLICT)
        unit.is_archived = False
        has_active_assignment = unit.tenant_assignments.filter(is_active=True).exists()
        unit.occupancy_status = (
            OccupancyStatus.OCCUPIED if has_active_assignment else OccupancyStatus.AVAILABLE
        )
        unit.save(update_fields=['is_archived', 'occupancy_status', 'updated_at'])
        from apps.audit.services.audit_service import AuditService
        AuditService.log('unit', unit.id, 'unarchived', self._actor(request))
        return Response(UnitDetailSerializer(unit, context={'request': request}).data)

    @action(detail=True, methods=['get'])
    def overview(self, request, pk=None):
        unit = self.get_object()
        from apps.leases.models import Lease
        from apps.leases.serializers import LeaseSerializer
        from apps.inspections.models import Inspection
        from apps.inspections.serializers import InspectionSerializer
        from apps.work_orders.models import WorkOrder
        from apps.work_orders.serializers import WorkOrderSerializer

        unit_data = UnitDetailSerializer(unit, context={'request': request}).data

        active_lease = (
            Lease.objects.filter(unit=unit, approval_status='approved', is_cancelled=False)
            .order_by('-created_at')
            .first()
        )
        pending_leases = Lease.objects.filter(
            unit=unit, approval_status='pending_review', is_cancelled=False
        ).order_by('-created_at')

        inspections = Inspection.objects.filter(unit=unit, is_deleted=False).order_by('-created_at')[:5]
        work_orders = WorkOrder.objects.filter(unit=unit).order_by('-created_at')[:10]

        return Response({
            'unit': unit_data,
            'active_lease': LeaseSerializer(active_lease, context={'request': request}).data if active_lease else None,
            'pending_leases': LeaseSerializer(pending_leases, many=True, context={'request': request}).data,
            'recent_inspections': InspectionSerializer(inspections, many=True, context={'request': request}).data,
            'work_orders': WorkOrderSerializer(work_orders, many=True, context={'request': request}).data,
        })

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'
