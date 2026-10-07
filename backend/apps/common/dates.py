"""Small date helpers shared across apps."""
import calendar
from datetime import date


def add_months(d: date, months: int) -> date:
    """Add N months to a date, clamping the day to the target month's length."""
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)
