"""Scheduled inspections (CRUD + run-now) and work-order verification view."""
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from apps.inspections.models import Inspection, InspectionSchedule, InspectionFinding
from apps.users.models import UserProfile, UserRole
from apps.work_orders.models import WorkOrder, WorkOrderStatus


@pytest.fixture
def maintenance_client(db):
    user = User.objects.create_user(
        username='maint', email='maint@test.com', password='testpass123'
    )
    UserProfile.objects.create(user=user, role=UserRole.MAINTENANCE_STAFF)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestInspectionSchedules:
    def test_owner_creates_schedule(self, auth_client, available_unit):
        resp = auth_client.post('/api/v1/inspection-schedules/', {
            'unit': available_unit.id,
            'title': 'Quarterly HVAC check',
            'description': 'Filters, coils, thermostat.',
            'frequency_months': 3,
            'next_due_date': '2026-11-01',
        }, format='json')
        assert resp.status_code == 201
        assert resp.data['frequency_months'] == 3

    def test_maintenance_can_read_but_not_write(self, maintenance_client, available_unit):
        InspectionSchedule.objects.create(
            unit=available_unit, title='Check', next_due_date=date(2026, 11, 1),
        )
        resp = maintenance_client.get('/api/v1/inspection-schedules/')
        assert resp.status_code == 200
        assert resp.data['count'] == 1

        resp = maintenance_client.post('/api/v1/inspection-schedules/', {
            'unit': available_unit.id, 'title': 'Nope', 'next_due_date': '2026-11-01',
        }, format='json')
        assert resp.status_code == 403

    def test_tenant_denied(self, tenant_client):
        resp = tenant_client.get('/api/v1/inspection-schedules/')
        assert resp.status_code == 403

    def test_run_now_creates_inspection_and_advances_date(self, auth_client, available_unit):
        schedule = InspectionSchedule.objects.create(
            unit=available_unit, title='Safety walkthrough',
            description='Check smoke detectors.',
            frequency_months=3, next_due_date=date(2026, 10, 10),
        )
        resp = auth_client.post(f'/api/v1/inspection-schedules/{schedule.id}/run-now/')
        assert resp.status_code == 201
        inspection = Inspection.objects.get(pk=resp.data['inspection_id'])
        assert inspection.unit_id == available_unit.id
        assert inspection.reporter_type == 'inspector'
        assert 'smoke detectors' in inspection.description

        schedule.refresh_from_db()
        assert schedule.next_due_date == date(2027, 1, 10)

    def test_due_schedule_appears_in_notifications(self, auth_client, available_unit):
        schedule = InspectionSchedule.objects.create(
            unit=available_unit, title='Due soon check',
            next_due_date=date.today() + timedelta(days=3),
        )
        resp = auth_client.get('/api/v1/notifications/')
        assert resp.status_code == 200
        keys = [n['id'] for n in resp.data['results']]
        assert f'schedule:{schedule.id}:due' in keys


@pytest.mark.django_db
class TestWorkOrderVerification:
    def _wo_with_source_inspection(self, unit):
        source = Inspection.objects.create(unit=unit, reporter_type='tenant', description='Leak')
        finding = InspectionFinding.objects.create(
            inspection=source, category='damage', condition='poor',
            damage_description='Water damage under sink', confidence=0.9,
        )
        wo = WorkOrder.objects.create(
            unit=unit, inspection=source, finding=finding,
            title='Fix leak', description='Repair sink leak',
            status=WorkOrderStatus.APPROVED, generated_by='ai_agent',
        )
        return wo, source

    def test_verification_before_and_after(self, auth_client, available_unit):
        wo, source = self._wo_with_source_inspection(available_unit)

        # Create an "after" inspection linked to the work order via the API
        resp = auth_client.post('/api/v1/inspections/', {
            'unit': available_unit.id,
            'reporter_type': 'inspector',
            'description': 'Post-repair verification',
            'work_order': wo.id,
        }, format='json')
        assert resp.status_code == 201
        after_id = resp.data['id']
        assert Inspection.objects.get(pk=after_id).work_order_id == wo.id

        resp = auth_client.get(f'/api/v1/work-orders/{wo.id}/verification/')
        assert resp.status_code == 200
        assert resp.data['before']['inspection_id'] == source.id
        assert len(resp.data['before']['findings']) == 1
        assert len(resp.data['after']) == 1
        assert resp.data['after'][0]['inspection_id'] == after_id

    def test_verification_manual_wo_has_null_before(self, auth_client, available_unit):
        wo = WorkOrder.objects.create(
            unit=available_unit, title='Paint wall', description='Repaint',
            status=WorkOrderStatus.APPROVED, generated_by='manual:owner@test.com',
        )
        resp = auth_client.get(f'/api/v1/work-orders/{wo.id}/verification/')
        assert resp.status_code == 200
        assert resp.data['before'] is None
        assert resp.data['after'] == []

    def test_create_inspection_with_bad_work_order_is_400(self, auth_client, available_unit):
        resp = auth_client.post('/api/v1/inspections/', {
            'unit': available_unit.id,
            'reporter_type': 'inspector',
            'description': 'x',
            'work_order': 999999,
        }, format='json')
        assert resp.status_code == 400

    def test_tenant_cannot_link_work_order(self, tenant_client, tenant_user, owner_user, available_unit):
        from apps.users.models import TenantAssignment
        TenantAssignment.objects.create(
            unit=available_unit, tenant=tenant_user, assigned_by=owner_user,
        )
        wo = WorkOrder.objects.create(
            unit=available_unit, title='T', description='D',
            status=WorkOrderStatus.APPROVED,
        )
        resp = tenant_client.post('/api/v1/inspections/', {
            'unit': available_unit.id,
            'reporter_type': 'tenant',
            'description': 'x',
            'work_order': wo.id,
        }, format='json')
        assert resp.status_code == 400
