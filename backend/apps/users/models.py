from django.db import models
from django.contrib.auth.models import User


class UserRole(models.TextChoices):
    OWNER = 'owner', 'Owner'
    PROPERTY_MANAGER = 'property_manager', 'Property Manager'
    TENANT = 'tenant', 'Tenant'
    MAINTENANCE_STAFF = 'maintenance_staff', 'Maintenance Staff'


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=30, choices=UserRole.choices, default=UserRole.TENANT)
    phone = models.CharField(max_length=30, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user.username} ({self.role})'


class TenantInvitation(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        EXPIRED = 'expired', 'Expired'
        REVOKED = 'revoked', 'Revoked'

    unit = models.ForeignKey('units.Unit', on_delete=models.CASCADE, related_name='invitations')
    invited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='sent_invitations')
    email = models.EmailField()
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    token = models.CharField(max_length=128, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    move_in_date = models.DateField(null=True, blank=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='accepted_invitations'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Invitation for {self.email} to {self.unit}'


class TenantAssignment(models.Model):
    unit = models.ForeignKey('units.Unit', on_delete=models.PROTECT, related_name='tenant_assignments')
    tenant = models.ForeignKey(User, on_delete=models.PROTECT, related_name='unit_assignments')
    move_in_date = models.DateField(null=True, blank=True)
    move_out_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    assigned_by = models.ForeignKey(
        User, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='made_assignments'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.tenant.username} @ {self.unit}'
