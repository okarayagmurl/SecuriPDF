from __future__ import annotations

import base64
import json
import os
import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from .config import Settings, get_settings
from .crypto_util import decrypt_bytes as _decrypt_bytes
from .crypto_util import encrypt_bytes as _encrypt_bytes


@dataclass
class AuthUser:
    user_id: str
    email: str | None
    groups: list[str]
    is_admin: bool


def _parse_groups(raw: str | None) -> list[str]:
    if not raw:
        return []
    text = raw.strip()
    if text.startswith("["):
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [str(item).strip() for item in data if str(item).strip()]
        except json.JSONDecodeError:
            pass
    return [part.strip() for part in text.replace(",", " ").split() if part.strip()]


def _header_first(request: Request, *names: str) -> str | None:
    for name in names:
        value = request.headers.get(name)
        if value:
            return value
    return None


def _decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    pad = "=" * (-len(payload) % 4)
    decoded = base64.urlsafe_b64decode(payload + pad)
    return json.loads(decoded)


def _access_token(request: Request) -> str | None:
    token = _header_first(
        request,
        "X-Forwarded-Access-Token",
        "X-Auth-Request-Access-Token",
    )
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _claims_from_access_token(request: Request) -> dict:
    token = _access_token(request)
    if not token:
        return {}
    try:
        return _decode_jwt_payload(token)
    except (json.JSONDecodeError, ValueError, TypeError):
        return {}


def _email_from_claims(claims: dict) -> str | None:
    for key in ("email", "upn", "preferred_username"):
        raw = claims.get(key)
        if not raw:
            continue
        value = str(raw).strip()
        if "@" in value:
            return value
    return None


def _resolve_user_email(request: Request, settings: Settings) -> str | None:
    header_email = _header_first(
        request,
        settings.email_header,
        "X-Forwarded-Email",
        "X-Auth-Request-Email",
    )
    if header_email and "@" in header_email.strip():
        return header_email.strip()

    claims = _claims_from_access_token(request)
    token_email = _email_from_claims(claims)
    if token_email:
        return token_email

    if header_email and header_email.strip():
        return header_email.strip()
    return None


def _roles_from_access_token(request: Request) -> list[str]:
    claims = _claims_from_access_token(request)
    if not claims:
        return []

    roles: list[str] = []
    top = claims.get("roles")
    if isinstance(top, list):
        roles.extend(str(item) for item in top)
    elif isinstance(top, str) and top:
        roles.append(top)

    realm = claims.get("realm_access")
    if isinstance(realm, dict):
        realm_roles = realm.get("roles")
        if isinstance(realm_roles, list):
            roles.extend(str(item) for item in realm_roles)

    return roles


def _normalize_role(name: str) -> str:
    return name.removeprefix("role:").strip()


def _collect_groups(request: Request, settings: Settings) -> list[str]:
    header_groups = _parse_groups(
        _header_first(
            request,
            settings.groups_header,
            "X-Forwarded-Groups",
            "X-Auth-Request-Groups",
        )
    )
    token_roles = _roles_from_access_token(request)

    seen: set[str] = set()
    merged: list[str] = []
    for item in header_groups + token_roles:
        norm = _normalize_role(item)
        if norm and norm not in seen:
            seen.add(norm)
            merged.append(norm)
    return merged


def get_current_user(request: Request, settings: Settings = Depends(get_settings)) -> AuthUser:  # noqa: F821
    user_id = _header_first(
        request,
        settings.user_header,
        "X-Forwarded-User",
        "X-Auth-Request-User",
    )
    if not user_id:
        if os.getenv("PLATFORM_DEV_AUTH", "false").lower() == "true":
            return AuthUser(
                user_id="dev-user",
                email="dev@local",
                groups=[settings.user_role, settings.admin_role],
                is_admin=True,
            )
        raise HTTPException(status_code=401, detail="Oturum bulunamadi")

    groups = _collect_groups(request, settings)
    is_admin = settings.admin_role in groups
    return AuthUser(
        user_id=user_id,
        email=_resolve_user_email(request, settings),
        groups=groups,
        is_admin=is_admin,
    )


def require_admin(user: AuthUser) -> None:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin yetkisi gerekli")


def encrypt_bytes(settings: Settings, plaintext: bytes) -> bytes:
    return _encrypt_bytes(settings.master_key, plaintext)


def decrypt_bytes(settings: Settings, payload: bytes) -> bytes:
    return _decrypt_bytes(settings.master_key, payload)


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"
