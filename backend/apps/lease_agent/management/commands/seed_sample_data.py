import json
from pathlib import Path
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.conf import settings

from apps.properties.models import OwnershipEntity, Property, Building
from apps.units.models import Unit, OccupancyStatus


class Command(BaseCommand):
    help = 'Seed sample data from units.json. Safe to run multiple times.'

    def handle(self, *args, **options):
        data_path = Path(settings.SAMPLE_DATA_DIR) / 'units.json'
        if not data_path.exists():
            self.stderr.write(f'units.json not found at {data_path}')
            return

        with open(data_path) as f:
            data = json.load(f)

        ownership, created = OwnershipEntity.objects.get_or_create(
            name=data['ownership_entity']
        )
        if created:
            self.stdout.write(f'  Created ownership entity: {ownership.name}')
        else:
            self.stdout.write(f'  Ownership entity exists: {ownership.name}')

        for prop_data in data['properties']:
            prop, created = Property.objects.get_or_create(
                external_property_id=prop_data['property_id'],
                defaults={
                    'ownership_entity': ownership,
                    'name': prop_data['name'],
                    'location': prop_data['location'],
                },
            )
            if created:
                self.stdout.write(f'  Created property: {prop.name}')
            else:
                self.stdout.write(f'  Property exists: {prop.name}')

            for bldg_data in prop_data['buildings']:
                building, created = Building.objects.get_or_create(
                    external_building_id=bldg_data['building_id'],
                    defaults={'property': prop, 'name': bldg_data['name']},
                )
                if created:
                    self.stdout.write(f'    Created building: {building.name}')
                else:
                    self.stdout.write(f'    Building exists: {building.name}')

                for unit_data in bldg_data['units']:
                    status_map = {
                        'available': OccupancyStatus.AVAILABLE,
                        'occupied': OccupancyStatus.OCCUPIED,
                        'maintenance': OccupancyStatus.MAINTENANCE,
                    }
                    unit, created = Unit.objects.get_or_create(
                        external_unit_id=unit_data['unit_id'],
                        defaults={
                            'building': building,
                            'label': unit_data['label'],
                            'unit_type': unit_data['type'],
                            'area_sqm': unit_data['area_sqm'],
                            'parking_bay': unit_data['parking_bay'],
                            'occupancy_status': status_map.get(unit_data['status'], OccupancyStatus.AVAILABLE),
                        },
                    )
                    if created:
                        self.stdout.write(f'      Created unit: {unit.external_unit_id}')
                    else:
                        self.stdout.write(f'      Unit exists: {unit.external_unit_id}')

        # Demo accounts (idempotent) — prints the credentials at the end.
        call_command('ensure_demo_users', stdout=self.stdout, stderr=self.stderr)

        self.stdout.write(self.style.SUCCESS('Sample data seeding complete.'))
