from datetime import timedelta

from django.db.models import Case, When, Value, IntegerField
from django.utils import timezone
from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from django_filters.rest_framework import DjangoFilterBackend

from apps.audit.services.audit_service import AuditService
from apps.users.permissions import IsOwnerOrManager
from .models import Lease, LeaseField, LeaseFlag, LeaseClause, ReviewStatus, FlagStatus, ApprovalStatus
from .serializers import (
    LeaseSerializer, LeaseUploadSerializer, LeaseUpdateSerializer,
    LeaseManualCreateSerializer,
    LeaseFieldSerializer, LeaseFlagSerializer, LeaseClauseSerializer,
    LeaseClauseCreateSerializer, LeaseClauseUpdateSerializer,
    LeaseFieldApproveSerializer, LeaseFieldRejectSerializer,
    LeaseFlagReviewSerializer, LeaseResolveUnitSerializer,
    LeaseApproveSerializer, LeaseRejectSerializer, LeaseCancelSerializer,
)

class AIRateThrottle(UserRateThrottle):
    """Per-user rate limit for AI endpoints, rate from THROTTLE_RATES['ai']."""
    scope = 'ai'


SEVERITY_RANK = Case(
    When(severity='critical', then=Value(0)),
    When(severity='high', then=Value(1)),
    When(severity='medium', then=Value(2)),
    When(severity='low', then=Value(3)),
    default=Value(4),
    output_field=IntegerField(),
)

# A lease stuck in PROCESSING longer than this may be reprocessed.
STALE_PROCESSING_MINUTES = 10


class LeaseViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated, IsOwnerOrManager]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['processing_status', 'approval_status', 'is_cancelled', 'unit']
    search_fields = ['tenant_name', 'landlord_name', 'extracted_unit_id']
    ordering_fields = ['created_at', 'start_date', 'end_date', 'rent_amount']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = Lease.objects.select_related('unit').prefetch_related('flags').filter(is_cancelled=False)

        # ?expiring_within=<days> — approved leases ending between today and today+days.
        expiring_within = self.request.query_params.get('expiring_within')
        if self.action == 'list' and expiring_within:
            try:
                days = int(expiring_within)
            except (TypeError, ValueError):
                days = None
            if days is not None and days >= 0:
                today = timezone.localdate()
                qs = qs.filter(
                    approval_status=ApprovalStatus.APPROVED,
                    end_date__gte=today,
                    end_date__lte=today + timedelta(days=days),
                ).order_by('end_date')
                # Make OrderingFilter's default ordering match — otherwise it
                # re-applies '-created_at' on top of the end_date ordering.
                self.ordering = ['end_date']
        return qs

    def get_serializer_class(self):
        if self.action in ('update', 'partial_update'):
            return LeaseUpdateSerializer
        return LeaseSerializer

    # ── Manual Create ─────────────────────────────────────────────────────────
    def create(self, request, *args, **kwargs):
        from .models import ProcessingStatus, ApprovalStatus
        serializer = LeaseManualCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        lease = serializer.save(
            processing_status=ProcessingStatus.COMPLETED,
            approval_status=ApprovalStatus.PENDING_REVIEW,
            provider_used='manual',
        )
        # The unit is NOT marked occupied here — only an approved lease occupies a unit.
        AuditService.log('lease', lease.id, 'created_manually', self._actor(request),
                         new_value={'tenant': lease.tenant_name, 'unit': str(lease.unit)})
        return Response(LeaseSerializer(lease, context={'request': request}).data, status=status.HTTP_201_CREATED)

    # ── Upload ────────────────────────────────────────────────────────────────
    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request):
        serializer = LeaseUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        doc = request.FILES.get('document')
        if not doc:
            return Response({'document': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)
        if not doc.name.lower().endswith('.pdf'):
            return Response({'document': 'Only PDF files are accepted.'}, status=status.HTTP_400_BAD_REQUEST)

        from django.conf import settings as django_settings
        max_bytes = django_settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        if doc.size > max_bytes:
            return Response(
                {'document': f'File exceeds maximum size of {django_settings.MAX_UPLOAD_SIZE_MB}MB.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lease = serializer.save()
        AuditService.log('lease', lease.id, 'uploaded', self._actor(request), new_value={'document': doc.name})
        return Response(LeaseSerializer(lease, context={'request': request}).data, status=status.HTTP_201_CREATED)

    # ── Process ───────────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def process(self, request, pk=None):
        import threading
        from .models import ProcessingStatus
        lease = self.get_object()

        # Atomically claim the lease for processing. A lease already PROCESSING is
        # only reclaimable if it has been stuck for more than STALE_PROCESSING_MINUTES —
        # this conditional UPDATE prevents a double-start race.
        from django.db.models import Q
        now = timezone.now()
        stale_cutoff = now - timedelta(minutes=STALE_PROCESSING_MINUTES)
        claimed = Lease.objects.filter(pk=lease.pk).filter(
            ~Q(processing_status=ProcessingStatus.PROCESSING) | Q(updated_at__lt=stale_cutoff)
        ).update(processing_status=ProcessingStatus.PROCESSING, updated_at=now)
        if not claimed:
            return Response({'detail': 'Lease is already being processed.'}, status=status.HTTP_409_CONFLICT)

        from apps.lease_agent.services.lease_extraction_service import LeaseExtractionService

        def _run(lease_id: int):
            from django.db import connection
            try:
                service = LeaseExtractionService()
                service.process_lease(lease_id)
            except Exception as exc:
                # process_lease() sets FAILED status for extraction errors and re-raises.
                # This handles failures during service init (e.g., Ollama not running).
                try:
                    from .models import ProcessingStatus
                    Lease.objects.filter(
                        pk=lease_id,
                        processing_status=ProcessingStatus.PROCESSING,
                    ).update(
                        processing_status=ProcessingStatus.FAILED,
                        processing_error=f'Processing failed: {str(exc)[:500]}',
                        processing_completed_at=timezone.now(),
                    )
                except Exception:
                    pass
            finally:
                connection.close()

        t = threading.Thread(target=_run, args=(lease.id,), daemon=True)
        t.start()

        return Response({'detail': 'Processing started. Refresh in a few moments to see the results.'}, status=status.HTTP_202_ACCEPTED)

    # ── Approve whole lease ───────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        from .models import ProcessingStatus
        lease = self.get_object()
        if lease.approval_status == ApprovalStatus.APPROVED:
            return Response({'detail': 'Lease already approved.'}, status=status.HTTP_409_CONFLICT)

        serializer = LeaseApproveSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        if lease.processing_status != ProcessingStatus.COMPLETED and lease.provider_used != 'manual':
            return Response(
                {'detail': 'Lease extraction must be completed before approval.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not lease.unit_id:
            return Response(
                {'detail': 'Lease must be linked to a unit before approval. Use resolve-unit first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Actor always comes from the authenticated user — body values are ignored.
        actor = self._actor(request)
        prev = lease.approval_status
        lease.approval_status = ApprovalStatus.APPROVED
        lease.save(update_fields=['approval_status', 'updated_at'])

        from apps.units.services import occupancy
        occupancy.mark_occupied(lease.unit)

        # Auto-generate the rent payment schedule — best-effort, never blocks approval.
        try:
            from apps.payments.services.schedule_generator import generate_for_lease
            generate_for_lease(lease)
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                'Failed to generate payment schedule for lease %s', lease.id
            )

        AuditService.log(
            'lease', lease.id, 'approved', actor,
            previous_value={'approval_status': prev},
            new_value={'approval_status': ApprovalStatus.APPROVED},
        )
        return Response(LeaseSerializer(lease, context={'request': request}).data)

    # ── Reject whole lease ────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        lease = self.get_object()
        if lease.approval_status == ApprovalStatus.REJECTED:
            return Response({'detail': 'Lease already rejected.'}, status=status.HTTP_409_CONFLICT)

        serializer = LeaseRejectSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        actor = self._actor(request)
        prev = lease.approval_status
        lease.approval_status = ApprovalStatus.REJECTED
        lease.save(update_fields=['approval_status', 'updated_at'])

        # Only free the unit if this lease had been approved (and therefore occupied it).
        if prev == ApprovalStatus.APPROVED and lease.unit:
            from apps.units.services import occupancy
            occupancy.mark_available(lease.unit)

        AuditService.log(
            'lease', lease.id, 'rejected', actor,
            previous_value={'approval_status': prev},
            new_value={'approval_status': ApprovalStatus.REJECTED},
        )
        return Response(LeaseSerializer(lease, context={'request': request}).data)

    # ── Cancel (soft delete) ──────────────────────────────────────────────────
    @action(detail=True, methods=['delete', 'post'], url_path='cancel')
    def cancel(self, request, pk=None):
        from .models import ProcessingStatus
        lease = self.get_object()
        if lease.is_cancelled:
            return Response({'detail': 'Lease is already cancelled.'}, status=status.HTTP_409_CONFLICT)
        if lease.processing_status == ProcessingStatus.PROCESSING:
            return Response(
                {'detail': 'Cannot cancel a lease while AI extraction is in progress. Please wait for it to complete.'},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = LeaseCancelSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        actor = self._actor(request)
        was_approved = lease.approval_status == ApprovalStatus.APPROVED
        lease.is_cancelled = True
        lease.cancel_reason = serializer.validated_data['cancel_reason']
        lease.cancelled_by = actor
        lease.cancelled_at = timezone.now()
        lease.save(update_fields=['is_cancelled', 'cancel_reason', 'cancelled_by', 'cancelled_at', 'updated_at'])

        # Free the unit if this was an approved active lease
        if lease.unit and was_approved:
            from apps.units.services import occupancy
            occupancy.mark_available(lease.unit)

        AuditService.log(
            'lease', lease.id, 'cancelled', actor,
            new_value={'cancel_reason': lease.cancel_reason},
        )
        return Response({'detail': 'Lease cancelled successfully.'})

    # ── Cancelled leases list ─────────────────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='cancelled')
    def cancelled(self, request):
        qs = Lease.objects.filter(is_cancelled=True).select_related('unit').prefetch_related('flags').order_by('-cancelled_at')
        return Response(LeaseSerializer(qs, many=True, context={'request': request}).data)

    # ── Related sub-resources ─────────────────────────────────────────────────
    @action(detail=True, methods=['get'])
    def fields(self, request, pk=None):
        lease = self.get_object()
        qs = lease.fields.all().order_by('field_name')
        return Response(LeaseFieldSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'])
    def validations(self, request, pk=None):
        lease = self.get_object()
        from apps.validation.models import ValidationResult
        from apps.validation.serializers import ValidationResultSerializer
        qs = lease.validations.all().order_by('rule_id')
        return Response(ValidationResultSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'])
    def revalidate(self, request, pk=None):
        """Re-run the owner's rules against the already-extracted fields.

        Used after the owner edits the ruleset — no AI re-extraction needed.
        Existing overrides are discarded because the rule outcomes may change.
        """
        lease = self.get_object()
        from apps.lease_agent.services.validation_engine import ValidationEngine
        from apps.validation.models import ValidationResult
        from apps.validation.serializers import ValidationResultSerializer

        fields_dict = {f.field_name: f.normalized_value for f in lease.fields.all()}
        if not fields_dict:
            return Response(
                {'detail': 'This lease has no extracted fields to validate. Process it first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Manual-check rules scan the document text for supporting evidence.
        fields_dict['_document_text'] = lease.extracted_text or ''
        rule_results = ValidationEngine().validate(fields_dict)
        lease.validations.all().delete()
        ValidationResult.objects.bulk_create([
            ValidationResult(
                lease=lease,
                rule_id=r.rule_id,
                rule_name=r.rule_name,
                result=r.result,
                reason=r.reason,
                evaluated_value=r.evaluated_value,
                expected_condition=r.expected_condition,
                severity=r.severity,
            )
            for r in rule_results
        ])
        actor = self._actor(request)
        AuditService.log(
            'lease', lease.id, 'revalidated', actor,
            new_value={'rules_evaluated': len(rule_results)},
        )
        qs = lease.validations.all().order_by('rule_id')
        return Response(ValidationResultSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'])
    def flags(self, request, pk=None):
        lease = self.get_object()
        qs = lease.flags.all().annotate(severity_rank=SEVERITY_RANK).order_by('severity_rank', 'status')
        return Response(LeaseFlagSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'])
    def clauses(self, request, pk=None):
        lease = self.get_object()
        qs = lease.clauses.all().order_by('clause_type', 'created_at')
        return Response(LeaseClauseSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='resolve-unit')
    def resolve_unit(self, request, pk=None):
        lease = self.get_object()
        serializer = LeaseResolveUnitSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        from apps.units.models import Unit
        try:
            unit = Unit.objects.get(pk=serializer.validated_data['unit_id'])
        except Unit.DoesNotExist:
            return Response({'unit_id': 'Unit not found.'}, status=status.HTTP_404_NOT_FOUND)

        prev = lease.unit_id
        lease.unit = unit
        lease.save(update_fields=['unit', 'updated_at'])
        AuditService.log(
            'lease', lease.id, 'unit_resolved',
            self._actor(request),
            previous_value={'unit_id': prev},
            new_value={'unit_id': unit.id, 'external_unit_id': unit.external_unit_id},
        )
        return Response(LeaseSerializer(lease, context={'request': request}).data)

    # ── Rent payment schedule (manual trigger) ────────────────────────────────
    @action(detail=True, methods=['post'], url_path='generate-schedule')
    def generate_schedule(self, request, pk=None):
        lease = self.get_object()
        if not lease.start_date or not lease.end_date or lease.rent_amount is None:
            return Response(
                {'detail': 'Lease needs a start date, end date and rent amount before a schedule can be generated.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.payments.services.schedule_generator import generate_for_lease
        created = generate_for_lease(lease)
        AuditService.log('lease', lease.id, 'payment_schedule_generated', self._actor(request),
                         new_value={'items_created': created})
        return Response({'created': created})

    # ── AI lease Q&A ──────────────────────────────────────────────────────────
    @action(detail=True, methods=['post'], throttle_classes=[AIRateThrottle])
    def ask(self, request, pk=None):
        lease = self.get_object()
        question = str(request.data.get('question', '')).strip()
        if not question:
            return Response({'question': ['A question is required.']}, status=status.HTTP_400_BAD_REQUEST)
        if not lease.extracted_text:
            return Response(
                {'detail': 'This lease has no extracted text yet. Run AI processing on the lease document first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .services import lease_qa
        try:
            result = lease_qa.ask_lease_question(lease, question)
        except ConnectionError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        AuditService.log('lease', lease.id, 'question_asked', self._actor(request),
                         new_value={'question': question[:500]})
        return Response(result)

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'


class LeaseFieldViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = LeaseField.objects.select_related('lease').all().order_by('field_name')
    serializer_class = LeaseFieldSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['lease', 'review_status', 'category', 'extraction_method']

    def _actor(self, request):
        if request.user and request.user.is_authenticated:
            return request.user.email or request.user.username
        return 'system'

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        field = self.get_object()
        if field.review_status == ReviewStatus.APPROVED:
            return Response({'detail': 'Field already approved.'}, status=status.HTTP_409_CONFLICT)

        serializer = LeaseFieldApproveSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        prev = field.review_status
        field.review_status = ReviewStatus.APPROVED
        field.reviewed_by = self._actor(request)
        field.reviewed_at = timezone.now()
        if 'reviewed_value' in serializer.validated_data:
            field.reviewed_value = serializer.validated_data['reviewed_value']
        field.save()

        AuditService.log(
            'lease_field', field.id, 'approved', field.reviewed_by,
            previous_value={'review_status': prev},
            new_value={'review_status': ReviewStatus.APPROVED, 'reviewed_value': field.reviewed_value},
        )
        return Response(LeaseFieldSerializer(field).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        field = self.get_object()
        if field.review_status == ReviewStatus.APPROVED:
            return Response({'detail': 'Cannot reject an already-approved field.'}, status=status.HTTP_409_CONFLICT)

        serializer = LeaseFieldRejectSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        prev = field.review_status
        field.review_status = ReviewStatus.REJECTED
        field.reviewed_by = self._actor(request)
        field.reviewed_at = timezone.now()
        field.rejection_reason = serializer.validated_data.get('reason', '') or ''
        field.save()

        AuditService.log(
            'lease_field', field.id, 'rejected', field.reviewed_by,
            previous_value={'review_status': prev},
            new_value={'review_status': ReviewStatus.REJECTED, 'rejection_reason': field.rejection_reason},
        )
        return Response(LeaseFieldSerializer(field).data)

    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        ids = request.data.get('ids', [])
        reviewed_by = self._actor(request)
        if not ids:
            return Response({'ids': 'At least one ID required.'}, status=status.HTTP_400_BAD_REQUEST)

        fields = LeaseField.objects.filter(id__in=ids, review_status=ReviewStatus.PENDING)
        count = fields.count()
        fields.update(
            review_status=ReviewStatus.APPROVED,
            reviewed_by=reviewed_by,
            reviewed_at=timezone.now(),
        )
        return Response({'approved': count})


class LeaseFlagViewSet(mixins.RetrieveModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = LeaseFlag.objects.select_related('lease').all()
    serializer_class = LeaseFlagSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['lease', 'status', 'severity', 'flag_type']

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        flag = self.get_object()
        serializer = LeaseFlagReviewSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        action_map = {
            'acknowledge': FlagStatus.ACKNOWLEDGED,
            'resolve': FlagStatus.RESOLVED,
            'dismiss': FlagStatus.DISMISSED,
        }
        actor = request.user.email or request.user.username
        prev = flag.status
        flag.status = action_map[serializer.validated_data['action']]
        flag.reviewed_by = actor
        flag.reviewed_at = timezone.now()
        flag.reviewer_comment = serializer.validated_data.get('reviewer_comment', '')
        flag.save()

        AuditService.log(
            'lease_flag', flag.id, f'flag_{serializer.validated_data["action"]}',
            actor,
            previous_value={'status': prev},
            new_value={'status': flag.status},
        )
        return Response(LeaseFlagSerializer(flag).data)


class LeaseClauseViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = LeaseClause.objects.select_related('lease').all().order_by('clause_type', 'created_at')
    permission_classes = [IsAuthenticated, IsOwnerOrManager]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['lease', 'clause_type', 'is_unusual', 'review_status']

    def get_serializer_class(self):
        if self.action == 'create':
            return LeaseClauseCreateSerializer
        if self.action in ('update', 'partial_update'):
            return LeaseClauseUpdateSerializer
        return LeaseClauseSerializer

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        clause = self.get_object()
        review_status = request.data.get('review_status')
        reviewed_by = request.user.email or request.user.username
        if review_status not in ('approved', 'rejected', 'needs_correction'):
            return Response({'review_status': 'Must be approved, rejected, or needs_correction.'}, status=status.HTTP_400_BAD_REQUEST)
        clause.review_status = review_status
        clause.reviewed_by = reviewed_by
        clause.reviewed_at = timezone.now()
        clause.save(update_fields=['review_status', 'reviewed_by', 'reviewed_at'])
        AuditService.log('lease_clause', clause.id, f'clause_{review_status}', reviewed_by)
        return Response(LeaseClauseSerializer(clause).data)
