from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings
from .settings_store import SettingsStore
from .updater_client import updater_configured, updater_health

_APP_ROOT = Path(__file__).resolve().parent
_STAGING_REL = Path("upgrades/staging/manifest.json")


def _read_platform_ui_version() -> int | None:
    index_path = _APP_ROOT / "static/app/index.html"
    if not index_path.exists():
        return None
    match = re.search(r"app\.js\?v=(\d+)", index_path.read_text(encoding="utf-8"))
    return int(match.group(1)) if match else None


def _read_bundled_release() -> dict[str, Any] | None:
    for name in ("RELEASE.json", "VERSION"):
        path = Path("/app") / name
        if not path.exists():
            continue
        if name.endswith(".json"):
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return None
        text = path.read_text(encoding="utf-8").strip()
        if text:
            return {"version": text}
    return None


def _parse_version_parts(version: str) -> tuple[tuple[int, ...], str | None]:
    main = version.strip()
    stirling: str | None = None
    if "-stirling-" in main:
        main, stirling = main.split("-stirling-", 1)
    parts: tuple[int, ...] = tuple()
    try:
        parts = tuple(int(p) for p in main.split(".") if p.isdigit())
    except ValueError:
        parts = tuple()
    return parts, stirling


def version_key(version: str) -> tuple[tuple[int, ...], str | None]:
    return _parse_version_parts(version)


def version_newer(left: str, right: str) -> bool:
    return version_key(left) > version_key(right)


def upgrade_compatible(installed: str, manifest: dict[str, Any]) -> bool:
    target = str(manifest.get("version") or "").strip()
    if not target or target == installed:
        return False
    allowed = manifest.get("upgrade_from") or []
    if allowed and installed not in allowed:
        return False
    min_from = str(manifest.get("min_upgrade_from") or "").strip()
    if min_from:
        if version_key(installed) < version_key(min_from):
            return False
    return version_newer(target, installed) or (bool(allowed) and target != installed)


def _staging_path(settings: Settings) -> Path:
    return settings.data_path / _STAGING_REL


def load_staging_manifest(settings: Settings) -> dict[str, Any] | None:
    path = _staging_path(settings)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def save_staging_manifest(settings: Settings, manifest: dict[str, Any]) -> Path:
    if not manifest.get("version"):
        raise ValueError("manifest.version zorunlu")
    if manifest.get("product") and manifest["product"] != "SecuriPDF":
        raise ValueError("manifest.product SecuriPDF olmali")
    path = _staging_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def get_installed_version(settings: Settings) -> dict[str, Any]:
    store = SettingsStore(settings)
    deployment = store.merged_deployment()
    bundled = _read_bundled_release() or {}

    image_tag = (
        os.getenv("IMAGE_TAG")
        or os.getenv("SECURIPDF_VERSION")
        or bundled.get("version")
        or "unknown"
    )
    stirling = os.getenv("STIRLING_VERSION") or bundled.get("stirling_version") or "unknown"
    ui_version = _read_platform_ui_version()

    return {
        "product": "SecuriPDF",
        "version": image_tag,
        "stirlingVersion": stirling,
        "platformUiVersion": ui_version,
        "platformImage": f"securipdf-platform:{image_tag}",
        "stirlingImage": f"entera-pdf:{image_tag}",
        "oauth2ProxyImage": os.getenv("OAUTH2_PROXY_IMAGE", "quay.io/oauth2-proxy/oauth2-proxy:v7.8.2"),
        "keycloakImage": os.getenv("KEYCLOAK_IMAGE", "quay.io/keycloak/keycloak:26.0"),
        "builtAt": bundled.get("built_at"),
        "access": {
            "publicFqdn": deployment.get("public_fqdn") or os.getenv("PUBLIC_FQDN", ""),
            "serverIp": deployment.get("server_ip") or os.getenv("PUBLIC_SERVER_IP", ""),
            "environment": deployment.get("environment", "dev"),
            "appUrl": (deployment.get("access_urls") or {}).get("app_url", ""),
        },
        "reportedAt": datetime.now(timezone.utc).isoformat(),
    }


def get_upgrade_available(settings: Settings) -> dict[str, Any]:
    installed = get_installed_version(settings)
    current = installed["version"]
    staging = load_staging_manifest(settings)

    cli_upgrade = (
        "cd ~/securipdf-*-offline && sudo bash scripts/upgrade-offline-stack.sh"
    )
    staging_register = (
        "docker cp MANIFEST.json securipdf-platform:/vault-data/upgrades/staging/manifest.json"
    )

    if not staging:
        return {
            "available": False,
            "installedVersion": current,
            "stagingVersion": None,
            "compatible": False,
            "reason": "Staging paket manifesti yok",
            "stagingPath": str(_staging_path(settings)),
            "registerHint": staging_register,
            "cliUpgrade": cli_upgrade,
            "webUpgradePlanned": updater_configured(),
            "webUpgradeAvailable": False,
            "updater": updater_health(),
        }

    target = str(staging.get("version") or "")
    compatible = upgrade_compatible(current, staging) if target else False
    available = compatible and target != current

    reason = "Guncelleme hazir"
    if not target:
        reason = "Staging manifest gecersiz (version yok)"
    elif target == current:
        reason = "Staging surumu kurulu surumle ayni"
    elif not compatible:
        reason = "Staging paketi bu surumden yukseltmeyi desteklemiyor"

    updater = updater_health()
    web_ready = (
        available
        and updater.get("reachable") is True
        and (updater.get("status") or {}).get("imagesTarExists") is True
    )

    return {
        "available": available,
        "webUpgradeAvailable": web_ready,
        "updater": updater,
        "installedVersion": current,
        "stagingVersion": target or None,
        "compatible": compatible,
        "reason": reason,
        "staging": {
            "version": target,
            "stirlingVersion": staging.get("stirling_version"),
            "builtAt": staging.get("built_at"),
            "changelog": staging.get("changelog"),
            "minUpgradeFrom": staging.get("min_upgrade_from"),
            "upgradeFrom": staging.get("upgrade_from"),
            "platformUiVersion": staging.get("platform_ui"),
            "oauth2Proxy": staging.get("oauth2_proxy"),
            "path": str(_staging_path(settings)),
        },
        "registerHint": staging_register,
        "cliUpgrade": cli_upgrade,
        "webUpgradePlanned": updater_configured(),
    }
