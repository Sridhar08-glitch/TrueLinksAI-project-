"""Rent ledger: schedule generation, mark-paid/unpaid, filters, summary, my-info."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.leases.models import Lease, ApprovalStatus, ProcessingStatus
from apps.payments.models import PaymentScheduleItem, PaymentStatus
from apps.payments.services.schedule_generator import generate_for_lease


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    from django.core.cache import cache
    cache.clear()


def _make_lease(unit, start, end, rent='1000.00', frequency='monthly', approved=True):
    return Lease.objects.create(
        unit=unit,
        tenant_name='Pay Tester',
        start_date=start,
        end_date=end,
        rent_amount=Decimal(rent),
        currency='USD',
        rent_frequency=frequency,
        document='leases/documents/pay_test.pdf',
        processing_status=ProcessingStatus.COMPLETED,
        approval_status=ApprovalStatus.APPROVED if approved else ApprovalStatus.PENDING_REVIEW,
    )


@pytest.mark.django_db
class TestScheduleGeneration:
    def test_monthly_schedule_count(self, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 12, 31))
        created = generate_for_lease(lease)
        assert created == 12
        dates = list(lease.payments.values_list('due_date', flat=True))
        assert dates[0] == date(2026, 1, 1)
        assert dates[-1] == date(2026, 12, 1)
        assert all(item.amount == Decimal('1000.00') for item in lease.payments.all())
        assert all(item.currency == 'USD' for item in lease.payments.all())

    def test_generation_is_idempotent(self, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 6, 30))
        assert generate_for_lease(lease) == 6
        assert generate_for_lease(lease) == 0
        assert lease.payments.count() == 6

    def test_quarterly_frequency(self, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 15), date(2026, 12, 31), frequency='quarterly')
        assert generate_for_lease(lease) == 4

    def test_missing_dates_returns_zero(self, available_unit):
        lease = Lease.objects.create(
            unit=available_unit, tenant_name='No Dates',
            document='leases/documents/x.pdf', rent_amount=Decimal('500.00'),
        )
        assert generate_for_lease(lease) == 0

    def test_manual_generate_endpoint(self, auth_client, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 3, 31))
        resp = auth_client.post(f'/api/v1/leases/{lease.id}/generate-schedule/')
        assert resp.status_code == 200
        assert resp.data['created'] == 3

    def test_approve_auto_generates_schedule(self, auth_client, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 4, 30), approved=False)
        resp = auth_client.post(f'/api/v1/leases/{lease.id}/approve/')
        assert resp.status_code == 200
        assert lease.payments.count() == 4


@pytest.mark.django_db
class TestPaymentEndpoints:
    def test_mark_paid_defaults(self, auth_client, owner_user, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 2, 28))
        generate_for_lease(lease)
        item = lease.payments.first()

        resp = auth_client.post(f'/api/v1/payments/{item.id}/mark-paid/', {}, format='json')
        assert resp.status_code == 200
        item.refresh_from_db()
        assert item.status == PaymentStatus.PAID
        assert item.paid_amount == item.amount
        assert item.paid_at is not None
        assert item.recorded_by == owner_user.email

        # Already paid → conflict
        resp = auth_client.post(f'/api/v1/payments/{item.id}/mark-paid/', {}, format='json')
        assert resp.status_code == 409

    def test_mark_paid_with_fields_and_unpaid_revert(self, auth_client, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 1, 31))
        generate_for_lease(lease)
        item = lease.payments.first()

        resp = auth_client.post(
            f'/api/v1/payments/{item.id}/mark-paid/',
            {'paid_amount': '950.00', 'payment_method': 'bank transfer', 'notes': 'partial'},
            format='json',
        )
        assert resp.status_code == 200
        item.refresh_from_db()
        assert item.paid_amount == Decimal('950.00')
        assert item.payment_method == 'bank transfer'

        resp = auth_client.post(f'/api/v1/payments/{item.id}/mark-unpaid/')
        assert resp.status_code == 200
        item.refresh_from_db()
        assert item.status == PaymentStatus.PENDING
        assert item.paid_at is None
        assert item.paid_amount is None

    def test_overdue_is_computed(self, auth_client, available_unit):
        today = date.today()
        lease = _make_lease(available_unit, today - timedelta(days=400), today + timedelta(days=100))
        PaymentScheduleItem.objects.create(
            lease=lease, due_date=today - timedelta(days=10), amount=Decimal('1000.00'),
        )
        PaymentScheduleItem.objects.create(
            lease=lease, due_date=today + timedelta(days=10), amount=Decimal('1000.00'),
        )

        resp = auth_client.get('/api/v1/payments/', {'status': 'overdue'})
        assert resp.status_code == 200
        results = resp.data['results']
        assert len(results) == 1
        assert results[0]['status'] == 'overdue'

        resp = auth_client.get('/api/v1/payments/', {'status': 'pending'})
        assert len(resp.data['results']) == 1
        assert resp.data['results'][0]['status'] == 'pending'

    def test_due_date_filters(self, auth_client, available_unit):
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 12, 31))
        generate_for_lease(lease)
        resp = auth_client.get(
            '/api/v1/payments/',
            {'lease': lease.id, 'due_after': '2026-03-01', 'due_before': '2026-06-30'},
        )
        assert resp.status_code == 200
        assert resp.data['count'] == 4  # Mar, Apr, May, Jun

    def test_summary_keys_and_overdue(self, auth_client, available_unit):
        today = date.today()
        lease = _make_lease(available_unit, today - timedelta(days=400), today + timedelta(days=100))
        PaymentScheduleItem.objects.create(
            lease=lease, due_date=today - timedelta(days=5), amount=Decimal('800.00'),
        )
        resp = auth_client.get('/api/v1/payments/summary/')
        assert resp.status_code == 200
        for key in ('total_due_this_month', 'collected_this_month', 'overdue_count',
                    'overdue_amount', 'collection_rate_pct'):
            assert key in resp.data
        assert resp.data['overdue_count'] == 1
        assert resp.data['overdue_amount'] == 800.0

    def test_tenant_cannot_access_payments(self, tenant_client):
        resp = tenant_client.get('/api/v1/payments/')
        assert resp.status_code == 403

    def test_dashboard_includes_payment_keys(self, auth_client):
        resp = auth_client.get('/api/v1/dashboard/stats/')
        assert resp.status_code == 200
        assert 'overdue_payments' in resp.data
        assert 'collected_this_month' in resp.data


@pytest.mark.django_db
class TestMyInfoPayments:
    def test_tenant_sees_own_payments(self, tenant_client, tenant_user, owner_user, available_unit):
        from apps.users.models import TenantAssignment
        TenantAssignment.objects.create(
            unit=available_unit, tenant=tenant_user,
            move_in_date=date(2026, 1, 1), assigned_by=owner_user,
        )
        lease = _make_lease(available_unit, date(2026, 1, 1), date(2026, 3, 31))
        generate_for_lease(lease)

        resp = tenant_client.get('/api/v1/users/my-info/')
        assert resp.status_code == 200
        assert 'payments' in resp.data
        payments = resp.data['payments']
        assert len(payments) == 3
        for p in payments:
            assert set(p.keys()) >= {'id', 'due_date', 'amount', 'currency', 'status', 'paid_at'}

    def test_my_info_without_assignment_has_payments_key(self, tenant_client):
        resp = tenant_client.get('/api/v1/users/my-info/')
        assert resp.status_code == 200
        assert resp.data['payments'] == []
