"""The Rules Agent: read an owner's policy document and propose rules.

Same philosophy as the lease agent — the AI only *proposes*, every proposal
carries its source quote, and a human approves or rejects each one. The
critical safety property: provider output is forced onto a whitelist of
templates, fields, and operators (structured data). A statement that fits no
safe template becomes a NEEDS_DEVELOPER proposal — it is surfaced honestly,
never guessed at and never executed.

Providers mirror the lease-extraction setup: a deterministic mock (no AI
needed, used by tests) and an Ollama provider behind the same interface.
"""
import json
import re
import urllib.error
import urllib.request

from django.conf import settings

from apps.lease_agent.services.custom_rule_engine import RULE_FIELDS
from apps.lease_agent.services import ruleset_store

# What a proposal is allowed to reference. Anything outside these lists is
# demoted to needs_developer — provider output never widens the whitelist.
ALLOWED_FIELDS = {value for value, _ in RULE_FIELDS}
ALLOWED_TEMPLATES = {
    'number_compare', 'field_compare', 'required_field',
    'date_order', 'text_check', 'term_length', 'allowed_values', 'manual_check',
}
ALLOWED_OPERATORS = {'gte', 'lte', 'eq', 'must_contain', 'must_not_contain'}
ALLOWED_SEVERITIES = {'low', 'medium', 'high'}
# Built-in rule thresholds a proposal may update.
BUILTIN_CONFIG_KEYS = {
    'R1': {'min_deposit_months'},
    'R3': {'max_term_months'},
    'R6': {'tolerance_pct'},
}
# Each threshold key belongs to exactly one rule — used to recover when a
# model returns a malformed target (e.g. the literal placeholder "R1|R3|R6").
KEY_TO_RULE = {key: rule for rule, keys in BUILTIN_CONFIG_KEYS.items() for key in keys}
KEY_LABELS = {
    'min_deposit_months': 'minimum deposit (months of rent)',
    'max_term_months': 'maximum lease term (months)',
    'tolerance_pct': 'rent reconciliation tolerance (%)',
}

_WORD_NUMBERS = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
    'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
}


def _number(token: str):
    token = token.strip().lower().replace(',', '')
    if token in _WORD_NUMBERS:
        return _WORD_NUMBERS[token]
    try:
        value = float(token)
        return int(value) if value.is_integer() else value
    except ValueError:
        return None


