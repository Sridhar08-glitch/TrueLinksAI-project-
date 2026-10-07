"""Expiring-leases filter and the AI lease Q&A endpoint (Ollama mocked)."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.leases.models import Lease, ApprovalStatus, ProcessingStatus


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    from django.core.cache import cache
    cache.clear()


def _lease(unit, *, end_in_days=None, approved=True, extracted_text=None, **kwargs):
    today = date.today()
    return Lease.objects.create(
        unit=unit,
        tenant_name=kwargs.pop('tenant_name', 'Filter Tester'),
        start_date=today - timedelta(days=200),
        end_date=today + timedelta(days=end_in_days) if end_in_days is not None else None,
        rent_amount=Decimal('1200.00'),
        currency='USD',
        document='leases/documents/filter_test.pdf',
        processing_status=ProcessingStatus.COMPLETED,
        approval_status=ApprovalStatus.APPROVED if approved else ApprovalStatus.PENDING_REVIEW,
        extracted_text=extracted_text,
        **kwargs,
    )


@pytest.mark.django_db
class TestExpiringWithinFilter:
    def test_filter_returns_only_window_and_ordered(self, auth_client, building):
        from apps.units.models import Unit
        units = [
            Unit.objects.create(
                external_unit_id=f'EXP-{i}', building=building, label=f'U{i}',
                unit_type='1BR', area_sqm=50,
            )
            for i in range(5)
        ]
        inside_late = _lease(units[0], end_in_days=25)
        inside_early = _lease(units[1], end_in_days=5)
        _lease(units[2], end_in_days=90)              # outside window
        _lease(units[3], end_in_days=-3)              # already ended
        _lease(units[4], end_in_days=10, approved=False)  # not approved

        resp = auth_client.get('/api/v1/leases/', {'expiring_within': '30'})
        assert resp.status_code == 200
        ids = [item['id'] for item in resp.data['results']]
        assert ids == [inside_early.id, inside_late.id]

    def test_invalid_value_is_ignored(self, auth_client, available_unit):
        _lease(available_unit, end_in_days=400)
        resp = auth_client.get('/api/v1/leases/', {'expiring_within': 'bogus'})
        assert resp.status_code == 200
        assert resp.data['count'] == 1


@pytest.mark.django_db
class TestLeaseAsk:
    def test_ask_returns_answer_with_mocked_ollama(self, auth_client, available_unit, monkeypatch):
        lease = _lease(
            available_unit,
            end_in_days=100,
            extracted_text='The tenant may keep one small dog with prior written consent.',
        )

        def fake_generate(prompt):
            assert 'small dog' in prompt
            assert 'What are the pet rules?' in prompt
            return {'response': 'Pets: "one small dog with prior written consent."', 'model': 'test-model'}

        monkeypatch.setattr('apps.leases.services.lease_qa._ollama_generate', fake_generate)
        resp = auth_client.post(
            f'/api/v1/leases/{lease.id}/ask/',
            {'question': 'What are the pet rules?'}, format='json',
        )
        assert resp.status_code == 200
        assert resp.data['answer'].startswith('Pets:')
        assert resp.data['model'] == 'test-model'

    def test_ask_without_extracted_text_is_400(self, auth_client, available_unit):
        lease = _lease(available_unit, end_in_days=100, extracted_text=None)
        resp = auth_client.post(
            f'/api/v1/leases/{lease.id}/ask/', {'question': 'Anything?'}, format='json',
        )
        assert resp.status_code == 400

    def test_ask_requires_question(self, auth_client, available_unit):
        lease = _lease(available_unit, end_in_days=100, extracted_text='text')
        resp = auth_client.post(f'/api/v1/leases/{lease.id}/ask/', {}, format='json')
        assert resp.status_code == 400

    def test_ask_ollama_down_is_503(self, auth_client, available_unit, monkeypatch):
        lease = _lease(available_unit, end_in_days=100, extracted_text='lease text')

        def broken(prompt):
            raise ConnectionError('Ollama not reachable at http://localhost:11434.')

        monkeypatch.setattr('apps.leases.services.lease_qa._ollama_generate', broken)
        resp = auth_client.post(
            f'/api/v1/leases/{lease.id}/ask/', {'question': 'Rent?'}, format='json',
        )
        assert resp.status_code == 503
        assert 'detail' in resp.data

    def test_tenant_cannot_ask(self, tenant_client, available_unit):
        lease = _lease(available_unit, end_in_days=100, extracted_text='text')
        resp = tenant_client.post(
            f'/api/v1/leases/{lease.id}/ask/', {'question': 'Rent?'}, format='json',
        )
        assert resp.status_code == 403
