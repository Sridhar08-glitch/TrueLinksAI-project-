from django.db import transaction
from apps.inspections.models import InspectionFinding, FindingCategory
from apps.work_orders.models import WorkOrder, WorkOrderPriority, WorkOrderStatus


def _priority_from_finding(finding: InspectionFinding) -> str:
    if finding.confidence >= 0.80 and finding.category == FindingCategory.DAMAGE:
        return WorkOrderPriority.URGENT
    if finding.category == FindingCategory.DAMAGE:
        return WorkOrderPriority.HIGH
    if finding.category == FindingCategory.EQUIPMENT:
        return WorkOrderPriority.MEDIUM
    return WorkOrderPriority.LOW


class WorkOrderGenerator:
    @transaction.atomic
    def generate_from_inspection(self, inspection_id: int) -> list[WorkOrder]:
        from apps.inspections.models import Inspection

        inspection = Inspection.objects.select_related('unit').get(pk=inspection_id)
        findings = inspection.findings.filter(
            category__in=[FindingCategory.DAMAGE, FindingCategory.EQUIPMENT],
        )

        created = []
        for finding in findings:
            # Idempotent — don't create duplicate WO for same finding
            if WorkOrder.objects.filter(finding=finding).exists():
                continue

            title = self._build_title(finding)
            description = self._build_description(finding)

            wo = WorkOrder.objects.create(
                unit=inspection.unit,
                inspection=inspection,
                finding=finding,
                title=title,
                description=description,
                priority=_priority_from_finding(finding),
                status=WorkOrderStatus.DRAFT,
                generated_by='ai_agent',
            )
            created.append(wo)

        return created

    def _build_title(self, finding: InspectionFinding) -> str:
        subject = finding.equipment_name or finding.get_category_display()
        condition = finding.condition or 'issue'
        return f'{subject} — {condition} condition reported'[:255]

    def _build_description(self, finding: InspectionFinding) -> str:
        parts = []
        if finding.damage_description:
            parts.append(finding.damage_description)
        if finding.evidence:
            parts.append(f'Evidence: {finding.evidence}')
        parts.append(
            f'Confidence: {round((finding.confidence or 0) * 100)}%. '
            'This is a draft work order generated from an inspection report. '
            'Owner approval required before any action is taken.'
        )
        return '\n\n'.join(parts)
