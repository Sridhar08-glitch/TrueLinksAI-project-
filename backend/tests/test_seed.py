import pytest
from django.core.management import call_command
from apps.properties.models import OwnershipEntity, Property, Building
from apps.units.models import Unit


@pytest.mark.django_db
def test_seed_creates_ownership_entity():
    call_command('seed_sample_data')
    assert OwnershipEntity.objects.filter(name='Marina Crest Holdings W.L.L.').exists()


@pytest.mark.django_db
def test_seed_creates_property():
    call_command('seed_sample_data')
    assert Property.objects.filter(external_property_id='PROP-MC').exists()


@pytest.mark.django_db
def test_seed_creates_buildings():
    call_command('seed_sample_data')
    assert Building.objects.filter(external_building_id='MC-A').exists()
    assert Building.objects.filter(external_building_id='MC-B').exists()


@pytest.mark.django_db
def test_seed_creates_all_five_units():
    call_command('seed_sample_data')
    unit_ids = list(Unit.objects.values_list('external_unit_id', flat=True))
    for expected in ['MC-B-1204', 'MC-B-1205', 'MC-B-0902', 'MC-A-0301', 'MC-A-0302']:
        assert expected in unit_ids, f'{expected} not seeded'


@pytest.mark.django_db
def test_seed_is_idempotent():
    call_command('seed_sample_data')
    call_command('seed_sample_data')
    assert OwnershipEntity.objects.filter(name='Marina Crest Holdings W.L.L.').count() == 1
    assert Property.objects.filter(external_property_id='PROP-MC').count() == 1
    assert Unit.objects.count() == 5


@pytest.mark.django_db
def test_seed_occupancy_statuses():
    call_command('seed_sample_data')
    occupied = Unit.objects.filter(occupancy_status='occupied').values_list('external_unit_id', flat=True)
    assert 'MC-B-1205' in occupied
    assert 'MC-A-0302' in occupied
    available = Unit.objects.filter(occupancy_status='available').values_list('external_unit_id', flat=True)
    assert 'MC-B-1204' in available
    assert 'MC-B-0902' in available
    assert 'MC-A-0301' in available
