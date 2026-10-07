import json
import tempfile
from pathlib import Path

from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.audit.services.audit_service import AuditService
from apps.lease_agent.services import ruleset_store
from apps.users.permissions import IsOwner, IsOwnerOrManager
from .models import CustomRule, ProposalStatus, ProposalType, RuleProposal, ValidationResult
from .serializers import CustomRuleSerializer, RuleProposalSerializer, ValidationResultSerializer
from .services import policy_import


class ValidationResultViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = ValidationResult.objects.select_related('lease').all().order_by('rule_id')
    serializer_class = ValidationResultSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    @action(detail=True, methods=['post'])
    def override(self, request, pk=None):
        """Record a human override of a FAIL/UNDETERMINED rule result."""
        validation = self.get_object()
        if validation.result == 'PASS':
            return Response(
                {'detail': 'A passing rule does not need an override.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response(
                {'reason': 'An override reason is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        actor = request.user.email or request.user.username
        validation.is_overridden = True
        validation.override_reason = reason
        validation.overridden_by = actor
        validation.overridden_at = timezone.now()
        validation.save(update_fields=[
            'is_overridden', 'override_reason', 'overridden_by', 'overridden_at',
        ])
        AuditService.log(
            'validation_result', validation.id, 'rule_overridden', actor,
            previous_value={'rule_id': validation.rule_id, 'result': validation.result},
            new_value={'is_overridden': True, 'reason': reason},
        )
        return Response(ValidationResultSerializer(validation).data)

    @action(detail=True, methods=['post'], url_path='clear-override')
    def clear_override(self, request, pk=None):
        validation = self.get_object()
        if not validation.is_overridden:
            return Response(
                {'detail': 'This rule result is not overridden.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        actor = request.user.email or request.user.username
        previous_reason = validation.override_reason
        validation.is_overridden = False
        validation.override_reason = ''
        validation.overridden_by = ''
        validation.overridden_at = None
        validation.save(update_fields=[
            'is_overridden', 'override_reason', 'overridden_by', 'overridden_at',
        ])
        AuditService.log(
            'validation_result', validation.id, 'override_cleared', actor,
            previous_value={'rule_id': validation.rule_id, 'reason': previous_reason},
            new_value={'is_overridden': False},
        )
        return Response(ValidationResultSerializer(validation).data)


class LeaseRuleViewSet(viewsets.ViewSet):
    """The owner's acceptance rules, backed by sample_data/owner_ruleset.json.

    The owner can adjust description, severity, enabled, and the numeric
    thresholds in config; the check logic itself stays in ValidationEngine.
    """
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def get_permissions(self):
        if self.action in ('partial_update', 'import_file'):
            return [IsAuthenticated(), IsOwner()]
        return super().get_permissions()

    @action(detail=False, methods=['post'], url_path='import')
    def import_file(self, request):
        """Bulk-apply an uploaded ruleset JSON file (data only, never logic).

        Known rules get their editable attributes updated; unknown rules are
        reported back in `skipped` with the reason — nothing is executed.
        """
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': 'Upload a ruleset JSON file.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            data = json.loads(upload.read().decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return Response({'detail': 'The file is not valid JSON.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            report = ruleset_store.import_ruleset(data)
        except ruleset_store.RulesetError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        actor = request.user.email or request.user.username
        AuditService.log(
            'lease_rule', 0, 'ruleset_imported', actor,
            new_value={'filename': upload.name, **report},
        )
        return Response(report)

    def list(self, request):
        data = ruleset_store.load_ruleset()
        return Response({
            'ruleset_name': data.get('ruleset_name', ''),
            'version': data.get('version', ''),
            'rules': data.get('rules', []),
        })

    def partial_update(self, request, pk=None):
        changes = {k: v for k, v in request.data.items() if k in ruleset_store.EDITABLE_FIELDS}
        if not changes:
            return Response(
                {'detail': 'Nothing to update. Editable: description, severity, enabled, config.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            previous = next(
                (r for r in ruleset_store.load_ruleset().get('rules', []) if r.get('id') == pk), None,
            )
            rule = ruleset_store.update_rule(pk, changes)
        except ruleset_store.RulesetError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        actor = request.user.email or request.user.username
        AuditService.log(
            'lease_rule', 0, f'rule_{pk}_updated', actor,
            previous_value=previous, new_value=rule,
        )
        return Response(rule)


class CustomRuleViewSet(viewsets.ModelViewSet):
    """Owner-authored rules built from fixed templates (R8, R9, …).

    Evaluated by custom_rule_engine alongside the ruleset rules; results
    appear as ordinary validation cards with the same override workflow.
    """
    queryset = CustomRule.objects.all().order_by('id')
    serializer_class = CustomRuleSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAuthenticated(), IsOwner()]
        return super().get_permissions()

    def perform_create(self, serializer):
        actor = self.request.user.email or self.request.user.username
        rule = serializer.save(created_by=actor)
        AuditService.log('custom_rule', rule.id, 'created', actor,
                         new_value=CustomRuleSerializer(rule).data)

    def perform_update(self, serializer):
        actor = self.request.user.email or self.request.user.username
        previous = CustomRuleSerializer(serializer.instance).data
        rule = serializer.save()
        AuditService.log('custom_rule', rule.id, 'updated', actor,
                         previous_value=previous, new_value=CustomRuleSerializer(rule).data)

    def perform_destroy(self, instance):
        actor = self.request.user.email or self.request.user.username
        previous = CustomRuleSerializer(instance).data
        AuditService.log('custom_rule', instance.id, 'deleted', actor, previous_value=previous)
        instance.delete()

    @action(detail=False, methods=['get'])
    def options(self, request):
        """Dropdown choices for the rule-builder UI."""
        from apps.lease_agent.services.custom_rule_engine import RULE_FIELDS
        return Response({
            'fields': [{'value': v, 'label': l} for v, l in RULE_FIELDS],
            'templates': [
                {'value': 'number_compare', 'label': 'Field compared to a number',
                 'operators': ['gte', 'lte', 'eq']},
                {'value': 'field_compare', 'label': 'Field compared to another field',
                 'operators': ['gte', 'lte', 'eq']},
                {'value': 'required_field', 'label': 'Field must be present', 'operators': []},
                {'value': 'date_order', 'label': 'Date must be after another date', 'operators': []},
                {'value': 'text_check', 'label': 'Text must / must not contain words',
                 'operators': ['must_contain', 'must_not_contain']},
                {'value': 'term_length', 'label': 'Lease term length (months)',
                 'operators': ['gte', 'lte', 'eq']},
                {'value': 'allowed_values', 'label': 'Field must be one of a list',
                 'operators': []},
                {'value': 'manual_check', 'label': 'Manual check — human verifies on every lease',
                 'operators': []},
            ],
            'severities': ['high', 'medium', 'low'],
        })


class RuleProposalViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                          viewsets.GenericViewSet):
    """Rule proposals extracted from an uploaded policy document.

    The Rules Agent reads the document and proposes threshold updates or new
    template-based rules, each with its source quote. The owner approves or
    rejects each proposal; only approval changes the live rules.
    """
    queryset = RuleProposal.objects.select_related('created_rule').all()
    serializer_class = RuleProposalSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]
    filterset_fields = ['status', 'proposal_type']

    def get_permissions(self):
        if self.action in ('upload', 'approve', 'reject'):
            return [IsAuthenticated(), IsOwner()]
        return super().get_permissions()

    @action(detail=False, methods=['post'])
    def upload(self, request):
        """Upload a policy document (PDF or plain text) and extract proposals."""
        upload = request.FILES.get('document')
        if upload is None:
            return Response({'document': 'Upload a policy document (PDF or .txt).'},
                            status=status.HTTP_400_BAD_REQUEST)

        suffix = Path(upload.name).suffix.lower()
        if suffix == '.pdf':
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                for chunk in upload.chunks():
                    tmp.write(chunk)
                tmp_path = tmp.name
            try:
                from apps.lease_agent.services.pdf_extractor import PDFTextExtractor
                extracted = PDFTextExtractor().extract(tmp_path)
            except ValueError as exc:
                return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            finally:
                Path(tmp_path).unlink(missing_ok=True)
            text, pages = extracted['full_text'], extracted['pages']
        elif suffix in ('.txt', '.md'):
            try:
                text = upload.read().decode('utf-8')
            except UnicodeDecodeError:
                return Response({'detail': 'The text file is not UTF-8.'},
                                status=status.HTTP_400_BAD_REQUEST)
            pages = [{'page_number': 1, 'text': text}]
        else:
            return Response({'document': 'Only .pdf, .txt, or .md policy documents are supported.'},
                            status=status.HTTP_400_BAD_REQUEST)

        actor = request.user.email or request.user.username
        try:
            proposals = policy_import.import_policy_text(text, pages, upload.name, actor)
        except (ConnectionError, ValueError) as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        AuditService.log(
            'rule_proposal', 0, 'policy_document_imported', actor,
            new_value={'filename': upload.name, 'proposals': len(proposals)},
        )
        return Response(RuleProposalSerializer(proposals, many=True).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        proposal = self.get_object()
        if proposal.status != ProposalStatus.PENDING:
            return Response({'detail': 'This proposal has already been decided.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if proposal.proposal_type == ProposalType.NEEDS_DEVELOPER:
            return Response(
                {'detail': 'This requirement has no safe template — it needs a developer '
                           'to implement the check. It cannot be auto-approved.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        actor = request.user.email or request.user.username
        if proposal.proposal_type == ProposalType.RULE_UPDATE:
            try:
                updated_rule = policy_import.apply_rule_update(proposal)
            except ruleset_store.RulesetError as exc:
                return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            applied_to = {'rule': updated_rule}
        else:  # CUSTOM_RULE — reuse the serializer so template validation is identical
            serializer = CustomRuleSerializer(data=policy_import.validate_custom_rule_payload(proposal))
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            rule = serializer.save(created_by=actor)
            proposal.created_rule = rule
            applied_to = {'custom_rule': rule.rule_id}

        proposal.status = ProposalStatus.APPROVED
        proposal.decided_by = actor
        proposal.decided_at = timezone.now()
        proposal.save()
        AuditService.log(
            'rule_proposal', proposal.id, 'proposal_approved', actor,
            previous_value={'description': proposal.description,
                            'source_quote': proposal.source_quote[:300]},
            new_value=applied_to,
        )
        return Response(RuleProposalSerializer(proposal).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        proposal = self.get_object()
        if proposal.status != ProposalStatus.PENDING:
            return Response({'detail': 'This proposal has already been decided.'},
                            status=status.HTTP_400_BAD_REQUEST)
        actor = request.user.email or request.user.username
        proposal.status = ProposalStatus.REJECTED
        proposal.decided_by = actor
        proposal.decided_at = timezone.now()
        proposal.decision_reason = (request.data.get('reason') or '').strip()
        proposal.save(update_fields=['status', 'decided_by', 'decided_at', 'decision_reason'])
        AuditService.log(
            'rule_proposal', proposal.id, 'proposal_rejected', actor,
            previous_value={'description': proposal.description},
            new_value={'reason': proposal.decision_reason},
        )
        return Response(RuleProposalSerializer(proposal).data)
