import os
from django.db import transaction
from django.utils import timezone

from .pdf_extractor import PDFTextExtractor
from .providers.base import LeaseExtractionProvider
from .providers.mock_provider import MockLeaseExtractionProvider
from .flagging_service import LeaseFlaggingService
from .validation_engine import ValidationEngine
from .unit_matcher import UnitMatcher


def _get_provider(name: str) -> LeaseExtractionProvider:
    if name == 'ollama':
        from .providers.ollama_provider import OllamaLeaseExtractionProvider
        return OllamaLeaseExtractionProvider()
    if name == 'openai':
        from .providers.openai_provider import OpenAILeaseExtractionProvider
        return OpenAILeaseExtractionProvider()
    return MockLeaseExtractionProvider()


class LeaseExtractionService:
    def __init__(self, provider: LeaseExtractionProvider = None):
        from django.conf import settings
        provider_name = getattr(settings, 'AI_PROVIDER', 'mock')
        self.provider = provider or _get_provider(provider_name)
        self.pdf_extractor = PDFTextExtractor()
        self.flagging_service = LeaseFlaggingService()
        self.validation_engine = ValidationEngine()
        self.unit_matcher = UnitMatcher()

    def process_lease(self, lease_id: int) -> None:
        """Public entry point — saves FAILED status even if the atomic inner call rolls back."""
        try:
            self._process_lease_atomic(lease_id)
        except Exception as exc:
            from apps.leases.models import Lease, ProcessingStatus
            Lease.objects.filter(pk=lease_id).update(
                processing_status=ProcessingStatus.FAILED,
                processing_error=str(exc)[:2000],
                processing_completed_at=timezone.now(),
            )
            raise

    @transaction.atomic
    def _process_lease_atomic(self, lease_id: int) -> None:
        from apps.leases.models import Lease, LeaseField, LeaseFlag, LeaseClause, ProcessingStatus
        from apps.validation.models import ValidationResult
        from apps.audit.services.audit_service import AuditService

        lease = Lease.objects.select_for_update().get(pk=lease_id)

        lease.processing_started_at = timezone.now()
        lease.retry_count = lease.retry_count + 1
        lease.processing_status = ProcessingStatus.PROCESSING
        lease.save(update_fields=['processing_status', 'processing_started_at', 'retry_count'])

        # Extract PDF text
        file_path = lease.document.path
        extracted = self.pdf_extractor.extract(file_path)
        document_text = extracted['full_text']
        pages = extracted['pages']

        # Persist the raw document text so it can power lease Q&A later.
        lease.extracted_text = document_text

        # Run provider extraction
        result = self.provider.extract(document_text, pages)

        # Build fields dict for downstream services
        fields_dict = {f.field_name: f.normalized_value for f in result.fields}

        # Clear previous results (allow re-processing)
        lease.fields.all().delete()
        lease.flags.all().delete()
        lease.validations.all().delete()
        lease.clauses.all().delete()

        # Persist extracted fields
        lease_fields_to_create = []
        for ef in result.fields:
            lease_fields_to_create.append(LeaseField(
                lease=lease,
                field_name=ef.field_name,
                display_label=getattr(ef, 'display_label', '') or '',
                data_type=getattr(ef, 'data_type', 'text') or 'text',
                category=getattr(ef, 'category', 'other') or 'other',
                extraction_method=getattr(ef, 'extraction_method', '') or '',
                extracted_value=ef.raw_value,
                normalized_value=ef.normalized_value,
                confidence=ef.confidence,
                source_page=ef.source_page,
                source_text=ef.source_text or '',
                has_contradiction=getattr(ef, 'has_contradiction', False),
                contradiction_note=getattr(ef, 'contradiction_note', '') or '',
            ))
        LeaseField.objects.bulk_create(lease_fields_to_create, ignore_conflicts=True)

        # Persist dynamically discovered clauses
        additional_clauses = result.raw_output.get('additional_clauses', [])
        clause_objects = []
        for clause_data in additional_clauses:
            if not isinstance(clause_data, dict):
                continue
            clause_objects.append(LeaseClause(
                lease=lease,
                clause_type=clause_data.get('clause_type') or 'general',
                title=(clause_data.get('title') or '')[:255],
                raw_text=clause_data.get('raw_text') or '',
                interpretation=clause_data.get('interpretation') or '',
                source_type='explicit' if clause_data.get('source_type') != 'interpreted' else 'interpreted',
                source_page=clause_data.get('source_page'),
                source_text=clause_data.get('source_text') or '',
                confidence=clause_data.get('confidence'),
                is_unusual=bool(clause_data.get('is_unusual') or False),
                unusual_reason=clause_data.get('unusual_reason') or '',
            ))
        if clause_objects:
            LeaseClause.objects.bulk_create(clause_objects)

        # Update lease summary fields
        self._update_lease_summary(lease, fields_dict)

        # Detect flags
        flags = self.flagging_service.detect_flags(fields_dict)
        flag_objects = [
            LeaseFlag(
                lease=lease,
                flag_type=f['flag_type'],
                severity=f['severity'],
                description=f['description'],
                related_fields=f['related_fields'],
                source_reference=f.get('source_reference', ''),
            )
            for f in flags
        ]
        LeaseFlag.objects.bulk_create(flag_objects)

        # Run validation rules. Manual-check rules scan the document text
        # for supporting evidence, passed via a reserved key.
        rule_results = self.validation_engine.validate(
            {**fields_dict, '_document_text': lease.extracted_text or ''}
        )
        validation_objects = [
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
        ]
        ValidationResult.objects.bulk_create(validation_objects)

        # Unit matching
        match = self.unit_matcher.match(fields_dict.get('unit_id', ''))
        if match.status == 'exact':
            lease.unit_id = match.unit_id
        elif match.status in ('no_match', 'ambiguous'):
            LeaseFlag.objects.create(
                lease=lease,
                flag_type='unit_match_required',
                severity='high',
                description=match.message,
                related_fields=['unit_id'],
            )

        lease.processing_status = ProcessingStatus.COMPLETED
        lease.processing_completed_at = timezone.now()
        lease.provider_used = result.provider_name
        lease.processing_error = ''
        lease.save(update_fields=[
            'unit', 'processing_status', 'processing_completed_at',
            'provider_used', 'processing_error', 'updated_at',
            'tenant_name', 'landlord_name', 'start_date', 'end_date',
            'rent_amount', 'currency', 'rent_frequency', 'deposit_amount',
            'annual_rent', 'escalation_clause', 'renewal_terms',
            'termination_terms', 'extracted_unit_id', 'extracted_text',
        ])

        AuditService.log('lease', lease.id, 'extraction_completed', result.provider_name,
                         new_value={'fields_extracted': len(result.fields), 'flags': len(flags)})

    def _update_lease_summary(self, lease, fields_dict: dict):
        def _safe(key, default=None):
            v = fields_dict.get(key)
            return None if (v is None or v == 'NOT_FOUND' or v == '') else v

        from datetime import date as date_type
        def _to_date(val):
            if val is None:
                return None
            if isinstance(val, date_type):
                return val
            try:
                return date_type.fromisoformat(str(val))
            except (ValueError, TypeError):
                return None

        lease.tenant_name = _safe('tenant_name') or ''
        lease.landlord_name = _safe('landlord_name') or ''
        lease.start_date = _to_date(_safe('start_date'))
        lease.end_date = _to_date(_safe('end_date'))

        rent = _safe('rent_amount')
        lease.rent_amount = float(rent) if rent is not None else None
        lease.currency = _safe('currency') or ''
        lease.rent_frequency = _safe('rent_frequency') or ''

        deposit = _safe('deposit_amount')
        lease.deposit_amount = float(deposit) if deposit is not None else None

        annual = _safe('annual_rent')
        lease.annual_rent = float(annual) if annual is not None else None

        lease.escalation_clause = _safe('escalation_clause') or ''
        lease.renewal_terms = _safe('renewal_terms') or ''
        lease.termination_terms = _safe('termination_terms') or ''
        lease.extracted_unit_id = _safe('unit_id') or ''
