from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from apps.audit.services.audit_service import AuditService
from apps.users.models import UserRole, TenantAssignment
from apps.users.permissions import _get_role, ReadStaffWriteOwnerManager
from .models import (
    Inspection, InspectionImage, InspectionFinding, FindingReviewStatus,
    InspectionStatus, InspectionSchedule, ReporterType,
)
from .serializers import (
    InspectionSerializer, InspectionCreateSerializer, InspectionUpdateSerializer,
    InspectionImageSerializer, InspectionFindingSerializer,
    InspectionFindingCreateSerializer, InspectionFindingUpdateSerializer,
    InspectionFindingReviewSerializer, InspectionScheduleSerializer,
)
from .services.image_validation_service import ImageValidationService, ImageValidationError

STAFF_ROLES = (UserRole.OWNER, UserRole.PROPERTY_MANAGER, UserRole.MAINTENANCE_STAFF)

# Inspection endpoints a tenant may use (always scoped to their own assigned unit).
TENANT_ALLOWED_INSPECTION_ACTIONS = ('list', 'retrieve', 'create', 'images', 'analyze')

# An inspection stuck in ANALYZING longer than this may be re-analyzed.
STALE_ANALYZING_MINUTES = 10


def _active_assignment(user):
    return (
        TenantAssignment.objects
        .filter(tenant=user, is_active=True)
        .select_related('unit')
        .first()
    )


class InspectionPermission(BasePermission):
    """Owner/PM/maintenance: full access. Tenants: create/retrieve/images/analyze/list
    only, scoped (in the view) to their own assigned unit."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        role = _get_role(request.user)
        if role in STAFF_ROLES:
            return True
        if role == UserRole.TENANT:
            return view.action in TENANT_ALLOWED_INSPECTION_ACTIONS
        return False


class InspectionFindingPermission(BasePermission):
    """Reads for staff roles and tenants (scoped). Writes/review: owner/PM only."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        role = _get_role(request.user)
        if view.action in ('list', 'retrieve'):
            return role in STAFF_ROLES or role == UserRole.TENANT
        return role in (UserRole.OWNER, UserRole.PROPERTY_MANAGER)


class InspectionViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [InspectionPermission]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['unit', 'status', 'reporter_type', 'is_deleted']
    search_fields = ['description', 'unit__label', 'unit__external_unit_id']
    ordering_fields = ['created_at']
    ordering = ['-created_at']

    def _is_tenant(self):
        user = self.request.user
        return not user.is_superuser and _get_role(user) == UserRole.TENANT

    def get_queryset(self):
        qs = (
            Inspection.objects
            .select_related('unit')
            .prefetch_related('images', 'findings')
            .filter(is_deleted=False)
        )
        if self._is_tenant():
            assignment = _active_assignment(self.request.user)
            if not assignment:
                return qs.none()
            qs = qs.filter(unit_id=assignment.unit_id)
        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return InspectionCreateSerializer
        if self.action in ('update', 'partial_update'):
            return InspectionUpdateSerializer
        return InspectionSerializer

    def create(self, request, *args, **kwargs):
        serializer = InspectionCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        if self._is_tenant():
            assignment = _active_assignment(request.user)
            if not assignment or serializer.validated_data['unit'].id != assignment.unit_id:
                return Response(
                    {'unit': 'You can only create inspections for your own assigned unit.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Staff may link the inspection to a work order (verification/"after" inspection).
        work_order = None
        work_order_id = request.data.get('work_order')
        if work_order_id:
            if self._is_tenant():
                return Response(
                    {'work_order': 'Only staff can link an inspection to a work order.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            from apps.work_orders.models import WorkOrder
            try:
                work_order = WorkOrder.objects.get(pk=int(work_order_id))
            except (WorkOrder.DoesNotExist, ValueError, TypeError):
                return Response({'work_order': 'Work order not found.'}, status=status.HTTP_400_BAD_REQUEST)

        inspection = serializer.save(work_order=work_order)
        AuditService.log('inspection', inspection.id, 'created', self._actor(request))
        return Response(
            InspectionSerializer(inspection, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ── Soft delete ───────────────────────────────────────────────────────────
    @action(detail=True, methods=['delete', 'post'], url_path='delete')
    def soft_delete(self, request, pk=None):
        inspection = self.get_object()
        if inspection.is_deleted:
            return Response({'detail': 'Already deleted.'}, status=status.HTTP_409_CONFLICT)
        inspection.is_deleted = True
        inspection.save(update_fields=['is_deleted', 'updated_at'])
        AuditService.log('inspection', inspection.id, 'deleted', self._actor(request))
        return Response({'detail': 'Inspection deleted.'})

    # ── Deleted list (owner view) ─────────────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='deleted')
    def deleted(self, request):
        qs = (
            Inspection.objects
            .filter(is_deleted=True)
            .select_related('unit')
            .prefetch_related('images', 'findings')
            .order_by('-created_at')
        )
        return Response(InspectionSerializer(qs, many=True, context={'request': request}).data)

    # ── Image upload ──────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def images(self, request, pk=None):
        inspection = self.get_object()
        validator = ImageValidationService()
        created = []

        files = request.FILES.getlist('images')
        if not files:
            return Response({'images': 'No images provided.'}, status=status.HTTP_400_BAD_REQUEST)

        for uploaded_file in files:
            try:
                validator.validate(uploaded_file)
            except ImageValidationError as exc:
                return Response(
                    {'images': f'File "{uploaded_file.name}": {exc}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            img = InspectionImage.objects.create(
                inspection=inspection,
                image=uploaded_file,
                original_filename=uploaded_file.name,
                content_type=uploaded_file.content_type,
            )
            created.append(img)

        return Response(
            InspectionImageSerializer(created, many=True, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ── AI analysis ───────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def analyze(self, request, pk=None):
        inspection = self.get_object()

        # Atomically claim the inspection for analysis. An inspection stuck in
        # ANALYZING for more than STALE_ANALYZING_MINUTES may be reclaimed —
        # the conditional UPDATE prevents a double-start race.
        now = timezone.now()
        stale_cutoff = now - timedelta(minutes=STALE_ANALYZING_MINUTES)
        claimed = Inspection.objects.filter(pk=inspection.pk).filter(
            ~Q(status=InspectionStatus.ANALYZING) | Q(updated_at__lt=stale_cutoff)
        ).update(status=InspectionStatus.ANALYZING, updated_at=now)
        if not claimed:
            return Response({'detail': 'Analysis already in progress.'}, status=status.HTTP_409_CONFLICT)

        import threading
        from django.db import connection

        def run_analysis():
            try:
                from .services.inspection_analysis_service import InspectionAnalysisService
                InspectionAnalysisService().analyze(inspection.id)
            except Exception:
                pass  # analyze() already persists the FAILED status and audit event
            finally:
                connection.close()

        t = threading.Thread(target=run_analysis, daemon=True)
        t.start()

        inspection.refresh_from_db()
        return Response(InspectionSerializer(inspection, context={'request': request}).data, status=status.HTTP_202_ACCEPTED)

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'


class InspectionFindingViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [InspectionFindingPermission]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['inspection', 'category', 'review_status']
    ordering_fields = ['confidence']
    ordering = ['-confidence']

    def get_queryset(self):
        qs = InspectionFinding.objects.select_related('inspection', 'image').all()
        user = self.request.user
        if not user.is_superuser and _get_role(user) == UserRole.TENANT:
            assignment = _active_assignment(user)
            if not assignment:
                return qs.none()
            qs = qs.filter(inspection__unit_id=assignment.unit_id, inspection__is_deleted=False)
        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return InspectionFindingCreateSerializer
        if self.action in ('update', 'partial_update'):
            return InspectionFindingUpdateSerializer
        return InspectionFindingSerializer

    def perform_create(self, serializer):
        finding = serializer.save()
        AuditService.log('inspection_finding', finding.id, 'created_manually',
                         self._actor(self.request))

    def perform_destroy(self, instance):
        AuditService.log('inspection_finding', instance.id, 'deleted',
                         self._actor(self.request))
        instance.delete()

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        finding = self.get_object()
        serializer = InspectionFindingReviewSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        prev = finding.review_status
        finding.review_status = serializer.validated_data['review_status']
        finding.save(update_fields=['review_status'])
        AuditService.log(
            'inspection_finding', finding.id,
            f'finding_{serializer.validated_data["review_status"]}',
            self._actor(request),
            previous_value={'review_status': prev},
            new_value={'review_status': finding.review_status},
        )
        return Response(InspectionFindingSerializer(finding).data)

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'


class InspectionScheduleViewSet(viewsets.ModelViewSet):
    """Recurring inspection schedules. Owner/PM manage; maintenance may read."""
    serializer_class = InspectionScheduleSerializer
    permission_classes = [ReadStaffWriteOwnerManager]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['unit', 'is_active']
    ordering_fields = ['next_due_date', 'created_at']
    ordering = ['next_due_date']

    def get_queryset(self):
        return InspectionSchedule.objects.select_related('unit').all()

    def perform_create(self, serializer):
        schedule = serializer.save()
        AuditService.log('inspection_schedule', schedule.id, 'created', self._actor(self.request))

    def perform_destroy(self, instance):
        AuditService.log('inspection_schedule', instance.id, 'deleted', self._actor(self.request))
        instance.delete()

    @action(detail=True, methods=['post'], url_path='run-now')
    def run_now(self, request, pk=None):
        from apps.common.dates import add_months

        schedule = self.get_object()
        inspection = Inspection.objects.create(
            unit=schedule.unit,
            reporter_type=ReporterType.INSPECTOR,
            description=schedule.description or f'Scheduled inspection: {schedule.title}',
        )
        schedule.next_due_date = add_months(schedule.next_due_date, schedule.frequency_months)
        schedule.save(update_fields=['next_due_date'])

        AuditService.log(
            'inspection_schedule', schedule.id, 'run_now', self._actor(request),
            new_value={'inspection_id': inspection.id, 'next_due_date': str(schedule.next_due_date)},
        )
        return Response({
            'inspection_id': inspection.id,
            'next_due_date': str(schedule.next_due_date),
        }, status=status.HTTP_201_CREATED)

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'
