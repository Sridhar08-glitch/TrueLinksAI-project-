"""Password reset flow: request + confirm, no user enumeration."""
import re

import pytest
from django.contrib.auth.models import User
from django.core import mail
from rest_framework.test import APIClient

from apps.users.models import UserProfile, UserRole


@pytest.fixture(autouse=True)
def _email_and_throttle(settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    from django.core.cache import cache
    cache.clear()


@pytest.fixture
def reset_user(db):
    user = User.objects.create_user(
        username='resetme', email='resetme@test.com', password='OldPassw0rd!'
    )
    UserProfile.objects.create(user=user, role=UserRole.TENANT)
    return user


@pytest.mark.django_db
class TestPasswordReset:
    def test_request_sends_email_with_link(self, reset_user):
        client = APIClient()
        resp = client.post('/api/v1/users/password-reset/', {'email': 'resetme@test.com'}, format='json')
        assert resp.status_code == 200
        assert len(mail.outbox) == 1
        body = mail.outbox[0].body
        assert '/reset-password?uid=' in body

    def test_unknown_email_returns_same_200_and_no_mail(self):
        client = APIClient()
        resp = client.post('/api/v1/users/password-reset/', {'email': 'ghost@test.com'}, format='json')
        assert resp.status_code == 200
        assert len(mail.outbox) == 0

    def test_full_reset_flow(self, reset_user):
        client = APIClient()
        client.post('/api/v1/users/password-reset/', {'email': 'resetme@test.com'}, format='json')
        body = mail.outbox[0].body
        match = re.search(r'uid=([^&\s]+)&token=([^\s]+)', body)
        assert match, f'No reset link found in email body: {body}'
        uid, token = match.group(1), match.group(2)

        resp = client.post('/api/v1/users/password-reset/confirm/', {
            'uid': uid, 'token': token, 'new_password': 'BrandNewPassw0rd!',
        }, format='json')
        assert resp.status_code == 200

        reset_user.refresh_from_db()
        assert reset_user.check_password('BrandNewPassw0rd!')
        # Token is single-use
        resp = client.post('/api/v1/users/password-reset/confirm/', {
            'uid': uid, 'token': token, 'new_password': 'AnotherPassw0rd!',
        }, format='json')
        assert resp.status_code == 400

    def test_confirm_rejects_bad_token(self, reset_user):
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        client = APIClient()
        uid = urlsafe_base64_encode(force_bytes(reset_user.pk))
        resp = client.post('/api/v1/users/password-reset/confirm/', {
            'uid': uid, 'token': 'totally-bogus-token', 'new_password': 'BrandNewPassw0rd!',
        }, format='json')
        assert resp.status_code == 400

    def test_confirm_rejects_weak_password(self, reset_user):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        client = APIClient()
        uid = urlsafe_base64_encode(force_bytes(reset_user.pk))
        token = default_token_generator.make_token(reset_user)
        resp = client.post('/api/v1/users/password-reset/confirm/', {
            'uid': uid, 'token': token, 'new_password': '123',
        }, format='json')
        assert resp.status_code == 400


@pytest.mark.django_db
class TestInvitationEmails:
    def test_invitation_create_sends_email_and_resend_works(self, auth_client, available_unit):
        resp = auth_client.post('/api/v1/users/invitations/', {
            'unit': available_unit.id,
            'email': 'newtenant@test.com',
            'first_name': 'New',
            'last_name': 'Tenant',
        }, format='json')
        assert resp.status_code == 201
        assert len(mail.outbox) == 1
        assert '/invite/accept?token=' in mail.outbox[0].body

        invitation_id = resp.data['id']
        resp = auth_client.post(f'/api/v1/users/invitations/{invitation_id}/resend/')
        assert resp.status_code == 200
        assert len(mail.outbox) == 2
