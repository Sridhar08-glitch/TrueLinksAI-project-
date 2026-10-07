"""Protected media: only valid signed tokens may read files under /media/."""
import time as real_time
from urllib.parse import urlparse, parse_qs

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.common.media import build_signed_media_url
from apps.leases.models import Lease

PDF_BYTES = b'%PDF-1.4 signed media test'


@pytest.fixture
def lease_with_file(db, available_unit, tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    lease = Lease.objects.create(
        unit=available_unit,
        tenant_name='Media Tester',
        document=SimpleUploadedFile('signed_media_test.pdf', PDF_BYTES),
    )
    return lease


@pytest.mark.django_db
class TestSignedMedia:
    def test_serializer_emits_signed_url_and_token_grants_access(self, auth_client, lease_with_file):
        resp = auth_client.get(f'/api/v1/leases/{lease_with_file.id}/')
        assert resp.status_code == 200
        doc_url = resp.data['document']
        assert doc_url is not None
        assert 'token=' in doc_url

        parsed = urlparse(doc_url)
        token = parse_qs(parsed.query)['token'][0]
        anon = APIClient()
        download = anon.get(parsed.path, {'token': token})
        assert download.status_code == 200
        assert b''.join(download.streaming_content) == PDF_BYTES

    def test_missing_token_is_rejected(self, lease_with_file):
        anon = APIClient()
        resp = anon.get(lease_with_file.document.url)
        assert resp.status_code == 403

    def test_tampered_token_is_rejected(self, lease_with_file):
        signed = build_signed_media_url(lease_with_file.document.url)
        parsed = urlparse(signed)
        token = parse_qs(parsed.query)['token'][0] + 'tampered'
        anon = APIClient()
        resp = anon.get(parsed.path, {'token': token})
        assert resp.status_code == 403

    def test_token_for_other_path_is_rejected(self, lease_with_file):
        # A valid token for file A must not open file B.
        signed = build_signed_media_url('/media/some/other/file.pdf')
        token = parse_qs(urlparse(signed).query)['token'][0]
        anon = APIClient()
        resp = anon.get(lease_with_file.document.url, {'token': token})
        assert resp.status_code == 403

    def test_expired_token_is_rejected(self, lease_with_file, monkeypatch):
        signed = build_signed_media_url(lease_with_file.document.url)
        parsed = urlparse(signed)
        token = parse_qs(parsed.query)['token'][0]

        now = real_time.time()
        monkeypatch.setattr('django.core.signing.time.time', lambda: now + 7200)
        anon = APIClient()
        resp = anon.get(parsed.path, {'token': token})
        assert resp.status_code == 403

    def test_missing_file_is_404(self, db):
        signed = build_signed_media_url('/media/does/not/exist.pdf')
        parsed = urlparse(signed)
        token = parse_qs(parsed.query)['token'][0]
        anon = APIClient()
        resp = anon.get(parsed.path, {'token': token})
        assert resp.status_code == 404

    def test_inspection_image_serializer_emits_signed_url(
        self, auth_client, available_unit, tmp_path, settings
    ):
        settings.MEDIA_ROOT = tmp_path
        from apps.inspections.models import Inspection, InspectionImage

        inspection = Inspection.objects.create(unit=available_unit, reporter_type='owner')
        # 1x1 PNG
        png = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
            b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0'
            b'\x00\x00\x00\x03\x00\x01\x9a\x92\xdd\xca\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        InspectionImage.objects.create(
            inspection=inspection,
            image=SimpleUploadedFile('finding.png', png, content_type='image/png'),
            original_filename='finding.png',
            content_type='image/png',
        )
        resp = auth_client.get(f'/api/v1/inspections/{inspection.id}/')
        assert resp.status_code == 200
        assert 'token=' in resp.data['images'][0]['image']
