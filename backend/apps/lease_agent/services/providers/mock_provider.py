import re
from typing import Optional
from .base import LeaseExtractionProvider, ExtractionResult, ExtractedField


DATE_PATTERNS = [
    (r'\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})\b', 'dmy'),
    (r'\b(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})\b', 'ymd'),
    (r'\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b', 'dmonthy'),
    (r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b', 'monthdY'),
]

MONTH_MAP = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
}

# Predefined fields — skipped during dynamic scan (already extracted above)
PREDEFINED_FIELD_NAMES = frozenset([
    'tenant_name', 'landlord_name', 'unit_id', 'start_date', 'end_date',
    'rent_amount', 'currency', 'annual_rent', 'deposit_amount', 'rent_frequency',
    'escalation_clause', 'renewal_terms', 'termination_terms',
    'landlord_signed', 'tenant_signed',
])

# Labels in the document that map to predefined fields (skip during dynamic scan)
PREDEFINED_LABELS = frozenset([
    'tenant', 'landlord', 'lessor', 'lessee', 'owner', 'unit',
    'commencement date', 'start date', 'from', 'beginning',
    'expiry date', 'end date', 'expiration date', 'termination date', 'until', 'to',
    'monthly rent', 'rent amount', 'rental', 'monthly payment',
    'annual rent', 'yearly rent', 'security deposit', 'deposit amount',
    'refundable deposit', 'rent frequency', 'payment frequency',
    'escalation', 'rent increase', 'increment', 'renewal', 'renew',
    'extension', 'termination', 'terminate', 'early exit',
    'landlord signature', 'tenant signature',
])


def _normalize_date(match, fmt: str) -> Optional[str]:
    try:
        if fmt == 'dmy':
            d, m, y = match.group(1), match.group(2), match.group(3)
            return f'{y}-{int(m):02d}-{int(d):02d}'
        elif fmt == 'ymd':
            y, m, d = match.group(1), match.group(2), match.group(3)
            return f'{y}-{int(m):02d}-{int(d):02d}'
        elif fmt == 'dmonthy':
            d, month_name, y = match.group(1), match.group(2).lower(), match.group(3)
            m = MONTH_MAP.get(month_name)
            if not m:
                return None
            return f'{y}-{m}-{int(d):02d}'
        elif fmt == 'monthdY':
            month_name, d, y = match.group(1).lower(), match.group(2), match.group(3)
            m = MONTH_MAP.get(month_name)
            if not m:
                return None
            return f'{y}-{m}-{int(d):02d}'
    except (ValueError, AttributeError):
        return None
    return None


def _find_date_in_pages(pages: list[dict], context_pattern: str) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """Search for a date after a context keyword. Returns (iso_date, page_number, source_text)."""
    for page in pages:
        text = page['text']
        context_match = re.search(context_pattern, text, re.IGNORECASE)
        if context_match:
            # Start AFTER the label so a previous line's date is never captured
            vicinity = text[context_match.end(): context_match.end() + 130]
            for pattern, fmt in DATE_PATTERNS:
                m = re.search(pattern, vicinity, re.IGNORECASE)
                if m:
                    normalized = _normalize_date(m, fmt)
                    if normalized:
                        return normalized, page['page_number'], vicinity.strip()
    return None, None, None


def _find_amount_in_pages(pages: list[dict], context_pattern: str) -> tuple[Optional[float], Optional[str], Optional[int], Optional[str]]:
    """Returns (amount, currency, page_number, source_text)."""
    currency_map = {'QAR': 'QAR', 'USD': 'USD', 'EUR': 'EUR', 'GBP': 'GBP'}
    amount_pattern = r'(QAR|USD|EUR|GBP)?\s*([0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(QAR|USD|EUR|GBP)?'
    for page in pages:
        text = page['text']
        context_match = re.search(context_pattern, text, re.IGNORECASE)
        if context_match:
            # Start AFTER the label to avoid picking up numbers from previous lines
            vicinity = text[context_match.end(): context_match.end() + 155]
            m = re.search(amount_pattern, vicinity, re.IGNORECASE)
            if m:
                currency = (m.group(1) or m.group(3) or 'QAR').upper()
                amount_str = m.group(2).replace(',', '')
                try:
                    return float(amount_str), currency_map.get(currency, currency), page['page_number'], vicinity.strip()
                except ValueError:
                    continue
    return None, None, None, None


