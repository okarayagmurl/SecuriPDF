#!/usr/bin/env python3
"""tools.yml whitelist'inden settings.yml ve custom_settings.yml endpoints listesini üretir."""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
TOOLS_FILE = ROOT / "config" / "tools.yml"
SETTINGS_FILE = ROOT / "config" / "settings.yml"
CUSTOM_SETTINGS_FILE = ROOT / "config" / "custom_settings.yml"
ENV_FILE = ROOT / "docker" / ".env"

ALL_ENDPOINTS = [
    "add-attachments", "add-image", "add-page-numbers", "add-password", "add-stamp",
    "add-watermark", "adjust-contrast", "auto-redact", "auto-rename", "auto-split-pdf",
    "automate", "booklet-imposition", "cert-sign", "change-permissions", "compare",
    "compress-pdf", "crop", "dev-airgapped-docs", "dev-api-docs", "dev-folder-scanning-docs",
    "dev-sso-guide-docs", "edit-table-of-contents", "eml-to-pdf", "extract-image-scans",
    "extract-images", "extract-pages", "file-to-pdf", "flatten", "get-info-on-pdf",
    "handleData", "html-to-pdf", "img-to-pdf", "markdown-to-pdf", "merge-pdfs",
    "multi-page-layout", "multi-tool", "ocr-pdf", "overlay-pdf", "pdf-to-csv",
    "pdf-to-epub", "pdf-to-html", "pdf-to-img", "pdf-to-json", "pdf-to-markdown",
    "pdf-to-pdfa", "pdf-to-presentation", "pdf-to-rtf", "pdf-to-single-page",
    "pdf-to-text", "pdf-to-vector", "pdf-to-video", "pdf-to-word", "pdf-to-xml",
    "pipeline", "rearrange-pages", "redact", "remove-annotations", "remove-blanks",
    "remove-cert-sign", "remove-image-pdf", "remove-pages", "remove-password", "repair",
    "rotate-pdf", "sanitize-pdf", "scale-pages", "sign", "split-by-size-or-count",
    "split-pages", "split-pdf-by-chapters", "split-pdf-by-sections", "text-editor-pdf",
    "unlock-pdf-forms", "update-metadata", "url-to-pdf", "validate-signature",
    "verify-pdf", "view-pdf", "show-javascript", "fields", "fill", "modify-fields",
    "delete-fields", "cbz-to-pdf", "json-to-pdf", "vector-to-pdf", "pdf-to-cbz",
    "pdf-to-cbr", "replace-invert-pdf", "scanner-effect",
]


def parse_tools() -> tuple[list[str], bool]:
    enabled: list[str] = []
    hide_unavailable = True
    in_enabled = False

    for line in TOOLS_FILE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("enabled:"):
            in_enabled = True
            continue
        if in_enabled:
            if stripped and not stripped.startswith("-") and ":" in stripped:
                in_enabled = False
            elif stripped.startswith("- "):
                item = stripped[2:].split("#", 1)[0].strip()
                if item:
                    enabled.append(item)
        if "hide_unavailable_tools:" in stripped:
            hide_unavailable = stripped.split(":", 1)[1].strip().lower() in ("true", "yes", "1")

    return enabled, hide_unavailable


def update_custom_settings(to_remove: list[str], hide_unavailable: bool) -> None:
    if yaml is None:
        print("Uyari: PyYAML yok; custom_settings.yml elle guncellenmeli", file=sys.stderr)
        return
    data: dict = {}
    if CUSTOM_SETTINGS_FILE.exists():
        data = yaml.safe_load(CUSTOM_SETTINGS_FILE.read_text(encoding="utf-8")) or {}
    ui = data.setdefault("ui", {})
    ui["defaultHideUnavailableTools"] = hide_unavailable
    data["endpoints"] = {"toRemove": to_remove, "groupsToRemove": []}
    CUSTOM_SETTINGS_FILE.write_text(
        yaml.safe_dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False),
        encoding="utf-8",
    )
    print(f"Güncellendi: {CUSTOM_SETTINGS_FILE}")


def main() -> int:
    if not TOOLS_FILE.exists():
        print(f"Hata: {TOOLS_FILE} bulunamadı.", file=sys.stderr)
        return 1

    enabled, hide_unavailable = parse_tools()
    if not enabled:
        print("Hata: tools.yml içinde enabled araç bulunamadı.", file=sys.stderr)
        return 1

    to_remove = sorted(e for e in ALL_ENDPOINTS if e not in enabled)
    content = SETTINGS_FILE.read_text(encoding="utf-8")

    to_remove_yaml = "\n".join(f"    - {e}" for e in to_remove)
    new_endpoints = f"endpoints:\n  toRemove:\n{to_remove_yaml}\n  groupsToRemove: []"

    content = re.sub(
        r"endpoints:\s*\n(?:  .*\n)*",
        new_endpoints + "\n",
        content,
        count=1,
    )
    content = re.sub(
        r"(defaultHideUnavailableTools:\s*)(true|false)",
        rf"\g<1>{str(hide_unavailable).lower()}",
        content,
        count=1,
    )

    SETTINGS_FILE.write_text(content, encoding="utf-8")
    update_custom_settings(to_remove, hide_unavailable)

    # Docker env: ENDPOINTS_TOREMOVE (yedek; asil kaynak custom_settings.yml)
    endpoints_csv = ",".join(to_remove)
    if ENV_FILE.exists():
        env_content = ENV_FILE.read_text(encoding="utf-8")
        if re.search(r"^ENDPOINTS_TOREMOVE=", env_content, re.MULTILINE):
            env_content = re.sub(
                r"^ENDPOINTS_TOREMOVE=.*$",
                f"ENDPOINTS_TOREMOVE={endpoints_csv}",
                env_content,
                count=1,
                flags=re.MULTILINE,
            )
        else:
            env_content = env_content.rstrip() + f"\n\nENDPOINTS_TOREMOVE={endpoints_csv}\n"
        ENV_FILE.write_text(env_content, encoding="utf-8")
        print(f"Güncellendi: {ENV_FILE} (ENDPOINTS_TOREMOVE)")

    print(f"Güncellendi: {SETTINGS_FILE}")
    print(f"  Aktif: {len(enabled)} | Devre dışı: {len(to_remove)}")
    print("Aktif araçlar:")
    for e in enabled:
        print(f"  - {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
