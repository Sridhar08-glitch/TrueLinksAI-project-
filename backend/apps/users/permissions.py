from rest_framework.permissions import BasePermission, SAFE_METHODS
from .models import UserRole


def _get_role(user):
    try:
        return user.profile.role
    except Exception:
        return None


class OwnerHasFullAccess(BasePermission):
    """Owner role and Django superusers have unrestricted access — act as super-admin."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return request.user.is_superuser or _get_role(request.user) == UserRole.OWNER

    def has_object_permission(self, request, view, obj):
        return request.user.is_superuser or _get_role(request.user) == UserRole.OWNER


class IsOwner(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return request.user.is_superuser or _get_role(request.user) == UserRole.OWNER


class IsPropertyManager(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and _get_role(request.user) == UserRole.PROPERTY_MANAGER


class IsTenant(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and _get_role(request.user) == UserRole.TENANT


class IsMaintenanceStaff(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and _get_role(request.user) == UserRole.MAINTENANCE_STAFF


class IsOwnerOrManager(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        role = _get_role(request.user)
        return role in (UserRole.OWNER, UserRole.PROPERTY_MANAGER)


class IsOwnerManagerOrReadOnly(BasePermission):
    """Owner/manager for writes; any authenticated user for reads."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        role = _get_role(request.user)
        return request.user.is_superuser or role in (UserRole.OWNER, UserRole.PROPERTY_MANAGER)


class IsOwnerManagerOrTenant(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        role = _get_role(request.user)
        return role in (UserRole.OWNER, UserRole.PROPERTY_MANAGER, UserRole.TENANT)


STAFF_ROLES = (UserRole.OWNER, UserRole.PROPERTY_MANAGER, UserRole.MAINTENANCE_STAFF)


class IsOwnerManagerOrMaintenance(BasePermission):
    """Owner, property manager, or maintenance staff (no tenants)."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        return _get_role(request.user) in STAFF_ROLES


class ReadStaffWriteOwnerManager(BasePermission):
    """Reads for owner/PM/maintenance; writes for owner/PM only. Tenants: denied."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        role = _get_role(request.user)
        if request.method in SAFE_METHODS:
            return role in STAFF_ROLES
        return role in (UserRole.OWNER, UserRole.PROPERTY_MANAGER)
