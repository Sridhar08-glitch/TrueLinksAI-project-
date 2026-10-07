"""
Protected media serving with signed, time-limited URLs.

Media files (lease PDFs, inspection photos) must not be world-readable, but the
frontend renders them with plain <img>/<a> tags that cannot send JWT headers.
Instead, every media URL the API emits carries a signed token query parameter
(django.core.signing.TimestampSigner, 1 hour validity). The /media/<path> view
only serves the file when the token is valid AND was signed for that exact path.
"""
import mimetypes
import os
import posixpath
from urllib.parse import quote

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import FileResponse, HttpResponseForbidden, HttpResponseNotFound

MEDIA_TOKEN_MAX_AGE = 3600  # seconds

_signer = TimestampSigner(salt='truelinks.protected-media')


def _media_relative_path(url_path: str) -> str:
    """Strip the MEDIA_URL prefix (if present) to get the storage-relative path."""
    media_url = settings.MEDIA_URL or '/media/'
    path = url_path
    if path.startswith(media_url):
        path = path[len(media_url):]
    return path.lstrip('/')


def sign_media_path(relative_path: str) -> str:
    """Return a token valid for MEDIA_TOKEN_MAX_AGE seconds for this exact path."""
    return _signer.sign(relative_path)


def build_signed_media_url(file_field_url_path: str, request=None) -> str:
    """
    Given a FileField .url path (e.g. /media/leases/documents/x.pdf), return the
    same path with a signed token appended. If a request is provided, an absolute
    URI is returned so <img>/<a> tags work cross-origin.
    """
    if not file_field_url_path:
        return file_field_url_path
    rel = _media_relative_path(file_field_url_path)
    token = sign_media_path(rel)
    signed = f'{file_field_url_path}?token={quote(token)}'
    if request is not None:
        return request.build_absolute_uri(signed)
    return signed


def serve_protected_media(request, path):
    """Serve MEDIA_ROOT/<path> only with a valid signed token for that path."""
    token = request.GET.get('token', '')
    if not token:
        return HttpResponseForbidden('Missing media access token.')
    try:
        signed_path = _signer.unsign(token, max_age=MEDIA_TOKEN_MAX_AGE)
    except SignatureExpired:
        return HttpResponseForbidden('Media access token has expired.')
    except BadSignature:
        return HttpResponseForbidden('Invalid media access token.')

    requested = posixpath.normpath(path.replace('\\', '/')).lstrip('/')
    if signed_path != requested:
        return HttpResponseForbidden('Token does not match the requested file.')

    media_root = os.path.abspath(str(settings.MEDIA_ROOT))
    full_path = os.path.abspath(os.path.normpath(os.path.join(media_root, requested)))
    # Traversal guard — the resolved path must stay inside MEDIA_ROOT.
    if os.path.commonpath([media_root, full_path]) != media_root:
        return HttpResponseNotFound('Not found.')
    if not os.path.isfile(full_path):
        return HttpResponseNotFound('Not found.')

    content_type, _ = mimetypes.guess_type(full_path)
    return FileResponse(
        open(full_path, 'rb'),
        content_type=content_type or 'application/octet-stream',
    )