def _coerce_number(value):
    """Best-effort numeric coercion for provider output: 2, "2", "2 months",
    "QAR 3,500", "two". Returns None when no number can be found."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    direct = _number(text)
    if direct is not None:
        return direct
    match = re.search(r'\d[\d,]*\.?\d*', text)
    if match:
        return _number(match.group(0))
    for word, number in _WORD_NUMBERS.items():
        if re.search(rf'\b{word}\b', text.lower()):
            return number
    return None


class MockPolicyProvider:
    """Deterministic keyword/regex parsing of a policy document.

    Covers the statements a Gulf residential policy typically contains, and
    files everything else it recognizes as a requirement under
    needs_developer so no statement is silently lost.
    """
    PROVIDER_NAME = 'mock'

    NUM = r'([\d,.]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'

    def extract(self, text: str, pages: list[dict]) -> list[dict]:
        proposals = []
        for sentence, page in _sentences(text, pages):
            proposal = self._match(sentence)
            if proposal is not None:
                proposal['source_quote'] = sentence.strip()[:500]
                proposal['source_page'] = page
                proposals.append(proposal)
        return proposals

    # Clause-text fields a "X must be present / must mention Y" statement can target.
    FIELD_PHRASES = {
        'termination terms': 'termination_terms',
        'termination clause': 'termination_terms',
        'renewal terms': 'renewal_terms',
        'renewal clause': 'renewal_terms',
        'escalation clause': 'escalation_clause',
        'tenant name': 'tenant_name',
        'landlord name': 'landlord_name',
        'unit reference': 'unit_id',
    }
    _PHRASES = '|'.join(FIELD_PHRASES)

    def _match(self, sentence: str):
        s = ' '.join(sentence.lower().split())
        if not re.search(r'\b(must|shall|should|required|at least|at most|no more than|'
                         r'not exceed|permitted|prohibited|not allowed)\b', s):
            return None

        m = re.search(rf'deposit\b.{{0,60}}?{self.NUM}\s+month', s)
        if m and (value := _number(m.group(1))) is not None:
            return {
                'proposal_type': 'rule_update', 'target_rule_id': 'R1',
                'config_changes': {'min_deposit_months': value},
                'description': f'Security deposit must be at least {value} month(s) of rent.',
                'severity': 'high', 'confidence': 0.9,
            }

        m = re.search(rf'(?:term|lease)\b.{{0,60}}?(?:exceed|more than|maximum(?: of)?|at most)\s+{self.NUM}\s+month', s)
        if m and (value := _number(m.group(1))) is not None:
            return {
                'proposal_type': 'rule_update', 'target_rule_id': 'R3',
                'config_changes': {'max_term_months': value},
                'description': f'Lease term must not exceed {value} months.',
                'severity': 'medium', 'confidence': 0.9,
            }

        m = re.search(rf'(?:term|lease)\b.{{0,60}}?(?:at least|minimum(?: of)?|no less than)\s+{self.NUM}\s+month', s)
        if m and (value := _number(m.group(1))) is not None:
            return {
                'proposal_type': 'custom_rule', 'template': 'term_length',
                'field_name': 'start_date', 'operator': 'gte', 'number_value': value,
                'description': f'Lease term must be at least {value} month(s).',
                'severity': 'medium', 'confidence': 0.85,
            }

        m = re.search(rf'rent\b.{{0,60}}?(?:at least|minimum(?: of)?|no less than)\s+(?:qar\s*)?{self.NUM}', s)
        if m and (value := _number(m.group(1))) is not None:
            field = 'annual_rent' if 'annual' in s else 'rent_amount'
            label = 'Annual' if field == 'annual_rent' else 'Monthly'
            return {
                'proposal_type': 'custom_rule', 'template': 'number_compare',
                'field_name': field, 'operator': 'gte', 'number_value': value,
                'description': f'{label} rent must be at least {value:g}.',
                'severity': 'medium', 'confidence': 0.85,
            }

        m = re.search(rf'rent\b.{{0,60}}?(?:at most|not exceed|no more than|maximum(?: of)?)\s+(?:qar\s*)?{self.NUM}', s)
        if m and (value := _number(m.group(1))) is not None:
            field = 'annual_rent' if 'annual' in s else 'rent_amount'
            label = 'Annual' if field == 'annual_rent' else 'Monthly'
            return {
                'proposal_type': 'custom_rule', 'template': 'number_compare',
                'field_name': field, 'operator': 'lte', 'number_value': value,
                'description': f'{label} rent must be at most {value:g}.',
                'severity': 'medium', 'confidence': 0.85,
            }

        m = re.search(r'(?:frequency|payable|paid)\b.{0,40}?\b(monthly|quarterly|annually)\b', s)
        if m:
            frequency = m.group(1)
            return {
                'proposal_type': 'custom_rule', 'template': 'allowed_values',
                'field_name': 'rent_frequency', 'text_value': frequency,
                'description': f'Rent frequency must be {frequency}.',
                'severity': 'low', 'confidence': 0.85,
            }

        m = re.search(r'(?:currency|denominated|payable)\b.{0,40}?\b(qar|aed|sar|usd|eur|gbp|kwd|bhd|omr)\b', s)
        if m:
            code = m.group(1).upper()
            return {
                'proposal_type': 'custom_rule', 'template': 'allowed_values',
                'field_name': 'currency', 'text_value': code,
                'description': f'Rent must be denominated in {code}.',
                'severity': 'low', 'confidence': 0.85,
            }

        if re.search(r'escalation|rent increase', s) and re.search(r'mutually agreed|to be agreed|vague', s):
            return {
                'proposal_type': 'custom_rule', 'template': 'text_check',
                'field_name': 'escalation_clause', 'operator': 'must_not_contain',
                'text_value': 'mutually agreed, to be agreed',
                'description': 'Escalation clause must not use vague "as agreed" wording.',
                'severity': 'medium', 'confidence': 0.8,
            }

        m = re.search(rf'({self._PHRASES})\b.{{0,40}}?(?:must be present|must be stated|must be included|must appear|required|is required)', s)
        if m:
            field = self.FIELD_PHRASES[m.group(1)]
            return {
                'proposal_type': 'custom_rule', 'template': 'required_field',
                'field_name': field,
                'description': f'{m.group(1).capitalize()} must be present in the lease.',
                'severity': 'medium', 'confidence': 0.85,
            }

        m = re.search(rf'({self._PHRASES})\b.{{0,20}}?must (?:mention|include|contain|state)\s+(.{{3,60}}?)[.;]?$', s)
        if m:
            field = self.FIELD_PHRASES[m.group(1)]
            phrase = m.group(2).strip().strip('"\'')
            return {
                'proposal_type': 'custom_rule', 'template': 'text_check',
                'field_name': field, 'operator': 'must_contain', 'text_value': phrase,
                'description': f'{m.group(1).capitalize()} must mention: {phrase}.',
                'severity': 'medium', 'confidence': 0.8,
            }

        # A requirement no automated template can express: becomes a
        # manual-check rule — UNDETERMINED on every lease, verified by a human.
        return {
            'proposal_type': 'custom_rule', 'template': 'manual_check',
            'description': sentence.strip()[:400],
            'severity': 'medium', 'confidence': 0.6,
        }


class OllamaPolicyProvider:
    """Ollama-backed extraction, constrained to the same whitelists."""
    PROVIDER_NAME = 'ollama'

    PROMPT = """You read a property owner's lease acceptance policy and convert each requirement into a rule proposal.

