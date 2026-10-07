"""
Dynamic property management tests.
Verifies that all dashboard totals and listings are calculated from live DB,
not hardcoded. Tests adding/removing units, buildings, and properties.
"""
import pytest
from apps.properties.models import OwnershipEntity, Property, Building
from apps.units.models import Unit, OccupancyStatus
from django.core.management import call_command

pytestmark = pytest.mark.django_db


@pytest.fixture
def client(auth_client):
    return auth_client


@pytest.fixture
def seeded_db():
    call_command('seed_sample_data')


# ─── Dashboard reflects live DB ───────────────────────────────────────────────

class TestDashboardDynamic:
    def test_dashboard_updates_when_unit_added(self, client, building):
        r1 = client.get('/api/v1/dashboard/stats/')
        initial_total = r1.data['total_units']

        Unit.objects.create(
            external_unit_id='DYNAMIC-001',
            building=building,
            label='Dynamic Apartment',
            unit_type='1BR',
            area_sqm=60,
            occupancy_status=OccupancyStatus.AVAILABLE,
        )

        r2 = client.get('/api/v1/dashboard/stats/')
        assert r2.data['total_units'] == initial_total + 1

    def test_dashboard_available_count_updates_on_occupancy_change(self, client, available_unit):
        r1 = client.get('/api/v1/dashboard/stats/')
        initial_available = r1.data['available_units']
        initial_occupied = r1.data['occupied_units']

        available_unit.occupancy_status = OccupancyStatus.OCCUPIED
        available_unit.save()

        r2 = client.get('/api/v1/dashboard/stats/')
        assert r2.data['available_units'] == initial_available - 1
        assert r2.data['occupied_units'] == initial_occupied + 1

    def test_dashboard_excludes_archived_units(self, client, available_unit):
        r1 = client.get('/api/v1/dashboard/stats/')
        initial_total = r1.data['total_units']

        available_unit.is_archived = True
        available_unit.occupancy_status = OccupancyStatus.ARCHIVED
        available_unit.save()

        r2 = client.get('/api/v1/dashboard/stats/')
        assert r2.data['total_units'] == initial_total - 1

    def test_dashboard_starts_at_zero_on_empty_db(self, client):
        r = client.get('/api/v1/dashboard/stats/')
        assert r.data['total_units'] == 0
        assert r.data['available_units'] == 0
        assert r.data['occupied_units'] == 0

    def test_dashboard_counts_100_units_correctly(self, client, building):
        for i in range(100):
            status = OccupancyStatus.OCCUPIED if i % 3 == 0 else OccupancyStatus.AVAILABLE
            Unit.objects.create(
                external_unit_id=f'BULK-{i:04d}',
                building=building,
                label=f'Bulk Unit {i}',
                unit_type='1BR',
                area_sqm=50,
                occupancy_status=status,
            )

        r = client.get('/api/v1/dashboard/stats/')
        assert r.data['total_units'] == 100
        occupied = sum(1 for i in range(100) if i % 3 == 0)
        available = 100 - occupied
        assert r.data['occupied_units'] == occupied
        assert r.data['available_units'] == available

    def test_pending_work_orders_count_updates(self, client, available_unit):
        from apps.inspections.models import Inspection, InspectionFinding, FindingCategory
        from apps.work_orders.services.work_order_generator import WorkOrderGenerator

        insp = Inspection.objects.create(unit=available_unit, reporter_type='tenant')
        InspectionFinding.objects.create(
            inspection=insp, category=FindingCategory.DAMAGE,
            confidence=0.85, equipment_name='Wall', condition='poor',
        )

        r1 = client.get('/api/v1/dashboard/stats/')
        initial = r1.data['pending_work_orders']

        WorkOrderGenerator().generate_from_inspection(insp.id)

        r2 = client.get('/api/v1/dashboard/stats/')
        assert r2.data['pending_work_orders'] == initial + 1

    def test_pending_lease_reviews_count_updates(self, client, available_unit):
        import tempfile, os
        from apps.leases.models import Lease, LeaseField
        from django.core.files import File

        r1 = client.get('/api/v1/dashboard/stats/')
        initial = r1.data['pending_lease_reviews']

        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(b'%PDF-1.4')
            tmp = f.name
        try:
            with open(tmp, 'rb') as f:
                # Fields only count as reviewable once extraction has completed
                lease = Lease.objects.create(
                    unit=available_unit,
                    document=File(f, name='test.pdf'),
                    processing_status='completed',
                )
            LeaseField.objects.create(
                lease=lease, field_name='tenant_name',
                extracted_value='Test Tenant', review_status='pending',
            )
            r2 = client.get('/api/v1/dashboard/stats/')
            assert r2.data['pending_lease_reviews'] == initial + 1
        finally:
            os.unlink(tmp)


