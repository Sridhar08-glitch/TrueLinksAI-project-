from django.utils import timezone
from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from apps.audit.services.audit_service import AuditService
from apps.users.models import UserRole
from apps.users.permissions import IsOwnerOrManager, IsOwnerManagerOrMaintenance
from .models import WorkOrder, WorkOrderStatus
from .serializers import (
    WorkOrderSerializer, WorkOrderCreateSerializer,
    WorkOrderUpdateSerializer, WorkOrderRejectSerializer,
    WorkOrderBulkActionSerializer,
)

# Actions maintenance staff may perform (plus owner/PM). Everything else is owner/PM only.
MAINTENANCE_ALLOWED_ACTIONS = ('list', 'retrieve', 'start', 'complete', 'verification')


class WorkOrderViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'priority', 'unit', 'generated_by', 'assigned_to']
    search_fields = ['title', 'description', 'unit__label', 'unit__external_unit_id']
    ordering_fields = ['created_at', 'priority', 'status']
    ordering = ['-created_at']

    def get_permissions(self):
        if self.action in MAINTENANCE_ALLOWED_ACTIONS:
            return [IsAuthenticated(), IsOwnerManagerOrMaintenance()]
        return [IsAuthenticated(), IsOwnerOrManager()]

    def get_queryset(self):
        return WorkOrder.objects.select_related('unit', 'inspection', 'assigned_to').all()

    def get_serializer_class(self):
        if self.action == 'create':
            return WorkOrderCreateSerializer
        if self.action in ('update', 'partial_update'):
            return WorkOrderUpdateSerializer
        return WorkOrderSerializer

    def perform_create(self, serializer):
        actor = self._actor(self.request)
        serializer.save(generated_by=f'manual:{actor}')
        AuditService.log('work_order', serializer.instance.id, 'created_manually', actor)

    def destroy(self, request, *args, **kwargs):
        wo = self.get_object()
        if wo.status != WorkOrderStatus.DRAFT:
            return Response(
                {'detail': 'Only draft work orders can be deleted.'},
                status=status.HTTP_409_CONFLICT,
            )
        AuditService.log('work_order', wo.id, 'deleted', self._actor(request))
        return super().destroy(request, *args, **kwargs)

    # ── Approve ───────────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        wo = self.get_object()
        if wo.status not in (WorkOrderStatus.DRAFT, WorkOrderStatus.PENDING_APPROVAL):
            return Response(
                {'detail': f'Cannot approve a work order in status "{wo.status}". Only draft or pending-approval work orders can be approved.'},
                status=status.HTTP_409_CONFLICT,
            )

        actor = self._actor(request)
        prev = wo.status
        wo.status = WorkOrderStatus.APPROVED
        wo.approved_by = actor
        wo.approved_at = timezone.now()
        wo.save(update_fields=['status', 'approved_by', 'approved_at', 'updated_at'])
        AuditService.log(
            'work_order', wo.id, 'approved', actor,
            previous_value={'status': prev},
            new_value={'status': WorkOrderStatus.APPROVED},
        )
        return Response(WorkOrderSerializer(wo).data)

    # ── Reject ────────────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        wo = self.get_object()
        if wo.status not in (WorkOrderStatus.DRAFT, WorkOrderStatus.PENDING_APPROVAL, WorkOrderStatus.APPROVED):
            return Response(
                {'detail': f'Cannot reject a work order in status "{wo.status}".'},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = WorkOrderRejectSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        actor = self._actor(request)
        prev = wo.status
        wo.status = WorkOrderStatus.REJECTED
        wo.rejection_reason = serializer.validated_data['rejection_reason']
        wo.rejected_by = actor
        wo.rejected_at = timezone.now()
        wo.save(update_fields=['status', 'rejection_reason', 'rejected_by', 'rejected_at', 'updated_at'])
        AuditService.log(
            'work_order', wo.id, 'rejected', actor,
            previous_value={'status': prev},
            new_value={'status': WorkOrderStatus.REJECTED, 'reason': wo.rejection_reason},
        )
        return Response(WorkOrderSerializer(wo).data)

    # ── Start ─────────────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        wo = self.get_object()
        if wo.status != WorkOrderStatus.APPROVED:
            return Response({'detail': 'Work order must be approved before starting.'}, status=status.HTTP_400_BAD_REQUEST)
        actor = self._actor(request)
        wo.status = WorkOrderStatus.IN_PROGRESS
        wo.save(update_fields=['status', 'updated_at'])
        AuditService.log('work_order', wo.id, 'started', actor)
        return Response(WorkOrderSerializer(wo).data)

    # ── Complete ──────────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        wo = self.get_object()
        if wo.status != WorkOrderStatus.IN_PROGRESS:
            return Response({'detail': 'Work order must be in progress to complete.'}, status=status.HTTP_400_BAD_REQUEST)
        actor = self._actor(request)
        wo.status = WorkOrderStatus.COMPLETED
        wo.save(update_fields=['status', 'updated_at'])
        AuditService.log('work_order', wo.id, 'completed', actor)
        return Response(WorkOrderSerializer(wo).data)

    # ── Assign staff ─────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        wo = self.get_object()
        if wo.status not in (
            WorkOrderStatus.PENDING_APPROVAL, WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS,
        ):
            return Response(
                {'detail': f'Cannot assign staff to a work order in status "{wo.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'detail': 'user_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        from django.contrib.auth.models import User
        try:
            staff = User.objects.select_related('profile').get(
                pk=user_id,
                is_active=True,
                profile__role__in=[UserRole.MAINTENANCE_STAFF, UserRole.PROPERTY_MANAGER],
            )
        except User.DoesNotExist:
            return Response(
                {'detail': 'Active maintenance or property-manager staff member not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        wo.assigned_to = staff
        wo.assigned_at = timezone.now()
        wo.save(update_fields=['assigned_to', 'assigned_at', 'updated_at'])
        AuditService.log('work_order', wo.id, 'assigned', self._actor(request),
                         new_value={'assigned_to': staff.username})
        return Response(WorkOrderSerializer(wo).data)

    # ── Unassign staff ────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def unassign(self, request, pk=None):
        wo = self.get_object()
        wo.assigned_to = None
        wo.assigned_at = None
        wo.save(update_fields=['assigned_to', 'assigned_at', 'updated_at'])
        AuditService.log('work_order', wo.id, 'unassigned', self._actor(request))
        return Response(WorkOrderSerializer(wo).data)

    # ── Before/after verification ─────────────────────────────────────────────
    @action(detail=True, methods=['get'])
    def verification(self, request, pk=None):
        """
        Before/after view of a work order:
        - before: the source inspection the WO was generated from (WorkOrder.inspection,
          set by the AI work-order generator or the tenant image flow); null for
          manual WOs with no inspection.
        - after: verification inspections explicitly linked to this WO
          (Inspection.work_order FK).
        """
        from apps.inspections.serializers import InspectionFindingSerializer

        wo = self.get_object()

        before = None
        if wo.inspection_id and not wo.inspection.is_deleted:
            before = {
                'inspection_id': wo.inspection_id,
                'created_at': wo.inspection.created_at,
                'findings': InspectionFindingSerializer(
                    wo.inspection.findings.all(), many=True
                ).data,
            }

        after = []
        for inspection in (
            wo.verification_inspections
            .filter(is_deleted=False)
            .prefetch_related('findings')
            .order_by('created_at')
        ):
            after.append({
                'inspection_id': inspection.id,
                'created_at': inspection.created_at,
                'findings': InspectionFindingSerializer(inspection.findings.all(), many=True).data,
            })

        return Response({'before': before, 'after': after})

    # ── Bulk approve ──────────────────────────────────────────────────────────
    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        serializer = WorkOrderBulkActionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        actor = self._actor(request)
        ids = serializer.validated_data['ids']
        # Same state rules as single approve: only draft / pending_approval.
        eligible = WorkOrder.objects.filter(
            id__in=ids,
            status__in=[WorkOrderStatus.DRAFT, WorkOrderStatus.PENDING_APPROVAL],
        )
        count = eligible.count()
        now = timezone.now()
        eligible.update(
            status=WorkOrderStatus.APPROVED,
            approved_by=actor,
            approved_at=now,
            updated_at=now,
        )
        return Response({'approved': count, 'requested': len(ids), 'skipped': len(ids) - count})

    # ── Bulk reject ───────────────────────────────────────────────────────────
    @action(detail=False, methods=['post'], url_path='bulk-reject')
    def bulk_reject(self, request):
        serializer = WorkOrderBulkActionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        actor = self._actor(request)
        ids = serializer.validated_data['ids']
        reason = serializer.validated_data.get('rejection_reason', '') or 'Bulk rejected'
        # Same state rules as single reject: draft / pending_approval / approved.
        eligible = WorkOrder.objects.filter(
            id__in=ids,
            status__in=[WorkOrderStatus.DRAFT, WorkOrderStatus.PENDING_APPROVAL, WorkOrderStatus.APPROVED],
        )
        count = eligible.count()
        now = timezone.now()
        eligible.update(
            status=WorkOrderStatus.REJECTED,
            rejection_reason=reason,
            rejected_by=actor,
            rejected_at=now,
            updated_at=now,
        )
        return Response({'rejected': count, 'requested': len(ids), 'skipped': len(ids) - count})

    # ── Bulk delete (drafts only) ─────────────────────────────────────────────
    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        serializer = WorkOrderBulkActionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        ids = serializer.validated_data['ids']
        eligible = WorkOrder.objects.filter(
            id__in=ids,
            status__in=[WorkOrderStatus.DRAFT, WorkOrderStatus.PENDING_APPROVAL],
        )
        count = eligible.count()
        eligible.delete()
        return Response({'deleted': count, 'requested': len(ids)})

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'