Return ONLY a JSON object: {"proposals": [...]}. Each proposal is one of:

1. Update a built-in rule threshold:
   {"proposal_type": "rule_update", "target_rule_id": "R1|R3|R6",
    "config_changes": {"min_deposit_months"|"max_term_months"|"tolerance_pct": <number>},
    "description": "...", "severity": "low|medium|high", "source_quote": "exact sentence from the document"}
   R1 = minimum deposit in months of rent. R3 = maximum lease term in months. R6 = rent reconciliation tolerance percent.

2. A new rule from a template:
   {"proposal_type": "custom_rule", "template": "number_compare|field_compare|required_field|date_order|text_check|term_length|allowed_values",
    "field_name": "<one of: %s>",
    "operator": "gte|lte|eq|must_contain|must_not_contain", "number_value": <number or null>,
    "compare_field": "<field or empty>", "factor": <number>, "text_value": "<comma-separated values or empty>",
    "description": "...", "severity": "low|medium|high", "source_quote": "exact sentence"}

3. A requirement no template can express:
   {"proposal_type": "needs_developer", "description": "the requirement in plain words",
    "severity": "low|medium|high", "source_quote": "exact sentence"}

Rules:
- Every requirement in the document becomes exactly one proposal. Do not invent requirements.
- source_quote must be copied verbatim from the document.
- When unsure which template fits, use needs_developer. Never guess.