# ─── CRUD: Create property / building / unit ──────────────────────────────────

class TestPropertyCRUD:
    def test_create_ownership_entity(self, client):
        r = client.post('/api/v1/ownership-entities/', {'name': 'New Holdings LLC'}, format='json')
        assert r.status_code == 201
        assert r.data['name'] == 'New Holdings LLC'

    def test_create_property(self, client, ownership):
        r = client.post('/api/v1/properties/', {
            'external_property_id': 'PROP-NEW',
            'name': 'New Tower',
            'location': 'West Bay, Doha',
            'ownership_entity': ownership.id,
        }, format='json')
        assert r.status_code == 201
        assert r.data['external_property_id'] == 'PROP-NEW'

    def test_update_property_name(self, client, prop):
        r = client.patch(f'/api/v1/properties/{prop.id}/', {'name': 'Updated Tower'}, format='json')
        assert r.status_code == 200
        assert r.data['name'] == 'Updated Tower'

    def test_create_building(self, client, prop):
        r = client.post('/api/v1/buildings/', {
            'external_building_id': 'NEW-BLDG-C',
            'property': prop.id,
            'name': 'Tower C',
        }, format='json')
        assert r.status_code == 201
        assert r.data['external_building_id'] == 'NEW-BLDG-C'

    def test_external_id_unique_constraint(self, client, prop, building):
        r = client.post('/api/v1/buildings/', {
            'external_building_id': building.external_building_id,
            'property': prop.id,
            'name': 'Duplicate',
        }, format='json')
        assert r.status_code == 400

    def test_delete_empty_property(self, client, ownership):
        prop = Property.objects.create(
            external_property_id='PROP-DELETE',
            ownership_entity=ownership,
            name='Deletable Property',
            location='Test',
        )
        r = client.delete(f'/api/v1/properties/{prop.id}/')
        assert r.status_code == 204


