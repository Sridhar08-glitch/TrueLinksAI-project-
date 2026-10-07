from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.users.models import UserProfile, TenantAssignment, UserRole

DEMO_ACCOUNTS = [
    ('owner@truelinks.com', 'Owner@12345', UserRole.OWNER, 'Olivia', 'Owner'),
    ('manager@truelinks.com', 'Manager@12345', UserRole.PROPERTY_MANAGER, 'Mark', 'Manager'),
    ('tech@truelinks.com', 'Tech@12345', UserRole.MAINTENANCE_STAFF, 'Tina', 'Technician'),
    ('tenant@truelinks.com', 'Tenant@12345', UserRole.TENANT, 'Tom', 'Tenant'),
]


class Command(BaseCommand):
    help = 'Idempotently create demo accounts for every role. Safe to run multiple times.'

    @transaction.atomic
    def handle(self, *args, **options):
        tenant_user = None

        for email, password, role, first_name, last_name in DEMO_ACCOUNTS:
            user = User.objects.filter(email__iexact=email).order_by('id').first()
            if user is None:
                username = email.split('@')[0]
                base = username
                counter = 1
                while User.objects.filter(username=username).exists():
                    username = f'{base}{counter}'
                    counter += 1
                user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                )
                self.stdout.write(f'  Created demo user: {email} ({role})')
            else:
                self.stdout.write(f'  Demo user exists: {email}')

            profile, _ = UserProfile.objects.get_or_create(user=user, defaults={'role': role})
            if profile.role != role:
                profile.role = role
                profile.save(update_fields=['role'])

            if role == UserRole.TENANT:
                tenant_user = user

        if tenant_user is not None:
            self._ensure_tenant_assignment(tenant_user)

        self.stdout.write(self.style.SUCCESS('Demo accounts ready. Credentials:'))
        for email, password, role, _, _ in DEMO_ACCOUNTS:
            self.stdout.write(f'  {role:<20} {email} / {password}')

    def _ensure_tenant_assignment(self, tenant_user):
        from apps.units.models import Unit, OccupancyStatus
        from apps.units.services import occupancy

        if TenantAssignment.objects.filter(tenant=tenant_user, is_active=True).exists():
            self.stdout.write('  Demo tenant already has an active unit assignment.')
            return

        # Prefer a unit already seeded as occupied (keeps seed data statuses intact);
        # otherwise fall back to the first seeded unit.
        unit = (
            Unit.objects.filter(is_archived=False, occupancy_status=OccupancyStatus.OCCUPIED)
            .order_by('id')
            .first()
        ) or Unit.objects.filter(is_archived=False).order_by('id').first()

        if unit is None:
            self.stdout.write(self.style.WARNING(
                '  No units found — run seed_sample_data first to assign the demo tenant.'
            ))
            return

        TenantAssignment.objects.create(
            unit=unit,
            tenant=tenant_user,
            is_active=True,
        )
        occupancy.mark_occupied(unit)
        self.stdout.write(f'  Assigned demo tenant to unit {unit.external_unit_id} (occupied).')
