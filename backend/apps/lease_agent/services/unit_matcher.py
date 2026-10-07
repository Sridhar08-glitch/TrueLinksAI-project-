import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class MatchResult:
    status: str  # 'exact', 'no_match', 'ambiguous'
    unit_id: Optional[int] = None
    external_unit_id: Optional[str] = None
    candidates: list = None
    message: str = ''

    def __post_init__(self):
        if self.candidates is None:
            self.candidates = []


class UnitMatcher:
    def match(self, extracted_unit_id: str) -> MatchResult:
        from apps.units.models import Unit

        if not extracted_unit_id or extracted_unit_id == 'NOT_FOUND':
            return MatchResult(
                status='no_match',
                message='No unit identifier was found in the document.',
            )

        query = extracted_unit_id.strip()

        # 1. Exact match on external_unit_id
        result = self._try_exact(Unit, external_unit_id__iexact=query)
        if result:
            return result

        # 2. Exact match on label (e.g. document says "Unit 101", label is "Unit 101")
        result = self._try_exact(Unit, label__iexact=query)
        if result:
            return result

        # 3. Label matches "Unit <id>" prefix (document has just the number, e.g. "101")
        result = self._try_exact(Unit, label__iexact=f'Unit {query}')
        if result:
            return result

        # 4. Label ends with the extracted ID (e.g. "Block A - 101" ends with "101")
        result = self._try_exact(Unit, label__iendswith=query)
        if result:
            return result

        # 5. Partial label contains with word boundary (e.g. label "Unit 101" contains "101")
        candidates = list(
            Unit.objects.filter(label__iregex=rf'(^|\b){re.escape(query)}(\b|$)')
        )
        if len(candidates) == 1:
            u = candidates[0]
            return MatchResult(
                status='exact',
                unit_id=u.id,
                external_unit_id=u.external_unit_id,
                message=f'Matched unit by label pattern: {u.label}',
            )
        if len(candidates) > 1:
            return MatchResult(
                status='ambiguous',
                candidates=[{'id': u.id, 'external_unit_id': u.external_unit_id, 'label': u.label} for u in candidates],
                message=f'Multiple units matched "{query}". Human resolution required.',
            )

        return MatchResult(
            status='no_match',
            message=f'No unit found matching "{query}". Lease flagged for manual unit assignment.',
        )

    def _try_exact(self, Unit, **lookup):
        try:
            unit = Unit.objects.get(**lookup)
            return MatchResult(
                status='exact',
                unit_id=unit.id,
                external_unit_id=unit.external_unit_id,
                message=f'Matched unit: {unit.label} ({unit.external_unit_id})',
            )
        except Unit.DoesNotExist:
            return None
        except Unit.MultipleObjectsReturned:
            units = Unit.objects.filter(**lookup)
            return MatchResult(
                status='ambiguous',
                candidates=[{'id': u.id, 'external_unit_id': u.external_unit_id, 'label': u.label} for u in units],
                message=f'Multiple units matched. Human resolution required.',
            )
