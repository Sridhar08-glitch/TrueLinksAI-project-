"""Outbound email helpers. Plain-text bodies; links point at the frontend SPA."""
import logging
from urllib.parse import quote

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def send_invitation_email(invitation) -> None:
    """Send a tenant invitation email with the accept link."""
    link = f'{settings.FRONTEND_URL}/invite/accept?token={quote(invitation.token)}'
    unit_label = invitation.unit.label if invitation.unit_id else 'your unit'
    name = invitation.first_name or 'there'
    body = (
        f'Hi {name},\n\n'
        f'You have been invited to join TrueLinks as the tenant of {unit_label}.\n\n'
        f'Accept your invitation and create your account here:\n{link}\n\n'
        f'This invitation expires on {invitation.expires_at:%Y-%m-%d %H:%M} UTC.\n\n'
        'If you were not expecting this email, you can safely ignore it.\n'
    )
    send_mail(
        subject='You have been invited to TrueLinks',
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[invitation.email],
        fail_silently=False,
    )


def send_password_reset_email(user, uid: str, token: str) -> None:
    """Send a password reset email with the frontend reset link."""
    link = f'{settings.FRONTEND_URL}/reset-password?uid={quote(uid)}&token={quote(token)}'
    name = user.first_name or user.username
    body = (
        f'Hi {name},\n\n'
        'We received a request to reset the password for your TrueLinks account.\n\n'
        f'Reset your password here:\n{link}\n\n'
        'This link is valid for a limited time. If you did not request a password '
        'reset, you can safely ignore this email.\n'
    )
    send_mail(
        subject='Reset your TrueLinks password',
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )
