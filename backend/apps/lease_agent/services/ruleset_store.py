"""Read and update the owner's ruleset file (sample_data/owner_ruleset.json).

The JSON file is the single source of truth for what the rules say; the
evaluation logic lives in ValidationEngine. Updates are limited to the
owner-editable attributes (description, severity, enabled, config values)
so a portal edit can never inject executable logic.
"""
import json
import os
import tempfile
from pathlib import Path

from django.conf import settings

ALLOWED_SEVERITIES = ('low', 'medium', 'high')
# Only numeric thresholds already present in a rule's config may be changed.
EDITABLE_FIELDS = ('description', 'severity', 'enabled', 'config')


class RulesetError(ValueError):
    pass


def _ruleset_path() -> Path:
    return Path(settings.SAMPLE_DATA_DIR) / 'owner_ruleset.json'


def load_ruleset() -> dict:
    with open(_ruleset_path(), encoding='utf-8') as f:
        return json.load(f)


def update_rule(rule_id: str, changes: dict) -> dict:
    """Apply validated changes to one rule and write the file atomically.

    Returns the updated rule dict.
    """
    data = load_ruleset()
    rule = next((r for r in data.get('rules', []) if r.get('id') == rule_id), None)
    if rule is None:
        raise RulesetError(f'Rule "{rule_id}" does not exist.')

    unknown = set(changes) - set(EDITABLE_FIELDS)
    if unknown:
        raise RulesetError(f'Fields not editable: {", ".join(sorted(unknown))}.')

    _apply_changes(rule, changes)
    _write_atomic(data)
    return rule


def import_ruleset(uploaded: dict) -> dict:
    """Apply an uploaded ruleset JSON to the owner's rules — data only, never logic.

    For each rule in the upload whose id matches a built-in rule, the editable
    attributes (description, severity, enabled, known config thresholds) are
    applied. Rules with unknown ids are reported back, not silently dropped
    and never executed. Returns {'applied': [...], 'skipped': [{'id','reason'}]}.
    """
    if not isinstance(uploaded, dict) or not isinstance(uploaded.get('rules'), list):
        raise RulesetError('The file must be a JSON object with a "rules" list.')

    data = load_ruleset()
    existing = {r.get('id'): r for r in data.get('rules', [])}
    applied, skipped = [], []

    for incoming in uploaded['rules']:
        if not isinstance(incoming, dict) or not incoming.get('id'):
            skipped.append({'id': '?', 'reason': 'Rule entry is missing an "id".'})
            continue
        rule_id = str(incoming['id'])
        rule = existing.get(rule_id)
        if rule is None:
            skipped.append({
                'id': rule_id,
                'reason': 'Not a built-in rule. Add it as a custom rule from a template, '
                          'or import it from a policy document for review.',
            })
            continue
        try:
            _apply_changes(rule, incoming)
        except RulesetError as exc:
            skipped.append({'id': rule_id, 'reason': str(exc)})
            continue
        applied.append(rule_id)

    if applied:
        _write_atomic(data)
    return {'applied': applied, 'skipped': skipped}


def _apply_changes(rule: dict, incoming: dict) -> None:
    """Validate and apply the editable attributes of one incoming rule in place."""
    if 'severity' in incoming:
        if incoming['severity'] not in ALLOWED_SEVERITIES:
            raise RulesetError('severity must be one of: low, medium, high.')
        rule['severity'] = incoming['severity']
    if 'enabled' in incoming:
        if not isinstance(incoming['enabled'], bool):
            raise RulesetError('enabled must be true or false.')
        rule['enabled'] = incoming['enabled']
    if 'description' in incoming:
        description = str(incoming['description']).strip()
        if not description:
            raise RulesetError('description cannot be empty.')
        rule['description'] = description[:500]
    if 'config' in incoming:
        if not isinstance(incoming['config'], dict):
            raise RulesetError('config must be an object.')
        current = rule.get('config') or {}
        for key, value in incoming['config'].items():
            if key not in current:
                raise RulesetError(f'"{key}" is not a configurable value for {rule["id"]}.')
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise RulesetError(f'"{key}" must be a number.')
            if number <= 0:
                raise RulesetError(f'"{key}" must be greater than zero.')
            current[key] = int(number) if number.is_integer() else number
        rule['config'] = current


def _write_atomic(data: dict) -> None:
    path = _ruleset_path()
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
