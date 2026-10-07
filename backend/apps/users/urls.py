from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    RegisterView, MeView, ChangePasswordView, LogoutView,
    TenantInvitationViewSet, AcceptInvitationView,
    TenantAssignmentViewSet, UserListView, EmailTokenObtainPairView,
    ThrottledTokenRefreshView,
    TenantListView, CreateTenantView, TenantUpdateView, TenantMyInfoView,
    StaffCreateView, StaffListView, StaffUpdateView,
    PasswordResetRequestView, PasswordResetConfirmView,
)

router = DefaultRouter()
router.register('invitations', TenantInvitationViewSet, basename='invitation')
router.register('assignments', TenantAssignmentViewSet, basename='assignment')

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', EmailTokenObtainPairView.as_view(), name='token_obtain'),
    path('token/refresh/', ThrottledTokenRefreshView.as_view(), name='token_refresh'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('me/', MeView.as_view(), name='me'),
    path('change-password/', ChangePasswordView.as_view(), name='change_password'),
    path('password-reset/', PasswordResetRequestView.as_view(), name='password_reset'),
    path('password-reset/confirm/', PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
    path('invite/accept/', AcceptInvitationView.as_view(), name='accept_invitation'),
    path('list/', UserListView.as_view(), name='user_list'),
    path('tenants/', TenantListView.as_view(), name='tenant_list'),
    path('tenants/create/', CreateTenantView.as_view(), name='tenant_create'),
    path('tenants/<int:user_id>/', TenantUpdateView.as_view(), name='tenant_update'),
    path('my-info/', TenantMyInfoView.as_view(), name='tenant_my_info'),
    path('staff/', StaffListView.as_view(), name='staff_list'),
    path('staff/create/', StaffCreateView.as_view(), name='staff_create'),
    path('staff/<int:user_id>/', StaffUpdateView.as_view(), name='staff_update'),
    path('', include(router.urls)),
]