def _find_name_in_pages(pages: list[dict], context_pattern: str) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """Returns (name, page_number, source_text)."""
    name_pattern = r'([A-Z][a-zA-Z\s\.\-\']{2,60}?)(?:\s*[,\n\r]|\s+(?:hereinafter|referred|of|residing))'
    for page in pages:
        text = page['text']
        context_match = re.search(context_pattern, text, re.IGNORECASE)
        if context_match:
            vicinity = text[context_match.end(): context_match.end() + 200]
            m = re.search(name_pattern, vicinity)
            if m:
                name = m.group(1).strip()
                if len(name) > 3:
                    return name, page['page_number'], vicinity[:100].strip()
    return None, None, None


def _find_unit_in_pages(pages: list[dict]) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """Look for unit IDs matching MC-[A-Z]-\\d{4} pattern."""
    unit_pattern = r'\b(MC-[A-B]-\d{4})\b'
    for page in pages:
        m = re.search(unit_pattern, page['text'])
        if m:
            return m.group(1), page['page_number'], page['text'][max(0, m.start()-30):m.end()+30].strip()
    return None, None, None


def _label_to_field_name(label: str) -> str:
    """Convert a document label to a snake_case field_name."""
    clean = re.sub(r'[^a-z0-9\s]', '', label.lower().strip())
    return re.sub(r'\s+', '_', clean.strip())


def _is_predefined_label(label: str) -> bool:
    """True if this label overlaps with one of the predefined fields already extracted."""
    label_lower = label.lower().strip()
    for predefined in PREDEFINED_LABELS:
        if predefined in label_lower or label_lower in predefined:
            return True
    return False


def _discover_dynamic_fields(pages: list[dict]) -> list[ExtractedField]:
    """
    Scan all pages for 'Label: Value' patterns not already in the predefined set.
    Returns new ExtractedField items for anything not yet extracted.
    """
    # Pattern: "Word (Word)*: rest of line" — captures labelled key-value pairs
    label_value_pattern = re.compile(
        r'^[ \t]*([A-Z][A-Za-z0-9\s\(\)/\-]{2,60}?)\s*[:–—]\s*(.{1,300})$',
        re.MULTILINE
    )
    discovered: dict[str, ExtractedField] = {}
    contradictions: dict[str, list[str]] = {}

    for page in pages:
        text = page['text']
        for m in label_value_pattern.finditer(text):
            label = m.group(1).strip()
            value = m.group(2).strip()

            # Skip empty values, predefined labels, and signature lines
            if not value or _is_predefined_label(label):
                continue
            if re.match(r'^_{3,}$|^\*{3,}$', value):  # blank signature line
                continue
            if len(value) < 2:
                continue

            field_name = _label_to_field_name(label)
            if not field_name or len(field_name) < 3:
                continue

            source_ctx = text[max(0, m.start() - 20): m.end() + 50].strip()

            if field_name in discovered:
                # Same field found again — check for contradiction
                existing_val = discovered[field_name].raw_value
                if existing_val.lower() != value.lower():
                    contradictions.setdefault(field_name, [existing_val]).append(value)
                    discovered[field_name].has_contradiction = True
                    discovered[field_name].contradiction_note = (
                        f'Multiple values found: {existing_val!r} vs {value!r}'
                    )
            else:
                discovered[field_name] = ExtractedField(
                    field_name=field_name,
                    display_label=label,
                    raw_value=value,
                    normalized_value=value,
                    confidence=0.60,
                    source_page=page['page_number'],
                    source_text=source_ctx,
                    data_type='text',
                    category='other',
                    extraction_method='dynamic_scan',
                )

    return list(discovered.values())


