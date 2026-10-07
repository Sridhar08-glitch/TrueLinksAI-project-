"""Generates the rent payment schedule for a lease. Idempotent by (lease, due_date)."""
import logging

from apps.common.dates import add_months
from apps.payments.models import PaymentScheduleItem

logger = logging.getLogger(__name__)

# Months between consecutive payments for each rent frequency.
FREQUENCY_STEP_MONTHS = {
    'monthly': 1,
    'quarterly': 3,
    'semi-annually': 6,
    'semi_annually': 6,
    'annually': 12,
    'yearly': 12,
}


def generate_for_lease(lease) -> int:
    """
    Create PaymentScheduleItem rows from start_date to end_date (inclusive) at
    rent_amount, honoring lease.rent_frequency (defaults to monthly). Existing
    (lease, due_date) rows are skipped so re-runs never duplicate. Returns the
    number of items created.
    """
    if not lease.start_date or not lease.end_date or lease.rent_amount is None:
        logger.info(
            'Skipping payment schedule for lease %s — start/end date or rent amount missing.',
            lease.pk,
        )
        return 0
    if lease.end_date < lease.start_date:
        logger.warning('Skipping payment schedule for lease %s — end date before start date.', lease.pk)
        return 0

    frequency = (lease.rent_frequency or 'monthly').strip().lower()
    step = FREQUENCY_STEP_MONTHS.get(frequency, 1)

    existing = set(
        PaymentScheduleItem.objects.filter(lease=lease).values_list('due_date', flat=True)
    )

    items = []
    due = lease.start_date
    i = 1
    # Safety cap: never generate more than 100 years of monthly items.
    while due <= lease.end_date and len(items) + len(existing) < 1200:
        if due not in existing:
            items.append(PaymentScheduleItem(
                lease=lease,
                due_date=due,
                amount=lease.rent_amount,
                currency=lease.currency or 'QAR',
            ))
        due = add_months(lease.start_date, step * i)
        i += 1

    PaymentScheduleItem.objects.bulk_create(items, ignore_conflicts=True)
    return len(items)
