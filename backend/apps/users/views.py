import logging
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework_simplejwt.tokens import RefreshToken

from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.audit.services.audit_service import AuditService
from .models import UserProfile, TenantInvitation, TenantAssignment, UserRole
from .permissions import IsOwnerOrManager, IsOwner
from .serializers import (
    RegisterSerializer, UserSerializer, ChangePasswordSerializer,
    ProfileUpdateSerializer, TenantInvitationSerializer,
    AcceptInvitationSerializer, TenantAssignmentSerializer,
    EmailTokenObtainPairSerializer,
)

logger = logging.getLogger(__name__)

STAFF_ROLES = [UserRole.PROPERTY_MANAGER, UserRole.MAINTENANCE_STAFF]


def _parse_bool(value):
    """Parse booleans arriving as real bools or as 'true'/'false' strings."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in ('true', '1', 'yes', 'on')
    return bool(value)


def _password_errors(password, user=None):
    """Enforce the platform password policy (min 8 chars + Django validators)."""
    if not password or len(password) < 8:
        return ['Password must be at least 8 characters.']
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        return list(exc.messages)
    return None


class EmailTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer
    throttle_scope = 'auth'


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_scope = 'auth'


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        AuditService.log('user', user.id, 'registered', user.username)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        }, status=status.HTTP_201_CREATED)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = ProfileUpdateSerializer(profile, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(serializer.validated_data['old_password']):
            return Response({'detail': 'Old password is incorrect.'}, status=status.HTTP_400_BAD_REQUEST)
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save()
        AuditService.log('user', request.user.id, 'password_changed', request.user.username)
        return Response({'detail': 'Password changed successfully.'})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data.get('refresh')
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
        except Exception:
            logger.exception('Failed to blacklist refresh token on logout for user %s', request.user.pk)
        return Response({'detail': 'Logged out successfully.'})


class PasswordResetRequestView(APIView):
    """Start a password reset. Always answers 200 — no user enumeration."""
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        email = str(request.data.get('email', '')).strip().lower()
        generic = {'detail': 'If an account with that email exists, a password reset link has been sent.'}
        if not email:
            return Response(generic)

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user:
            from django.contrib.auth.tokens import default_token_generator
            from django.utils.encoding import force_bytes
            from django.utils.http import urlsafe_base64_encode

            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            try:
                from .services.email_service import send_password_reset_email
                send_password_reset_email(user, uid, token)
                AuditService.log('user', user.id, 'password_reset_requested', user.email or user.username)
            except Exception:
                logger.exception('Failed to send password reset email to user %s', user.pk)
        return Response(generic)


class PasswordResetConfirmView(APIView):
    """Complete a password reset with the uid + token from the email link."""
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        uid = request.data.get('uid', '')
        token = request.data.get('token', '')
        new_password = request.data.get('new_password', '')
        if not uid or not token:
            return Response({'detail': 'uid and token are required.'}, status=status.HTTP_400_BAD_REQUEST)

        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_decode

        try:
            user_pk = urlsafe_base64_decode(uid).decode()
            user = User.objects.get(pk=user_pk, is_active=True)
        except (ValueError, TypeError, OverflowError, User.DoesNotExist):
            return Response({'detail': 'Invalid or expired reset link.'}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, token):
            return Response({'detail': 'Invalid or expired reset link.'}, status=status.HTTP_400_BAD_REQUEST)

        password_errors = _password_errors(new_password, user=user)
        if password_errors:
            return Response({'new_password': password_errors}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=['password'])
        AuditService.log('user', user.id, 'password_reset_completed', user.email or user.username)
        return Response({'detail': 'Password has been reset successfully.'})


class TenantInvitationViewSet(GenericViewSet, ListModelMixin, RetrieveModelMixin):
    serializer_class = TenantInvitationSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def get_queryset(self):
        return TenantInvitation.objects.select_related('unit').order_by('-created_at')

    def create(self, request):
        serializer = TenantInvitationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        unit = serializer.validated_data['unit']
        email = serializer.validated_data['email']

        if TenantInvitation.objects.filter(
            unit=unit, email=email, status=TenantInvitation.Status.PENDING
        ).exists():
            return Response(
                {'detail': 'A pending invitation already exists for this email and unit.'},
                status=status.HTTP_409_CONFLICT,
            )

        invitation = TenantInvitation.objects.create(
            unit=unit,
            email=email,
            first_name=serializer.validated_data.get('first_name', ''),
            last_name=serializer.validated_data.get('last_name', ''),
            invited_by=request.user,
            token=secrets.token_urlsafe(64),
            expires_at=timezone.now() + timedelta(days=7),
            move_in_date=serializer.validated_data.get('move_in_date'),
        )
        AuditService.log('invitation', invitation.id, 'created', request.user.username)

        # Email delivery is best-effort — the invitation stays valid either way.
        try:
            from .services.email_service import send_invitation_email
            send_invitation_email(invitation)
        except Exception:
            logger.exception('Failed to send invitation email for invitation %s', invitation.id)

        return Response(TenantInvitationSerializer(invitation).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def resend(self, request, pk=None):
        invitation = self.get_object()
        if invitation.status != TenantInvitation.Status.PENDING:
            return Response(
                {'detail': 'Only pending invitations can be resent.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if timezone.now() > invitation.expires_at:
            # Give the recipient a fresh window instead of resending a dead link.
            invitation.expires_at = timezone.now() + timedelta(days=7)
            invitation.save(update_fields=['expires_at'])
        try:
            from .services.email_service import send_invitation_email
            send_invitation_email(invitation)
        except Exception:
            logger.exception('Failed to resend invitation email for invitation %s', invitation.id)
            return Response(
                {'detail': 'Failed to send the invitation email. Please try again.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        AuditService.log('invitation', invitation.id, 'resent', request.user.username)
        return Response(TenantInvitationSerializer(invitation).data)

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        invitation = self.get_object()
        if invitation.status != TenantInvitation.Status.PENDING:
            return Response({'detail': 'Only pending invitations can be revoked.'}, status=status.HTTP_400_BAD_REQUEST)
        invitation.status = TenantInvitation.Status.REVOKED
        invitation.save()
        AuditService.log('invitation', invitation.id, 'revoked', request.user.username)
        return Response(TenantInvitationSerializer(invitation).data)


class AcceptInvitationView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = AcceptInvitationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        token = serializer.validated_data['token']
        try:
            invitation = TenantInvitation.objects.select_related('unit').get(token=token)
        except TenantInvitation.DoesNotExist:
            return Response({'detail': 'Invalid invitation token.'}, status=status.HTTP_404_NOT_FOUND)

        if invitation.status != TenantInvitation.Status.PENDING:
            return Response({'detail': f'Invitation is {invitation.status}.'}, status=status.HTTP_400_BAD_REQUEST)

        if timezone.now() > invitation.expires_at:
            invitation.status = TenantInvitation.Status.EXPIRED
            invitation.save()
            return Response({'detail': 'Invitation has expired.'}, status=status.HTTP_400_BAD_REQUEST)

        username = serializer.validated_data['username']
        if User.objects.filter(username=username).exists():
            return Response({'detail': 'Username already taken.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.units.services import occupancy

        with transaction.atomic():
            user = User.objects.create_user(
                username=username,
                email=invitation.email,
                password=serializer.validated_data['password'],
                first_name=invitation.first_name,
                last_name=invitation.last_name,
            )
            UserProfile.objects.create(user=user, role='tenant')
            TenantAssignment.objects.create(
                unit=invitation.unit,
                tenant=user,
                move_in_date=invitation.move_in_date,
                assigned_by=invitation.invited_by,
            )
            occupancy.mark_occupied(invitation.unit)
            invitation.status = TenantInvitation.Status.ACCEPTED
            invitation.accepted_at = timezone.now()
            invitation.accepted_by = user
            invitation.save()

        refresh = RefreshToken.for_user(user)
        AuditService.log('invitation', invitation.id, 'accepted', user.username)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        }, status=status.HTTP_201_CREATED)


class TenantAssignmentViewSet(GenericViewSet, ListModelMixin, RetrieveModelMixin):
    serializer_class = TenantAssignmentSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def get_queryset(self):
        return TenantAssignment.objects.select_related('unit', 'tenant').order_by('-created_at')

    def create(self, request):
        """Assign an existing tenant user to a unit."""
        from apps.units.models import Unit, OccupancyStatus
        from apps.units.services import occupancy

        tenant_id = request.data.get('tenant_id')
        unit_id = request.data.get('unit_id')
        move_in_date = request.data.get('move_in_date') or None

        if not tenant_id:
            return Response({'tenant_id': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not unit_id:
            return Response({'unit_id': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tenant = User.objects.get(pk=tenant_id, profile__role='tenant', is_active=True)
        except User.DoesNotExist:
            return Response({'tenant_id': 'Active tenant not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            unit = Unit.objects.get(pk=unit_id)
        except Unit.DoesNotExist:
            return Response({'unit_id': 'Unit not found.'}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            # Reject if the target unit is occupied by someone else.
            occupied_by_other = (
                TenantAssignment.objects
                .select_for_update()
                .filter(unit=unit, is_active=True)
                .exclude(tenant=tenant)
                .exists()
            )
            self_assigned = TenantAssignment.objects.filter(
                unit=unit, tenant=tenant, is_active=True
            ).exists()
            if occupied_by_other or (
                unit.occupancy_status == OccupancyStatus.OCCUPIED and not self_assigned
            ):
                return Response(
                    {'unit_id': 'Unit is already occupied by another tenant.'},
                    status=status.HTTP_409_CONFLICT,
                )

            # End any existing active assignment for this tenant and free that unit.
            previous = TenantAssignment.objects.filter(
                tenant=tenant, is_active=True
            ).select_related('unit')
            for prev in previous:
                if prev.unit_id != unit.id:
                    occupancy.mark_available(prev.unit)
            previous.update(is_active=False, move_out_date=timezone.now().date())

            assignment = TenantAssignment.objects.create(
                tenant=tenant,
                unit=unit,
                move_in_date=move_in_date,
                assigned_by=request.user,
                is_active=True,
            )
            occupancy.mark_occupied(unit)

        AuditService.log('assignment', assignment.id, 'created', request.user.username,
                         new_value={'tenant': tenant.email, 'unit': unit.label})
        return Response(TenantAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        from apps.units.services import occupancy
        assignment = self.get_object()
        if not assignment.is_active:
            return Response({'detail': 'Assignment already ended.'}, status=status.HTTP_400_BAD_REQUEST)
        assignment.is_active = False
        assignment.move_out_date = request.data.get('move_out_date') or timezone.now().date()
        assignment.save()
        occupancy.mark_available(assignment.unit)
        AuditService.log('assignment', assignment.id, 'ended', request.user.username)
        return Response(TenantAssignmentSerializer(assignment).data)


class UserListView(APIView):
    permission_classes = [IsAuthenticated, IsOwner]

    def get(self, request):
        users = User.objects.select_related('profile').filter(is_active=True).order_by('date_joined')
        return Response(UserSerializer(users, many=True).data)


class TenantMyInfoView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = None  # set in get_parsers to support both JSON and multipart

    def get_parsers(self):
        from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
        return [MultiPartParser(), FormParser(), JSONParser()]

    def get(self, request):
        from django.db.models import Q

        user = request.user
        assignment = (
            TenantAssignment.objects
            .filter(tenant=user, is_active=True)
            .select_related('unit', 'unit__building')
            .first()
        )
        if not assignment:
            return Response({'assignment': None, 'work_orders': [], 'leases': [], 'payments': []})

        unit = assignment.unit
        # Scope everything to THIS tenancy — not just the unit — so a new tenant
        # never sees the previous tenant's history.
        try:
            from apps.work_orders.models import WorkOrder
            from apps.work_orders.serializers import WorkOrderSerializer
            wos = (
                WorkOrder.objects
                .select_related('unit')
                .filter(unit=unit, created_at__gte=assignment.created_at)
                .order_by('-created_at')[:20]
            )
            wo_data = WorkOrderSerializer(wos, many=True).data
        except Exception:
            logger.exception('Failed to load work orders for tenant %s', user.pk)
            wo_data = []

        lease_data = []
        lease_ids = []
        try:
            from apps.common.media import build_signed_media_url
            from apps.leases.models import Lease
            lease_scope = Q(end_date__isnull=True) | Q(created_at__gte=assignment.created_at)
            if assignment.move_in_date:
                lease_scope |= Q(end_date__gte=assignment.move_in_date)
            leases = (
                Lease.objects
                .filter(unit=unit, is_cancelled=False)
                .filter(lease_scope)
                .order_by('-created_at')[:5]
            )
            for lease in leases:
                lease_ids.append(lease.id)
                lease_data.append({
                    'id': lease.id,
                    'tenant_name': lease.tenant_name,
                    'start_date': str(lease.start_date) if lease.start_date else None,
                    'end_date': str(lease.end_date) if lease.end_date else None,
                    'rent_amount': float(lease.rent_amount) if lease.rent_amount else None,
                    'currency': lease.currency,
                    'document': build_signed_media_url(lease.document.url, request) if lease.document else None,
                    'processing_status': lease.processing_status,
                    'approval_status': lease.approval_status,
                    'created_at': lease.created_at.isoformat(),
                })
        except Exception:
            logger.exception('Failed to load leases for tenant %s', user.pk)

        payment_data = []
        try:
            from apps.payments.models import PaymentScheduleItem
            items = (
                PaymentScheduleItem.objects
                .filter(lease_id__in=lease_ids)
                .order_by('due_date')
            )
            for item in items:
                payment_data.append({
                    'id': item.id,
                    'lease': item.lease_id,
                    'due_date': str(item.due_date),
                    'amount': float(item.amount),
                    'currency': item.currency,
                    'status': item.effective_status,
                    'paid_at': item.paid_at.isoformat() if item.paid_at else None,
                })
        except Exception:
            logger.exception('Failed to load payments for tenant %s', user.pk)

        return Response({
            'assignment': {
                'id': assignment.id,
                'unit_id': unit.id,
                'unit_label': unit.label,
                'unit_type': unit.unit_type,
                'area_sqm': float(unit.area_sqm) if unit.area_sqm else None,
                'floor_number': unit.floor_number,
                'parking_bay': unit.parking_bay,
                'building_name': unit.building.name if unit.building else '',
                'move_in_date': str(assignment.move_in_date) if assignment.move_in_date else None,
            },
            'work_orders': wo_data,
            'leases': lease_data,
            'payments': payment_data,
        })

    def post(self, request):
        user = request.user
        assignment = TenantAssignment.objects.filter(tenant=user, is_active=True).select_related('unit').first()
        if not assignment:
            return Response({'detail': 'No active unit assignment found.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.work_orders.models import WorkOrder, WorkOrderStatus, WorkOrderPriority
        from apps.work_orders.serializers import WorkOrderSerializer

        title = request.data.get('title', '').strip()
        description = request.data.get('description', '').strip()
        priority = request.data.get('priority', 'medium')
        if priority not in WorkOrderPriority.values:
            priority = WorkOrderPriority.MEDIUM
        inspection_id = request.data.get('inspection_id')
        if not title:
            return Response({'title': ['Title is required.']}, status=status.HTTP_400_BAD_REQUEST)

        wo = WorkOrder.objects.create(
            unit=assignment.unit,
            title=title,
            description=description,
            priority=priority,
            status=WorkOrderStatus.PENDING_APPROVAL,
            generated_by=f'tenant:{user.email}',
        )
        AuditService.log('work_order', wo.id, 'tenant_submitted', user.username)

        # Link an already-analysed inspection (AI pre-fill flow)
        if inspection_id:
            try:
                from apps.inspections.models import Inspection
                inspection = Inspection.objects.get(id=int(inspection_id), unit=assignment.unit)
                wo.inspection = inspection
                wo.save(update_fields=['inspection'])
            except Exception:
                logger.exception(
                    'Failed to link inspection %s to work order %s', inspection_id, wo.id
                )
            return Response(WorkOrderSerializer(wo).data, status=status.HTTP_201_CREATED)

        # Handle optional images — create an inspection and link it to the work order
        images = request.FILES.getlist('images')
        if images:
            try:
                from apps.inspections.models import Inspection, InspectionImage, InspectionStatus
                from apps.inspections.services.image_validation_service import (
                    ImageValidationService, ImageValidationError,
                )
                inspection = Inspection.objects.create(
                    unit=assignment.unit,
                    reporter_type='tenant',
                    description=f'Images for: {title}',
                    status=InspectionStatus.PENDING,
                )
                validator = ImageValidationService()
                any_saved = False
                for img in images:
                    try:
                        validator.validate(img)
                        InspectionImage.objects.create(
                            inspection=inspection,
                            image=img,
                            original_filename=img.name,
                            content_type=img.content_type,
                        )
                        any_saved = True
                    except ImageValidationError as exc:
                        logger.warning('Skipped invalid tenant image %s: %s', img.name, exc)

                if any_saved:
                    wo.inspection = inspection
                    wo.save(update_fields=['inspection'])

                    # Run the AI analysis in the background — never block the request.
                    inspection.status = InspectionStatus.ANALYZING
                    inspection.save(update_fields=['status', 'updated_at'])

                    import threading

                    def run_analysis(inspection_pk: int):
                        from django.db import connection
                        try:
                            from apps.inspections.services.inspection_analysis_service import (
                                InspectionAnalysisService,
                            )
                            InspectionAnalysisService().analyze(inspection_pk)
                        except Exception:
                            logger.exception(
                                'Background analysis failed for inspection %s', inspection_pk
                            )
                        finally:
                            connection.close()

                    t = threading.Thread(target=run_analysis, args=(inspection.id,), daemon=True)
                    t.start()
                else:
                    inspection.delete()
            except Exception:
                logger.exception('Failed to attach images to work order %s', wo.id)

        return Response(WorkOrderSerializer(wo).data, status=status.HTTP_201_CREATED)


class StaffCreateView(APIView):
    """Owner-only: create property_manager or maintenance_staff accounts."""
    permission_classes = [IsAuthenticated, IsOwner]

    def post(self, request):
        data = request.data
        email = data.get('email', '').strip().lower()
        first_name = data.get('first_name', '').strip()
        last_name = data.get('last_name', '').strip()
        phone = data.get('phone', '').strip()
        role = data.get('role', '').strip()
        password = data.get('password', '')

        if role not in STAFF_ROLES:
            return Response(
                {'role': f'Must be one of: {", ".join(STAFF_ROLES)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not email:
            return Response({'email': ['Email is required.']}, status=status.HTTP_400_BAD_REQUEST)
        password_errors = _password_errors(password)
        if password_errors:
            return Response({'password': password_errors}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({'email': ['A user with this email already exists.']}, status=status.HTTP_400_BAD_REQUEST)

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
        UserProfile.objects.create(user=user, role=role, phone=phone)
        AuditService.log('user', user.id, f'{role}_created', request.user.username)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class StaffListView(APIView):
    """Owner and property managers can list staff."""
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def get(self, request):
        role_filter = request.query_params.get('role')
        qs = User.objects.select_related('profile').filter(
            is_active=True,
            profile__role__in=[role_filter] if role_filter else STAFF_ROLES,
        )
        return Response(UserSerializer(qs.order_by('date_joined'), many=True).data)


class StaffUpdateView(APIView):
    """Owner-only: update or deactivate a staff member."""
    permission_classes = [IsAuthenticated, IsOwner]

    def _get_staff_target(self, user_id):
        """Only users whose role is a staff role are reachable here."""
        try:
            target = User.objects.select_related('profile').get(pk=user_id)
        except User.DoesNotExist:
            return None
        try:
            role = target.profile.role
        except UserProfile.DoesNotExist:
            return None
        if role not in STAFF_ROLES:
            return None
        return target

    def patch(self, request, user_id):
        target = self._get_staff_target(user_id)
        if target is None:
            return Response({'detail': 'Staff member not found.'}, status=status.HTTP_404_NOT_FOUND)

        if target == request.user:
            return Response({'detail': 'Cannot modify your own account via this endpoint.'}, status=status.HTTP_400_BAD_REQUEST)

        data = request.data
        if 'role' in data:
            if data['role'] not in STAFF_ROLES:
                return Response({'role': 'Invalid role for staff member.'}, status=status.HTTP_400_BAD_REQUEST)
            target.profile.role = data['role']
        if 'phone' in data:
            target.profile.phone = data['phone']
        if 'first_name' in data:
            target.first_name = data['first_name']
        if 'last_name' in data:
            target.last_name = data['last_name']
        if 'is_active' in data:
            target.is_active = _parse_bool(data['is_active'])

        target.save()
        target.profile.save()
        AuditService.log('user', target.id, 'staff_updated', request.user.username)
        return Response(UserSerializer(target).data)

    def delete(self, request, user_id):
        target = self._get_staff_target(user_id)
        if target is None:
            return Response({'detail': 'Staff member not found.'}, status=status.HTTP_404_NOT_FOUND)
        if target == request.user:
            return Response({'detail': 'Cannot deactivate yourself.'}, status=status.HTTP_400_BAD_REQUEST)
        target.is_active = False
        target.save()
        AuditService.log('user', target.id, 'staff_deactivated', request.user.username)
        return Response({'detail': 'Staff member deactivated.'})


class TenantListView(APIView):
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def get(self, request):
        search = request.query_params.get('search', '').strip()
        status_filter = request.query_params.get('status', '').strip().lower()

        tenant_users = (
            User.objects
            .select_related('profile')
            .filter(profile__role=UserRole.TENANT)
            .order_by('first_name', 'last_name')
        )
        # Deactivated tenants are only included when explicitly requested.
        if status_filter == 'inactive':
            tenant_users = tenant_users.filter(is_active=False)
        else:
            tenant_users = tenant_users.filter(is_active=True)

        if search:
            from django.db.models import Q
            tenant_users = tenant_users.filter(
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(email__icontains=search)
            )

        # Build a map of active assignments keyed by tenant user id
        active_assignments = {
            a.tenant_id: a
            for a in TenantAssignment.objects
            .select_related('unit')
            .filter(is_active=True)
        }

        if status_filter == 'active':
            tenant_users = [u for u in tenant_users if u.id in active_assignments]
        elif status_filter == 'unassigned':
            tenant_users = [u for u in tenant_users if u.id not in active_assignments]

        data = []
        for u in tenant_users:
            profile = getattr(u, 'profile', None)
            assignment = active_assignments.get(u.id)
            if not u.is_active:
                tenant_status = 'inactive'
            else:
                tenant_status = 'active' if assignment else 'unassigned'
            data.append({
                'id': u.id,
                'user': u.id,
                'first_name': u.first_name,
                'last_name': u.last_name,
                'email': u.email,
                'phone': profile.phone if profile else '',
                'unit': assignment.unit_id if assignment else None,
                'unit_number': assignment.unit.label if assignment and assignment.unit else None,
                'move_in_date': assignment.move_in_date if assignment else None,
                'status': tenant_status,
                'created_at': u.date_joined.isoformat(),
            })
        return Response({'results': data, 'count': len(data)})


class CreateTenantView(APIView):
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def post(self, request):
        data = request.data
        email = data.get('email', '').strip().lower()
        first_name = data.get('first_name', '').strip()
        last_name = data.get('last_name', '').strip()
        phone = data.get('phone', '').strip()
        unit_id = data.get('unit')
        move_in_date = data.get('move_in_date') or None
        password = data.get('password', '')

        if not email:
            return Response({'email': ['Email is required.']}, status=status.HTTP_400_BAD_REQUEST)
        password_errors = _password_errors(password)
        if password_errors:
            return Response({'password': password_errors}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({'email': ['A user with this email already exists.']}, status=status.HTTP_400_BAD_REQUEST)

        unit = None
        if unit_id:
            from apps.units.models import Unit
            try:
                unit = Unit.objects.get(pk=unit_id)
            except Unit.DoesNotExist:
                return Response({'unit': ['Unit not found.']}, status=status.HTTP_400_BAD_REQUEST)

        username = email.split('@')[0]
        base = username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f'{base}{counter}'
            counter += 1

        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name,
                )
                UserProfile.objects.create(user=user, role='tenant', phone=phone)

                if unit is not None:
                    from apps.units.services import occupancy
                    TenantAssignment.objects.filter(tenant=user, is_active=True).update(is_active=False)
                    TenantAssignment.objects.create(
                        unit=unit,
                        tenant=user,
                        move_in_date=move_in_date,
                        assigned_by=request.user,
                        is_active=True,
                    )
                    occupancy.mark_occupied(unit)
        except Exception:
            logger.exception('Tenant creation failed for %s', email)
            return Response(
                {'detail': 'Failed to create tenant. The unit assignment could not be completed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        AuditService.log('tenant', user.id, 'created', request.user.username)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class TenantUpdateView(APIView):
    """Owner/manager: update or deactivate a tenant account."""
    permission_classes = [IsAuthenticated, IsOwnerOrManager]

    def _get_tenant_target(self, user_id):
        try:
            target = User.objects.select_related('profile').get(pk=user_id)
        except User.DoesNotExist:
            return None
        try:
            role = target.profile.role
        except UserProfile.DoesNotExist:
            return None
        if role != UserRole.TENANT:
            return None
        return target

    def patch(self, request, user_id):
        target = self._get_tenant_target(user_id)
        if target is None:
            return Response({'detail': 'Tenant not found.'}, status=status.HTTP_404_NOT_FOUND)

        data = request.data
        if 'email' in data:
            email = str(data['email']).strip().lower()
            if not email:
                return Response({'email': ['Email cannot be blank.']}, status=status.HTTP_400_BAD_REQUEST)
            if User.objects.filter(email__iexact=email).exclude(pk=target.pk).exists():
                return Response({'email': ['A user with this email already exists.']}, status=status.HTTP_400_BAD_REQUEST)
            target.email = email
        if 'first_name' in data:
            target.first_name = data['first_name']
        if 'last_name' in data:
            target.last_name = data['last_name']
        if 'phone' in data:
            target.profile.phone = data['phone']

        target.save()
        target.profile.save()
        AuditService.log('tenant', target.id, 'updated', request.user.username)
        return Response(UserSerializer(target).data)

    def delete(self, request, user_id):
        target = self._get_tenant_target(user_id)
        if target is None:
            return Response({'detail': 'Tenant not found.'}, status=status.HTTP_404_NOT_FOUND)
        target.is_active = False
        target.save()
        AuditService.log('tenant', target.id, 'deactivated', request.user.username)
        return Response({'detail': 'Tenant deactivated.'})