def _discover_clause_sections(document_text: str, pages: list[dict]) -> list[dict]:
    """
    Identify labelled clause sections in the document and return them as
    additional_clauses records for LeaseClause persistence.
    """
    # Matches numbered/lettered clause headings: "1. Title" or "Article 3: Title" etc.
    section_pattern = re.compile(
        r'(?:^|\n)[ \t]*(?:\d+\.|\([a-z]\)|Article\s+\d+|Clause\s+\d+)\s+'
        r'([A-Z][A-Za-z\s\-]+?)\s*\n((?:.|\n){10,500}?)(?=(?:\n[ \t]*(?:\d+\.|\([a-z]\)|Article\s+\d+|Clause\s+\d+)|$))',
        re.IGNORECASE | re.MULTILINE
    )

    # Also catch labelled paragraphs: "Pet Policy:\n ..."
    labeled_block_pattern = re.compile(
        r'(?:^|\n)[ \t]*([A-Z][A-Za-z\s\-\/]{3,50}?)\s*:\s*\n((?:.|\n){10,400}?)(?=\n\n|\n[A-Z]|\Z)',
        re.MULTILINE
    )

    seen_titles: set[str] = set()
    clauses = []

    # Known clause keywords that imply legal/operational significance
    clause_keywords = [
        'pet', 'smoking', 'parking', 'utility', 'utilities', 'insurance',
        'subletting', 'sublet', 'noise', 'alterations', 'modification',
        'access', 'inspection', 'guest', 'storage', 'assignment',
        'indemnity', 'liability', 'force majeure', 'dispute', 'governing law',
        'payment method', 'late payment', 'penalty', 'fine', 'lock',
        'key', 'notice period', 'right of entry', 'maintenance',
        'cleaning', 'handover', 'inventory', 'amenities',
    ]

    def _is_unusual(title: str, text: str) -> tuple[bool, str]:
        title_lower = title.lower()
        text_lower = text.lower()
        for kw in ['no pets', 'subletting not permitted', 'not permitted', 'prohibited',
                   'penalty', 'fine of', 'must not', 'shall not', 'strictly']:
            if kw in title_lower or kw in text_lower:
                return True, f'Contains restrictive language: "{kw}"'
        return False, ''

    for pattern in (section_pattern, labeled_block_pattern):
        for m in pattern.finditer(document_text):
            title = m.group(1).strip()
            body = m.group(2).strip()
            if not title or len(body) < 10:
                continue
            title_key = title.lower()
            if title_key in seen_titles:
                continue

            # Only capture if the title relates to a known clause keyword
            # OR the body is substantive (>50 chars and doesn't look like a field value)
            is_clause_relevant = any(kw in title.lower() or kw in body.lower() for kw in clause_keywords)
            is_substantive = len(body) > 50 and '\n' not in body[:30]

            if not (is_clause_relevant or is_substantive):
                continue

            seen_titles.add(title_key)
            unusual, reason = _is_unusual(title, body)

            clauses.append({
                'clause_type': _label_to_field_name(title),
                'title': title[:255],
                'raw_text': body[:2000],
                'interpretation': '',
                'source_type': 'explicit',
                'source_page': _find_page_for_text(pages, body[:50]),
                'source_text': body[:300],
                'confidence': 0.65,
                'is_unusual': unusual,
                'unusual_reason': reason,
            })

    return clauses


def _find_page_for_text(pages: list[dict], fragment: str) -> Optional[int]:
    for page in pages:
        if fragment[:30] in page['text']:
            return page['page_number']
    return None


