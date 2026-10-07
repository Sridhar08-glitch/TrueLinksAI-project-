from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import UserProfile, TenantInvitation, TenantAssignment, UserRole


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = 'email'

    def validate(self, attrs):
        email = attrs.get('email', '').strip().lower()
        password = attrs.get('password', '')

        user = User.objects.filter(email__iexact=email).order_by('id').first()
        if user is None:
            # Same generic message as a wrong password — prevents user enumeration.
            raise serializers.ValidationError({'detail': 'Invalid email or password.'})

        if not user.check_password(password):
            raise serializers.ValidationError({'detail': 'Invalid email or password.'})

        if not user.is_active:
            raise serializers.ValidationError({'detail': 'This account is disabled.'})

        refresh = self.get_token(user)
        return {
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'user': UserSerializer(user).data,
        }


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['role', 'phone', 'is_active']


class UserSerializer(serializers.ModelSerializer):
    profile = UserProfileSerializer(read_only=True)
    role = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()

    def get_role(self, obj):
        try:
            return obj.profile.role
        except Exception:
            # Superusers without a profile act as owners, not tenants.
            return UserRole.OWNER if obj.is_superuser else UserRole.TENANT

    def get_phone(self, obj):
        try:
            return obj.profile.phone
        except Exception:
            return ''

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'is_active',
                  'date_joined', 'role', 'phone', 'profile']
        read_only_fields = ['id', 'date_joined']


class RegisterSerializer(serializers.Serializer):
    """Self-registration always creates a tenant account. Any submitted role is ignored."""
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    first_name = serializers.CharField(max_length=100, required=False, default='')
    last_name = serializers.CharField(max_length=100, required=False, default='')

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('Username already taken.')
        return value

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Email already registered.')
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
        )
        UserProfile.objects.create(user=user, role=UserRole.TENANT)
        return user


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class ProfileUpdateSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(source='user.first_name', required=False)
    last_name = serializers.CharField(source='user.last_name', required=False)
    email = serializers.EmailField(source='user.email', required=False)

    class Meta:
        model = UserProfile
        fields = ['first_name', 'last_name', 'email', 'phone']

    def validate_email(self, value):
        qs = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.user_id)
        if qs.exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def update(self, instance, validated_data):
        user_data = validated_data.pop('user', {})
        for attr, val in user_data.items():
            setattr(instance.user, attr, val)
        instance.user.save()
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        return instance


class TenantInvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantInvitation
        fields = [
            'id', 'unit', 'email', 'first_name', 'last_name',
            'status', 'move_in_date', 'expires_at', 'accepted_at', 'created_at',
        ]
        read_only_fields = ['id', 'status', 'expires_at', 'accepted_at', 'created_at']


class AcceptInvitationSerializer(serializers.Serializer):
    token = serializers.CharField()
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_password(self, value):
        validate_password(value)
        return value


class TenantAssignmentSerializer(serializers.ModelSerializer):
    tenant_email = serializers.EmailField(source='tenant.email', read_only=True)
    tenant_name = serializers.SerializerMethodField()
    unit_label = serializers.CharField(source='unit.label', read_only=True)

    class Meta:
        model = TenantAssignment
        fields = [
            'id', 'unit', 'unit_label', 'tenant', 'tenant_email', 'tenant_name',
            'move_in_date', 'move_out_date', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'tenant_email', 'tenant_name', 'unit_label']

    def get_tenant_name(self, obj):
        return obj.tenant.get_full_name() or obj.tenant.username
