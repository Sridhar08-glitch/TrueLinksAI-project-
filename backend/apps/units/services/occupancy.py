"""Single place where unit occupancy transitions happen so all flows stay in sync."""
from apps.units.models import Unit, OccupancyStatus


def mark_occupied(unit: Unit) -> None:
    """Mark a unit occupied (lease approved / tenant assigned)."""
    if unit is None:
        return
    if unit.occupancy_status != OccupancyStatus.OCCUPIED:
        unit.occupancy_status = OccupancyStatus.OCCUPIED
        unit.save(update_fields=['occupancy_status', 'updated_at'])


def mark_available(unit: Unit) -> None:
    """Mark a unit available (lease cancelled / assignment ended)."""
    if unit is None:
        return
    if unit.occupancy_status != OccupancyStatus.AVAILABLE:
        unit.occupancy_status = OccupancyStatus.AVAILABLE
        unit.save(update_fields=['occupancy_status', 'updated_at'])