class TestUnitCRUD:
    def test_create_unit_with_all_fields(self, client, building):
        r = client.post('/api/v1/units/', {
            'external_unit_id': 'FULL-UNIT-001',
            'building': building.id,
            'label': 'Apartment 501',
            'unit_type': '3BR',
            'bedrooms': 3,
            'bathrooms': 2,
            'area_sqm': '180.50',
            'parking_bay': 'C-15',
            'floor_number': 5,
            'occupancy_status': 'available',
        }, format='json')
        assert r.status_code == 201
        assert r.data['bedrooms'] == 3
        assert r.data['bathrooms'] == 2
        assert r.data['floor_number'] == 5

    def test_update_unit_occupancy(self, client, available_unit):
        r = client.patch(f'/api/v1/units/{available_unit.id}/', {
            'occupancy_status': 'maintenance'
        }, format='json')
        assert r.status_code == 200
        assert r.data['occupancy_status'] == 'maintenance'

    def test_delete_unit_without_dependencies(self, client, building):
        unit = Unit.objects.create(
            external_unit_id='DELETE-ME-001',
            building=building,
            label='Deletable',
            unit_type='1BR',
            area_sqm=50,
        )
        r = client.delete(f'/api/v1/units/{unit.id}/')
        assert r.status_code == 204
        assert not Unit.objects.filter(id=unit.id).exists()

    def test_delete_blocked_by_active_lease(self, client, available_unit):
        import tempfile, os
        from apps.leases.models import Lease
        from django.core.files import File

        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(b'%PDF-1.4')
            tmp = f.name
        try:
            with open(tmp, 'rb') as f:
                Lease.objects.create(
                    unit=available_unit,
                    document=File(f, name='block.pdf'),
                    approval_status='approved',
                )
            r = client.delete(f'/api/v1/units/{available_unit.id}/')
            assert r.status_code == 409
            assert 'active lease' in r.data['detail'].lower()
        finally:
            os.unlink(tmp)

    def test_delete_blocked_by_open_work_order(self, client, available_unit):
        from apps.work_orders.models import WorkOrder
        WorkOrder.objects.create(
            unit=available_unit, title='Open WO', description='desc', status='draft'
        )
        r = client.delete(f'/api/v1/units/{available_unit.id}/')
        assert r.status_code == 409
        assert 'work order' in r.data['detail'].lower()

    def test_archive_then_unarchive_unit(self, client, available_unit):
        r1 = client.post(f'/api/v1/units/{available_unit.id}/archive/', format='json')
        assert r1.status_code == 200
        assert r1.data['is_archived'] is True

        r2 = client.post(f'/api/v1/units/{available_unit.id}/unarchive/', format='json')
        assert r2.status_code == 200
        assert r2.data['is_archived'] is False
        assert r2.data['occupancy_status'] == 'available'

    def test_archived_unit_excluded_from_dashboard(self, client, available_unit):
        r1 = client.get('/api/v1/dashboard/stats/')
        initial = r1.data['total_units']

        client.post(f'/api/v1/units/{available_unit.id}/archive/', format='json')

        r2 = client.get('/api/v1/dashboard/stats/')
        assert r2.data['total_units'] == initial - 1

    def test_unit_list_filter_by_occupancy(self, client, available_unit, occupied_unit):
        r = client.get('/api/v1/units/?occupancy_status=available')
        assert r.status_code == 200
        ids = [u['id'] for u in r.data['results']]
        assert available_unit.id in ids
        assert occupied_unit.id not in ids

    def test_unit_list_filter_by_building(self, client, available_unit, occupied_unit):
        r = client.get(f'/api/v1/units/?building={available_unit.building.id}')
        assert r.status_code == 200
        for u in r.data['results']:
            assert u['building'] == available_unit.building.id

    def test_external_id_unique_constraint_on_unit(self, client, available_unit, building):
        r = client.post('/api/v1/units/', {
            'external_unit_id': available_unit.external_unit_id,
            'building': building.id,
            'label': 'Duplicate',
            'unit_type': '1BR',
            'area_sqm': '50.00',
        }, format='json')
        assert r.status_code == 400


# ─── Unit list works at zero, five, and large scale ──────────────────────────

class TestScaleInvariance:
    def test_unit_list_empty_db_returns_zero(self, client):
        r = client.get('/api/v1/units/')
        assert r.status_code == 200
        assert r.data['count'] == 0
        assert r.data['results'] == []

    def test_unit_list_after_seed_returns_five(self, client, seeded_db):
        r = client.get('/api/v1/units/')
        assert r.data['count'] == 5

    def test_unit_list_with_sixth_unit(self, client, seeded_db, building):
        Unit.objects.create(
            external_unit_id='MC-B-2001',
            building=Building.objects.first(),
            label='Apartment 2001',
            unit_type='Studio',
            area_sqm=45,
        )
        r = client.get('/api/v1/units/')
        assert r.data['count'] == 6

    def test_pagination_works_at_scale(self, client, building):
        for i in range(25):
            Unit.objects.create(
                external_unit_id=f'PAGE-UNIT-{i:04d}',
                building=building,
                label=f'Unit {i}',
                unit_type='1BR',
                area_sqm=50,
            )
        r = client.get('/api/v1/units/')
        assert r.data['count'] == 25
        assert len(r.data['results']) == 20  # page_size=20
        assert r.data['next'] is not None

    def test_second_page_returns_remaining(self, client, building):
        for i in range(25):
            Unit.objects.create(
                external_unit_id=f'PAGE2-UNIT-{i:04d}',
                building=building,
                label=f'Unit {i}',
                unit_type='1BR',
                area_sqm=50,
            )
        # Limit/offset pagination: second page is offset=20
        r = client.get('/api/v1/units/?limit=20&offset=20')
        assert len(r.data['results']) == 5