class MockLeaseExtractionProvider(LeaseExtractionProvider):
    """
    Deterministic mock extraction provider.
    Extracts predefined business-critical fields AND dynamically discovers
    additional label-value pairs and clause sections present in the document.

    Behaviour:
    - Predefined fields: searched by targeted label patterns.
    - Dynamic fields: generic 'Label: Value' scan for everything else.
    - Clause sections: numbered/labelled paragraphs persisted as LeaseClause.
    - Contradictions: if the same label appears twice with different values, both
      are preserved and the field is flagged has_contradiction=True.
    - Never fabricates: absent fields return raw_value='NOT_FOUND', confidence=0.0.
    """

    PROVIDER_NAME = 'mock'

    def extract(self, document_text: str, pages: list[dict]) -> ExtractionResult:
        extracted_fields = []

        # ── Predefined field extraction ────────────────────────────────────────

        # Tenant name
        tenant, t_page, t_src = _find_name_in_pages(
            pages, r'(?:tenant|lessee|tenant\s*name)\s*[:\-]?'
        )
        extracted_fields.append(ExtractedField(
            field_name='tenant_name', display_label='Tenant Name',
            raw_value=tenant or 'NOT_FOUND', normalized_value=tenant,
            confidence=0.88 if tenant else 0.0,
            source_page=t_page, source_text=t_src or '',
            data_type='text', category='parties', extraction_method='predefined',
        ))

        # Landlord name
        landlord, l_page, l_src = _find_name_in_pages(
            pages, r'(?:landlord|lessor|owner)\s*[:\-]?'
        )
        extracted_fields.append(ExtractedField(
            field_name='landlord_name', display_label='Landlord Name',
            raw_value=landlord or 'NOT_FOUND', normalized_value=landlord,
            confidence=0.86 if landlord else 0.0,
            source_page=l_page, source_text=l_src or '',
            data_type='text', category='parties', extraction_method='predefined',
        ))

        # Unit ID
        unit_id, u_page, u_src = _find_unit_in_pages(pages)
        extracted_fields.append(ExtractedField(
            field_name='unit_id', display_label='Unit Reference',
            raw_value=unit_id or 'NOT_FOUND', normalized_value=unit_id,
            confidence=0.95 if unit_id else 0.0,
            source_page=u_page, source_text=u_src or '',
            data_type='text', category='parties', extraction_method='predefined',
        ))

        # Start date
        start_date, sd_page, sd_src = _find_date_in_pages(
            pages, r'(?:commencement|start|from|beginning)\s*(?:date)?\s*[:\-]?'
        )
        extracted_fields.append(ExtractedField(
            field_name='start_date', display_label='Commencement Date',
            raw_value=start_date or 'NOT_FOUND', normalized_value=start_date,
            confidence=0.87 if start_date else 0.0,
            source_page=sd_page, source_text=sd_src or '',
            data_type='date', category='dates', extraction_method='predefined',
        ))

        # End date
        end_date, ed_page, ed_src = _find_date_in_pages(
            pages, r'(?:expiry|end|termination|expiration|until|to)\s*(?:date)?\s*[:\-]?'
        )
        extracted_fields.append(ExtractedField(
            field_name='end_date', display_label='Expiry Date',
            raw_value=end_date or 'NOT_FOUND', normalized_value=end_date,
            confidence=0.85 if end_date else 0.0,
            source_page=ed_page, source_text=ed_src or '',
            data_type='date', category='dates', extraction_method='predefined',
        ))

        # Monthly rent
        rent_amount, currency, r_page, r_src = _find_amount_in_pages(
            pages, r'(?:monthly\s+rent|rent\s+amount|rental|monthly\s+payment)\s*[:\-]?'
        )
        extracted_fields.append(ExtractedField(
            field_name='rent_amount', display_label='Monthly Rent',
            raw_value=str(rent_amount) if rent_amount is not None else 'NOT_FOUND',
            normalized_value=rent_amount,
            confidence=0.85 if rent_amount is not None else 0.0,
            source_page=r_page, source_text=r_src or '',
            data_type='amount', category='financial', extraction_method='predefined',
        ))

        extracted_fields.append(ExtractedField(
            field_name='currency', display_label='Currency',
            raw_value=currency or 'NOT_FOUND', normalized_value=currency,
            confidence=0.85 if currency else 0.0,
            source_page=r_page, source_text=r_src or '',
            data_type='text', category='financial', extraction_method='predefined',
        ))

        # Annual rent
        annual_rent, _, ar_page, ar_src = _find_amount_in_pages(
            pages, r'(?:annual\s+rent|yearly\s+rent|per\s+annum)\s*[:\-]?'
        )
        extracted_fields.append(ExtractedField(
            field_name='annual_rent', display_label='Annual Rent',
            raw_value=str(annual_rent) if annual_rent is not None else 'NOT_FOUND',
            normalized_value=annual_rent,
            confidence=0.82 if annual_rent is not None else 0.0,
            source_page=ar_page, source_text=ar_src or '',
            data_type='amount', category='financial', extraction_method='predefined',
        ))

        # Deposit
        deposit, _, dep_page, dep_src = _find_amount_in_pages(
            pages, r'(?:security\s+deposit|deposit\s+amount|refundable\s+deposit)\s*[:\-]?'
        )
        extracted_fields.append(ExtractedField(
            field_name='deposit_amount', display_label='Security Deposit',
            raw_value=str(deposit) if deposit is not None else 'NOT_FOUND',
            normalized_value=deposit,
            confidence=0.84 if deposit is not None else 0.0,
            source_page=dep_page, source_text=dep_src or '',
            data_type='amount', category='financial', extraction_method='predefined',
        ))

        # Rent frequency
        freq_match = re.search(r'\b(monthly|quarterly|annually|yearly|weekly)\b', document_text, re.IGNORECASE)
        freq = freq_match.group(1).lower() if freq_match else None
        extracted_fields.append(ExtractedField(
            field_name='rent_frequency', display_label='Rent Frequency',
            raw_value=freq or 'NOT_FOUND', normalized_value=freq,
            confidence=0.80 if freq else 0.0,
            source_page=None, source_text='',
            data_type='text', category='financial', extraction_method='predefined',
        ))

        # Escalation clause
        esc_match = re.search(
            r'(?:escalation|rent\s+increase|increment)[^\n]{0,300}',
            document_text, re.IGNORECASE | re.DOTALL
        )
        esc_text = esc_match.group(0)[:300].strip() if esc_match else None
        extracted_fields.append(ExtractedField(
            field_name='escalation_clause', display_label='Escalation Clause',
            raw_value=esc_text or 'NOT_FOUND', normalized_value=esc_text,
            confidence=0.75 if esc_text else 0.0,
            source_page=None, source_text=esc_text or '',
            data_type='text', category='clauses', extraction_method='predefined',
        ))

        # Renewal terms
        ren_match = re.search(
            r'(?:renewal|renew|extension)[^\n]{0,300}',
            document_text, re.IGNORECASE | re.DOTALL
        )
        ren_text = ren_match.group(0)[:300].strip() if ren_match else None
        extracted_fields.append(ExtractedField(
            field_name='renewal_terms', display_label='Renewal Terms',
            raw_value=ren_text or 'NOT_FOUND', normalized_value=ren_text,
            confidence=0.72 if ren_text else 0.0,
            source_page=None, source_text=ren_text or '',
            data_type='text', category='clauses', extraction_method='predefined',
        ))

        # Termination terms
        term_match = re.search(
            r'(?:termination|terminate|early\s+exit)[^\n]{0,300}',
            document_text, re.IGNORECASE | re.DOTALL
        )
        term_text = term_match.group(0)[:300].strip() if term_match else None
        extracted_fields.append(ExtractedField(
            field_name='termination_terms', display_label='Termination Terms',
            raw_value=term_text or 'NOT_FOUND', normalized_value=term_text,
            confidence=0.72 if term_text else 0.0,
            source_page=None, source_text=term_text or '',
            data_type='text', category='clauses', extraction_method='predefined',
        ))

        # Signature presence
        landlord_signed = bool(re.search(r'(?:landlord|lessor)\s*(?:signature|signed|sign)', document_text, re.IGNORECASE))
        tenant_signed = bool(re.search(r'(?:tenant|lessee)\s*(?:signature|signed|sign)', document_text, re.IGNORECASE))
        extracted_fields.append(ExtractedField(
            field_name='landlord_signed', display_label='Landlord Signed',
            raw_value=str(landlord_signed), normalized_value=landlord_signed,
            confidence=0.70, source_page=None, source_text='',
            data_type='boolean', category='parties', extraction_method='predefined',
        ))
        extracted_fields.append(ExtractedField(
            field_name='tenant_signed', display_label='Tenant Signed',
            raw_value=str(tenant_signed), normalized_value=tenant_signed,
            confidence=0.70, source_page=None, source_text='',
            data_type='boolean', category='parties', extraction_method='predefined',
        ))

        # ── Dynamic field discovery ────────────────────────────────────────────
        # Scan for any additional 'Label: Value' pairs not already captured above.
        already_extracted = {ef.field_name for ef in extracted_fields}
        dynamic_fields = _discover_dynamic_fields(pages)
        for df in dynamic_fields:
            if df.field_name not in already_extracted:
                extracted_fields.append(df)

        # ── Dynamic clause section discovery ──────────────────────────────────
        additional_clauses = _discover_clause_sections(document_text, pages)

        raw_output = {
            'provider': self.PROVIDER_NAME,
            'note': 'Mock provider — pattern-based extraction from document text. Not genuine AI inference.',
            'fields_found': [f.field_name for f in extracted_fields if f.raw_value != 'NOT_FOUND'],
            'fields_missing': [f.field_name for f in extracted_fields if f.raw_value == 'NOT_FOUND'],
            'dynamic_fields_discovered': [f.field_name for f in extracted_fields if f.extraction_method == 'dynamic_scan'],
            'additional_clauses': additional_clauses,
        }

        return ExtractionResult(
            fields=extracted_fields,
            provider_name=self.PROVIDER_NAME,
            raw_output=raw_output,
        )
