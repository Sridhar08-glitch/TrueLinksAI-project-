import pytest
from django.core.management import call_command


@pytest.fixture
def client(auth_client):
    return auth_client


@pytest.mark.django_db
def test_unit_list_returns_seeded_units(client):
    call_command('seed_sample_data')
    response = client.get('/api/v1/units/')
    assert response.status_code == 200
    assert response.data['count'] == 5


@pytest.mark.django_db
def test_unit_detail(client, available_unit):
    response = client.get(f'/api/v1/units/{available_unit.id}/')
    assert response.status_code == 200
    assert response.data['external_unit_id'] == available_unit.external_unit_id


@pytest.mark.django_db
def test_unit_overview(client, available_unit):
    response = client.get(f'/api/v1/units/{available_unit.id}/overview/')
    assert response.status_code == 200
    data = response.data
    assert 'unit' in data
    assert 'active_lease' in data
    assert 'work_orders' in data
    assert 'recent_inspections' in data


@pytest.mark.django_db
def test_unit_create(client, building):
    response = client.post('/api/v1/units/', {
        'external_unit_id': 'NEWUNIT-001',
        'building': building.id,
        'label': 'New Apartment',
        'unit_type': '3BR',
        'area_sqm': '150.00',
        'parking_bay': 'N-01',
        'occupancy_status': 'available',
    })
    assert response.status_code == 201
    assert response.data['external_unit_id'] == 'NEWUNIT-001'


@pytest.mark.django_db
def test_unit_archive(client, available_unit):
    response = client.post(f'/api/v1/units/{available_unit.id}/archive/')
    assert response.status_code == 200
    assert response.data['is_archived'] is True


@pytest.mark.django_db
def test_unit_delete_blocked_when_active_lease(client, available_unit):
    from apps.leases.models import Lease
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
        f.write(b'%PDF-1.4 fake')
        tmp_path = f.name
    try:
        from django.core.files import File
        with open(tmp_path, 'rb') as f:
            lease = Lease.objects.create(unit=available_unit, document=File(f, name='test.pdf'), approval_status='approved')
        response = client.delete(f'/api/v1/units/{available_unit.id}/')
        assert response.status_code == 409
    finally:
        os.unlink(tmp_path)
