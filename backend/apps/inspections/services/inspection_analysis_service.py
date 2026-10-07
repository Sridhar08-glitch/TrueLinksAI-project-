import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from apps.inspections.models import Inspection, InspectionFinding, InspectionStatus
from apps.audit.services.audit_service import AuditService

logger = logging.getLogger(__name__)


def _default_provider():
    # Unified with lease extraction: both read settings.AI_PROVIDER.
    ai_provider = str(getattr(settings, 'AI_PROVIDER', 'mock')).lower()
    if ai_provider == 'ollama':
        from .ollama_vision_provider import OllamaVisionProvider
        return OllamaVisionProvider()
    if ai_provider == 'openai':
        from .openai_vision_provider import OpenAIVisionProvider
        return OpenAIVisionProvider()
    from .mock_vision_provider import MockVisionProvider
    return MockVisionProvider()


class InspectionAnalysisService:
    def __init__(self, provider=None):
        self.provider = provider or _default_provider()

    def analyze(self, inspection_id: int) -> None:
        """Public entry — saves FAILED status even if the atomic inner call rolls back."""
        try:
            self._analyze_atomic(inspection_id)
        except Exception as exc:
            Inspection.objects.filter(pk=inspection_id).update(
                status=InspectionStatus.FAILED,
            )
            AuditService.log('inspection', inspection_id, 'analysis_failed', 'system',
                             new_value={'error': str(exc)[:500]})
            raise

        # Analysis succeeded — generate draft work orders for damage/equipment findings.
        self._generate_work_orders(inspection_id)

    def _generate_work_orders(self, inspection_id: int) -> None:
        """Auto-generate draft work orders from the completed analysis.

        Best-effort: failures are logged but never fail the analysis itself.
        Skips generation entirely if work orders already exist for this
        inspection (previous findings were replaced, so finding-level
        idempotency alone cannot prevent duplicates). Also skips
        tenant-reported inspections: a tenant report becomes exactly one
        work order — the request the tenant submits — and per-finding
        drafts would duplicate it."""
        try:
            from apps.work_orders.models import WorkOrder
            from apps.work_orders.services.work_order_generator import WorkOrderGenerator

            if WorkOrder.objects.filter(inspection_id=inspection_id).exists():
                return
            if Inspection.objects.filter(pk=inspection_id, reporter_type='tenant').exists():
                return
            created = WorkOrderGenerator().generate_from_inspection(inspection_id)
            if created:
                logger.info(
                    'Generated %d draft work order(s) from inspection %d',
                    len(created), inspection_id,
                )
        except Exception:
            logger.exception('Work order generation failed for inspection %d', inspection_id)

    @transaction.atomic
    def _analyze_atomic(self, inspection_id: int) -> None:
        inspection = Inspection.objects.select_for_update().get(pk=inspection_id)

        images = inspection.images.all()
        if not images.exists():
            raise ValueError('No images uploaded for this inspection.')

        # Clear previous findings
        inspection.findings.all().delete()

        all_findings = []
        for img in images:
            findings = self.provider.analyze(img.id, img.image.path)
            for f in findings:
                all_findings.append(InspectionFinding(
                    inspection=inspection,
                    image=img,
                    category=f.category,
                    equipment_name=f.equipment_name,
                    condition=f.condition,
                    damage_description=f.damage_description,
                    confidence=f.confidence,
                    evidence=f.evidence,
                ))

        InspectionFinding.objects.bulk_create(all_findings)

        inspection.status = InspectionStatus.COMPLETED
        inspection.analyzed_at = timezone.now()
        inspection.save(update_fields=['status', 'analyzed_at', 'updated_at'])

        AuditService.log(
            'inspection', inspection.id, 'analysis_completed',
            self.provider.PROVIDER_NAME,
            new_value={'findings_count': len(all_findings)},
        )
