import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from apps.properties.models import OwnershipEntity, Property, Building
from apps.units.models import Unit, OccupancyStatus
from apps.users.models import UserProfile, UserRole


@pytest.fixture
def owner_user(db):
    user = User.objects.create_user(
        username='test_owner', email='owner@test.com', password='testpass123'
    )
    UserProfile.objects.create(user=user, role=UserRole.OWNER)
    return user


@pytest.fixture
def tenant_user(db):
    user = User.objects.create_user(
        username='test_tenant', email='tenant@test.com', password='testpass123'
    )
    UserProfile.objects.create(user=user, role=UserRole.TENANT)
    return user


@pytest.fixture
def auth_client(owner_user):
    client = APIClient()
    client.force_authenticate(user=owner_user)
    return client


@pytest.fixture
def tenant_client(tenant_user):
    client = APIClient()
    client.force_authenticate(user=tenant_user)
    return client


@pytest.fixture
def ownership(db):
    return OwnershipEntity.objects.create(name='Test Holdings W.L.L.')


@pytest.fixture
def prop(ownership):
    return Property.objects.create(
        external_property_id='PROP-TEST',
        ownership_entity=ownership,
        name='Test Residences',
        location='Test City',
    )


@pytest.fixture
def building(prop):
    return Building.objects.create(
        external_building_id='TEST-A',
        property=prop,
        name='Tower A',
    )


@pytest.fixture
def available_unit(building):
    return Unit.objects.create(
        external_unit_id='TEST-A-0101',
        building=building,
        label='Apartment 101',
        unit_type='2BR',
        area_sqm=100,
        parking_bay='A-01',
        occupancy_status=OccupancyStatus.AVAILABLE,
    )


@pytest.fixture
def occupied_unit(building):
    return Unit.objects.create(
        external_unit_id='TEST-A-0102',
        building=building,
        label='Apartment 102',
        unit_type='1BR',
        area_sqm=75,
        parking_bay='A-02',
        occupancy_status=OccupancyStatus.OCCUPIED,
    )