DOCUMENT:
""" % ', '.join(sorted(ALLOWED_FIELDS))

    def __init__(self):
        self.base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://localhost:11434')
        self.model = getattr(settings, 'OLLAMA_MODEL', 'llama3.2')

    def extract(self, text: str, pages: list[dict]) -> list[dict]:
        parsed = self._generate_json(self.PROMPT + text[:15000])
        proposals = parsed.get('proposals', [])
        if not isinstance(proposals, list):
            return []
        for p in proposals:
            if isinstance(p, dict):
                p['source_page'] = _page_of(p.get('source_quote', ''), pages)
        return [p for p in proposals if isinstance(p, dict)]

    def _generate_json(self, prompt: str) -> dict:
        """Transport: send the prompt, return the parsed JSON object.
        Subclasses override this to target a different API."""
        payload = json.dumps({
            'model': self.model,
            'prompt': prompt,
            'stream': False,
            'format': 'json',
            'options': {'temperature': 0.0},
        }).encode('utf-8')
        req = urllib.request.Request(
            f'{self.base_url}/api/generate',
            data=payload, headers={'Content-Type': 'application/json'},
        )
        try:
            # Local models on CPU can take minutes on a full policy document.
            with urllib.request.urlopen(req, timeout=300) as resp:
                response_data = json.loads(resp.read().decode('utf-8'))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ConnectionError(
                f'Ollama did not answer at {self.base_url} '
                f'(model {self.model}). Error: {exc}'
            ) from exc
        try:
            return json.loads(response_data.get('response', '{}'))
        except json.JSONDecodeError as exc:
            raise ValueError(f'Ollama returned invalid JSON: {exc}') from exc


class OpenAIPolicyProvider(OllamaPolicyProvider):
    """Policy extraction via any OpenAI-compatible API — same prompt and
    whitelist sanitization as the Ollama provider, different transport."""
    PROVIDER_NAME = 'openai'

    def __init__(self):
        self.base_url = getattr(settings, 'OPENAI_BASE_URL', '')
        self.model = getattr(settings, 'OPENAI_MODEL', '')

    def _generate_json(self, prompt: str) -> dict:
        from apps.common import openai_compat
        raw = openai_compat.chat(prompt, json_mode=True, timeout=300)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f'AI API returned invalid JSON: {exc}') from exc


def get_policy_provider():
    provider = getattr(settings, 'AI_PROVIDER', 'mock')
    if provider == 'ollama':
        return OllamaPolicyProvider()
    if provider == 'openai':
        return OpenAIPolicyProvider()
    return MockPolicyProvider()


def sanitize_proposals(raws: list[dict]) -> list[dict]:
    """Sanitize a batch of raw proposals, with recovery and de-duplication.

    Small models sometimes attach the same (or merged) rule updates to every
    sentence, or fail to map a statement that clearly fits a template. After
    splitting, any proposal that fell back to manual_check is retried against
    the deterministic pattern matcher using its source sentence — model
    weakness degrades to the regex layer, not to an unmapped rule. Identical
    actionable proposals are then collapsed.
    """
    matcher = MockPolicyProvider()
    out, seen = [], set()
    for raw in raws:
        for clean in _upgrade_if_possible(_sanitize_one(raw), matcher):
            if clean.get('template') == 'manual_check':
                key = ('manual_check', clean['description'])
            else:
                key = (
                    clean['proposal_type'], clean.get('target_rule_id', ''),
                    json.dumps(clean.get('config_changes'), sort_keys=True),
                    clean.get('template', ''), clean.get('field_name', ''),
                    clean.get('operator', ''), str(clean.get('number_value')),
                    clean.get('text_value', ''),
                )
            if key in seen:
                continue
            seen.add(key)
            out.append(clean)
    return out


def _upgrade_if_possible(cleans: list[dict], matcher: 'MockPolicyProvider') -> list[dict]:
    """Retry manual_check fallbacks against the deterministic pattern matcher."""
    upgraded = []
    for clean in cleans:
        if clean.get('template') != 'manual_check':
            upgraded.append(clean)
            continue
        sentence = clean.get('source_quote') or clean['description']
        matched = matcher._match(sentence)
        if matched and not (matched.get('template') == 'manual_check'):
            matched = {**matched,
                       'source_quote': clean.get('source_quote', ''),
                       'source_page': clean.get('source_page')}
            upgraded.extend(_sanitize_one(matched))
        else:
            upgraded.append(clean)
    return upgraded


def sanitize_proposal(raw: dict) -> dict:
    """Sanitize a single raw proposal (first result when a split occurs)."""
    return _sanitize_one(raw)[0]


def _manual_check(base: dict) -> dict:
    """The universal safe fallback: a manual-verification rule.

    Executes nothing and references nothing — a human verifies the statement
    on every lease. Demoted (malformed or non-whitelisted) proposals land
    here so the owner still sees and can enforce every statement.
    """
    return {
        **base, 'proposal_type': 'custom_rule', 'template': 'manual_check',
        'field_name': '', 'operator': '', 'compare_field': '',
        'number_value': None, 'factor': 1.0, 'text_value': '',
    }


def _sanitize_one(raw: dict) -> list[dict]:
    """Force a raw provider proposal onto the whitelist.

    Returns kwargs safe to store on RuleProposals. Anything that references
    an unknown rule, field, template, or operator is demoted to a
    manual-check rule rather than dropped — the owner still sees and can
    enforce the statement; it just needs a human to verify it per lease.
    """
    severity = raw.get('severity') if raw.get('severity') in ALLOWED_SEVERITIES else 'medium'
    base = {
        'description': str(raw.get('description', ''))[:500].strip() or 'Policy statement',
        'severity': severity,
        'confidence': _clamp(raw.get('confidence'), 0.0, 1.0, default=0.7),
        'source_quote': str(raw.get('source_quote', ''))[:2000],
        'source_page': raw.get('source_page') if isinstance(raw.get('source_page'), int) else None,
    }

    kind = raw.get('proposal_type')
    if kind == 'rule_update':
        target = str(raw.get('target_rule_id', ''))
        changes = raw.get('config_changes')
        if isinstance(changes, dict):
            allowed_keys = BUILTIN_CONFIG_KEYS.get(target)
            if allowed_keys:
                clean = {}
                for key, value in changes.items():
                    number = _coerce_number(value)
                    if key in allowed_keys and isinstance(number, (int, float)) and number > 0:
                        clean[key] = number
                if clean:
                    return [{**base, 'proposal_type': 'rule_update',
                             'target_rule_id': target, 'config_changes': clean}]
            else:
                # Malformed target — recover by routing each threshold key to
                # the single rule it belongs to, one proposal per key.
                recovered = []
                for key, value in changes.items():
                    rule_id = KEY_TO_RULE.get(key)
                    number = _coerce_number(value)
                    if rule_id and isinstance(number, (int, float)) and number > 0:
                        recovered.append({
                            **base, 'proposal_type': 'rule_update',
                            'target_rule_id': rule_id, 'config_changes': {key: number},
                            'description': f'Set {KEY_LABELS[key]} to {number:g}.',
                        })
                if recovered:
                    return recovered
        return [_manual_check(base)]

    if kind == 'custom_rule':
        template = raw.get('template')
        if template == 'manual_check':
            return [_manual_check(base)]
        field = raw.get('field_name', '')
        operator = raw.get('operator', '') or ''
        if template in ALLOWED_TEMPLATES and (field in ALLOWED_FIELDS or template == 'term_length'):
            if operator and operator not in ALLOWED_OPERATORS:
                return [_manual_check(base)]
            compare = raw.get('compare_field', '') or ''
            if compare and compare not in ALLOWED_FIELDS:
                return [_manual_check(base)]
            number = _coerce_number(raw.get('number_value')) if raw.get('number_value') is not None else None
            return [{
                **base, 'proposal_type': 'custom_rule', 'template': template,
                'field_name': field or 'start_date', 'operator': operator,
                'compare_field': compare,
                'number_value': number if isinstance(number, (int, float)) else None,
                'factor': _clamp(raw.get('factor'), 0.01, 1000, default=1.0),
                'text_value': str(raw.get('text_value', ''))[:500],
            }]
        return [_manual_check(base)]

    return [_manual_check(base)]


def import_policy_text(text: str, pages: list[dict], source_filename: str, actor: str) -> list:
    """Run the provider over policy text and store sanitized proposals."""
    from apps.validation.models import RuleProposal

    provider = get_policy_provider()
    raw_proposals = provider.extract(text, pages)

    created = []
    for clean in sanitize_proposals(raw_proposals):
        created.append(RuleProposal.objects.create(source_filename=source_filename[:255], **clean))
    return created


def validate_custom_rule_payload(proposal) -> dict:
    """Build the CustomRule kwargs from an approved custom_rule proposal."""
    return {
        'description': proposal.description,
        'template': proposal.template,
        'field_name': proposal.field_name,
        'operator': proposal.operator,
        'compare_field': proposal.compare_field,
        'number_value': proposal.number_value,
        'factor': proposal.factor or 1.0,
        'text_value': proposal.text_value,
        'severity': proposal.severity,
    }


def apply_rule_update(proposal) -> dict:
    """Apply an approved rule_update proposal to the ruleset file."""
    return ruleset_store.update_rule(
        proposal.target_rule_id,
        {'config': proposal.config_changes or {}},
    )


def _sentences(text: str, pages: list[dict]):
    """Yield (sentence, page_number) pairs. Page is best-effort via substring search."""
    for chunk in re.split(r'(?<=[.;])\s+|\n{2,}', text):
        sentence = chunk.strip()
        if len(sentence) < 15:
            continue
        yield sentence, _page_of(sentence, pages)


def _page_of(snippet: str, pages: list[dict]):
    probe = snippet[:60].lower()
    if not probe:
        return None
    for page in pages:
        if probe in page.get('text', '').lower():
            return page.get('page_number')
    return None


def _clamp(value, low, high, default):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))
