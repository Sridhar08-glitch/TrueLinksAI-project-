import pytest

from apps.leases.models import Lease
from apps.users.models import TenantAssignment

pytestmark = pytest.mark.django_db


def test_tenant_can_access_notifications(tenant_client):
    res = tenant_client.get('/api/v1/notifications/')
    assert res.status_code == 200
    assert res.data['results'] == []


def test_tenant_sees_their_approved_lease(tenant_client, tenant_user, available_unit):
    TenantAssignment.objects.create(unit=available_unit, tenant=tenant_user, is_active=True)
    Lease.objects.create(
        unit=available_unit,
        tenant_name='Test Tenant',
        approval_status='approved',
    )
    res = tenant_client.get('/api/v1/notifications/')
    assert res.status_code == 200
    titles = [n['title'] for n in res.data['results']]
    assert 'Lease Approved' in titles
    lease_item = next(n for n in res.data['results'] if n['title'] == 'Lease Approved')
    assert lease_item['link'] == '/tenant/documents'


def test_tenant_does_not_see_other_units_leases(tenant_client, available_unit):
    Lease.objects.create(
        unit=available_unit,
        tenant_name='Someone Else',
        approval_status='approved',
    )
    res = tenant_client.get('/api/v1/notifications/')
    assert res.data['results'] == []


def test_tenant_does_not_see_staff_notifications(tenant_client, available_unit):
    Lease.objects.create(
        unit=available_unit,
        tenant_name='Pending Person',
        processing_status='completed',
        approval_status='pending_review',
    )
    res = tenant_client.get('/api/v1/notifications/')
    assert all(n['title'] != 'Lease Ready for Review' for n in res.data['results'])


def test_tenant_can_mark_notification_read(tenant_client, tenant_user, available_unit):
    TenantAssignment.objects.create(unit=available_unit, tenant=tenant_user, is_active=True)
    lease = Lease.objects.create(
        unit=available_unit, tenant_name='Test Tenant', approval_status='approved',
    )
    key = f'lease:{lease.id}:tenant-approved'
    res = tenant_client.post(f'/api/v1/notifications/{key}/mark_read/')
    assert res.status_code == 200
    res = tenant_client.get('/api/v1/notifications/')
    item = next(n for n in res.data['results'] if n['id'] == key)
    assert item['is_read'] is True
