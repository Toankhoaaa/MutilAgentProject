from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from backend.models.email_rule import EmailRule

logger = logging.getLogger(__name__)


@dataclass
class RuleMatch:
    rule: EmailRule
    action: str
    action_value: str | None


_FIELD_KEYS: dict[str, list[str]] = {
    "sender": ["sender", "from"],
    "subject": ["subject"],
    "body": ["body", "snippet"],
    "sender_domain": ["sender", "from"],
}


class RuleEngine:
    def evaluate(self, email_dict: dict, rules: list[EmailRule]) -> RuleMatch | None:
        active = sorted(
            (r for r in rules if r.is_active),
            key=lambda r: r.priority,
        )
        for rule in active:
            if self._matches(email_dict, rule):
                rule.match_count += 1
                return RuleMatch(
                    rule=rule,
                    action=rule.action,
                    action_value=rule.action_value,
                )
        return None

    def _matches(self, email_dict: dict, rule: EmailRule) -> bool:
        field_value = self._extract_field(email_dict, rule.field)
        if field_value is None:
            return False

        if rule.field == "sender_domain":
            at = field_value.rfind("@")
            field_value = field_value[at + 1:] if at != -1 else field_value

        return self._apply_operator(field_value, rule.operator, rule.value)

    def _extract_field(self, email_dict: dict, field: str) -> str | None:
        for key in _FIELD_KEYS.get(field, [field]):
            val = email_dict.get(key)
            if val is not None:
                return str(val)
        return None

    def _apply_operator(self, field_value: str, operator: str, pattern: str) -> bool:
        fv = field_value.lower()
        pv = pattern.lower()

        if operator == "contains":
            return pv in fv
        if operator == "not_contains":
            return pv not in fv
        if operator == "equals":
            return fv == pv
        if operator == "starts_with":
            return fv.startswith(pv)
        if operator == "ends_with":
            return fv.endswith(pv)
        if operator == "regex":
            try:
                return bool(re.search(pattern, field_value, re.IGNORECASE))
            except re.error as exc:
                logger.warning("Invalid regex pattern %r in rule: %s", pattern, exc)
                return False

        logger.warning("Unknown operator %r — rule skipped", operator)
        return False
