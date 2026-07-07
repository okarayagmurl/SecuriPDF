from __future__ import annotations

import json
import re

# KVKK: admin ve merkezi loglarda belge adi / e-posta gibi PII tutulmaz.
_SENSITIVE_KEYS = frozenset({
    "name",
    "filename",
    "documentName",
    "label",
    "to",
    "subject",
    "password",
    "bind_password",
})


def sanitize_audit_detail(detail: dict | None) -> dict:
    if not detail:
        return {}
    out: dict = {}
    for key, value in detail.items():
        if key in _SENSITIVE_KEYS:
            continue
        if key.endswith("Ref") or key.endswith("Refs") or key in ("toolId", "scope", "size", "inputCount", "errorCode", "outputRef", "reportId"):
            out[key] = value
        elif isinstance(value, (int, float, bool)):
            out[key] = value
        elif isinstance(value, list) and all(isinstance(x, str) for x in value):
            if key.endswith("Refs") or key == "fields":
                out[key] = value
    return out


def sanitize_audit_entry(entry: dict) -> dict:
    safe = dict(entry)
    detail = entry.get("detail")
    if isinstance(detail, dict):
        safe["detail"] = sanitize_audit_detail(detail)
    resource = entry.get("resource")
    if isinstance(resource, str) and not _is_safe_resource_id(resource):
        safe["resource"] = _hash_resource_token(resource)
    return safe


def _is_safe_resource_id(value: str) -> bool:
    if re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", value, re.I):
        return True
    return bool(re.match(r"^(doc|job|fld|sig|cert|ref)_[a-f0-9]+$", value))


def _hash_resource_token(value: str) -> str:
    import hashlib

    return "tok_" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
