import pytest
from apps.inspections.models import Inspection, InspectionFinding, FindingCategory
from apps.work_orders.models import WorkOrder, WorkOrderStatus
from apps.work_orders.services.work_order_generator import WorkOrderGenerator


@pytest.fixture
def client(auth_client):
    return auth_client


@pytest.fixture
def inspection(available_unit):
    return Inspection.objects.create(
        unit=available_unit, reporter_type='tenant', description='Test inspection'
    )


@pytest.fixture
def damage_finding(inspection):
    return InspectionFinding.objects.create(
        inspection=inspection,
        category=FindingCategory.DAMAGE,
        equipment_name='Bathroom Wall',
        condition='poor',
        damage_description='Visible water staining; age and cause cannot be determined.',
        confidence=0.80,
        evidence='Discoloration visible in image.',
    )


@pytest.mark.django_db
def test_work_order_generated_from_finding(inspection, damage_finding):
    generator = WorkOrderGenerator()
    orders = generator.generate_from_inspection(inspection.id)
    assert len(orders) == 1
    assert orders[0].status == WorkOrderStatus.DRAFT
    assert orders[0].unit == inspection.unit


@pytest.mark.django_db
def test_work_order_generation_is_idempotent(inspection, damage_finding):
    generator = WorkOrderGenerator()
    generator.generate_from_inspection(inspection.id)
    generator.generate_from_inspection(inspection.id)
    assert WorkOrder.objects.filter(inspection=inspection).count() == 1


@pytest.mark.django_db
def test_approve_work_order(client, inspection, damage_finding):
    generator = WorkOrderGenerator()
    orders = generator.generate_from_inspection(inspection.id)
    wo = orders[0]
    response = client.post(f'/api/v1/work-orders/{wo.id}/approve/', {'approved_by': 'owner@test.com'}, format='json')
    assert response.status_code == 200
    assert response.data['status'] == 'approved'


@pytest.mark.django_db
def test_reject_work_order_requires_reason(client, inspection, damage_finding):
    generator = WorkOrderGenerator()
    orders = generator.generate_from_inspection(inspection.id)
    wo = orders[0]
    response = client.post(f'/api/v1/work-orders/{wo.id}/reject/', {'rejected_by': 'owner@test.com'}, format='json')
    assert response.status_code == 400


@pytest.mark.django_db
def test_reject_work_order(client, inspection, damage_finding):
    generator = WorkOrderGenerator()
    orders = generator.generate_from_inspection(inspection.id)
    wo = orders[0]
    response = client.post(f'/api/v1/work-orders/{wo.id}/reject/', {
        'rejected_by': 'owner@test.com',
        'rejection_reason': 'Not urgent at this time.',
    }, format='json')
    assert response.status_code == 200
    assert response.data['status'] == 'rejected'


@pytest.mark.django_db
def test_cannot_approve_twice(client, inspection, damage_finding):
    generator = WorkOrderGenerator()
    orders = generator.generate_from_inspection(inspection.id)
    wo = orders[0]
    client.post(f'/api/v1/work-orders/{wo.id}/approve/', {'approved_by': 'owner@test.com'}, format='json')
    response = client.post(f'/api/v1/work-orders/{wo.id}/approve/', {'approved_by': 'owner@test.com'}, format='json')
    assert response.status_code == 409


@pytest.mark.django_db
def test_audit_event_on_approval(client, inspection, damage_finding):
    from apps.audit.models import AuditEvent
    generator = WorkOrderGenerator()
    orders = generator.generate_from_inspection(inspection.id)
    wo = orders[0]
    client.post(f'/api/v1/work-orders/{wo.id}/approve/', {'approved_by': 'owner@test.com'}, format='json')
    assert AuditEvent.objects.filter(entity_type='work_order', entity_id=wo.id, action='approved').exists()


@pytest.mark.django_db
def test_tenant_inspection_does_not_autogenerate_drafts(inspection, damage_finding):
    from apps.inspections.services.inspection_analysis_service import InspectionAnalysisService
    service = InspectionAnalysisService(provider=object())
    service._generate_work_orders(inspection.id)
    assert not WorkOrder.objects.filter(inspection=inspection).exists()


@pytest.mark.django_db
def test_inspector_inspection_still_autogenerates_drafts(available_unit):
    from apps.inspections.services.inspection_analysis_service import InspectionAnalysisService
    insp = Inspection.objects.create(
        unit=available_unit, reporter_type='inspector', description='Routine inspection'
    )
    InspectionFinding.objects.create(
        inspection=insp,
        category=FindingCategory.DAMAGE,
        equipment_name='AC Unit',
        condition='poor',
        damage_description='Visible leak below the unit.',
        confidence=0.85,
        evidence='Water pooling visible in image.',
    )
    InspectionAnalysisService(provider=object())._generate_work_orders(insp.id)
    assert WorkOrder.objects.filter(inspection=insp, status=WorkOrderStatus.DRAFT).count() == 1
