from __future__ import annotations

import html
import os
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from .config import Settings

# Varsayilan sablonlar — admin panelinden ezilebilir (/vault-data/config/admin-settings.yml)
DEFAULT_EMAIL_TEMPLATES: dict[str, Any] = {
    "layout": {
        "header_subtitle": "Kurumsal PDF islem platformu",
        "footer_html": (
            "Bu mesaj <strong>{product_name}</strong> tarafindan otomatik gonderilmistir. "
            "Guvenliginiz icin ekleri yalnizca guvenilir kaynaklardan acin."
        ),
    },
    "document": {
        "subject": "{product_name} belgeniz: {filename}",
        "preheader": "{filename} belgesi e-posta ekinde",
        "title": "Belgeniz hazir",
        "intro_html": (
            '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">'
            "{product_name} arsivinizdeki PDF belgesi bu e-postaya eklenmistir."
            "</p>"
        ),
        "closing_html": (
            '<p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">'
            "Ekteki PDF dosyasini indirip acabilirsiniz. "
            "Bu e-posta yalnizca hesabiniza kayitli adrese gonderilmistir."
            "</p>"
        ),
        "plain_body": (
            "Merhaba,\n\n"
            "{product_name} arsivinizdeki \"{filename}\" belgesi bu e-postaya eklenmistir.\n\n"
            "Kullanici: {user_id}\n"
            "Bu e-posta yalnizca size gonderilmistir.\n\n"
            "— {product_name}\n"
        ),
    },
    "smtp_test": {
        "subject": "{product_name} — SMTP test",
        "preheader": "SMTP baglanti testi basarili",
        "title": "SMTP testi basarili",
        "intro_html": (
            '<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">'
            "{product_name} e-posta ayarlari dogru yapilandirilmis gorunuyor."
            "</p>"
        ),
        "success_html": (
            '<p style="margin:0;padding:14px 16px;background:#ecfdf5;border:1px solid #6ee7b7;'
            'border-radius:10px;font-size:14px;color:#065f46;">'
            "Baglanti testi tamamlandi — {timestamp}"
            "</p>"
        ),
        "closing_html": (
            '<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#475569;">'
            "Bu mesaj yonetici panelindeki &quot;Baglanti testi&quot; ile gonderilmistir."
            "</p>"
        ),
        "plain_body": (
            "Merhaba,\n\n"
            "{product_name} SMTP baglanti testi basarili.\n"
            "Test zamani: {timestamp}\n\n"
            "Bu mesaj yonetici panelinden gonderilmistir.\n"
        ),
    },
}

PLACEHOLDER_HINT = "{product_name}, {filename}, {user_id}, {timestamp}"


def merge_email_templates(override: dict[str, Any] | None = None) -> dict[str, Any]:
    if not override:
        return deepcopy(DEFAULT_EMAIL_TEMPLATES)
    return _deep_merge(deepcopy(DEFAULT_EMAIL_TEMPLATES), override)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_email_templates(settings: Settings | None = None) -> dict[str, Any]:
    if settings is None:
        return deepcopy(DEFAULT_EMAIL_TEMPLATES)
    from .settings_store import SettingsStore

    store = SettingsStore(settings)
    return store.merged_email_templates()


def product_name(settings: Settings | None = None) -> str:
    if settings is not None:
        from .settings_store import SettingsStore

        brand = SettingsStore(settings).merged_branding()
        name = brand.get("app_name")
        if name:
            return str(name)
    return os.getenv("UI_APPNAME", "SecuriPDF")


def _substitute(template: str, ctx: dict[str, str], *, escape_html_values: bool) -> str:
    result = template
    for key, value in ctx.items():
        token = "{" + key + "}"
        safe = html.escape(value) if escape_html_values else value
        result = result.replace(token, safe)
    return result


def _base_context(settings: Settings | None) -> dict[str, str]:
    return {
        "product_name": product_name(settings),
        "timestamp": datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC"),
    }


def _layout(*, title: str, preheader: str, body_html: str, templates: dict[str, Any], settings: Settings | None) -> str:
    layout = templates.get("layout", {})
    brand = html.escape(product_name(settings))
    pre = html.escape(preheader)
    subtitle = _substitute(
        str(layout.get("header_subtitle", "")),
        _base_context(settings),
        escape_html_values=True,
    )
    footer_inner = _substitute(
        str(layout.get("footer_html", "")),
        _base_context(settings),
        escape_html_values=False,
    )
    return f"""<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>{html.escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{pre}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #cbd5e1;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">{brand}</p>
              <p style="margin:8px 0 0;font-size:14px;color:#cbd5e1;">{subtitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              {body_html}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">{footer_inner}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def document_email_subject(*, filename: str, user_id: str, settings: Settings | None = None) -> str:
    templates = load_email_templates(settings)
    doc = templates.get("document", {})
    ctx = {**_base_context(settings), "filename": filename, "user_id": user_id}
    return _substitute(str(doc.get("subject", "")), ctx, escape_html_values=False)


def document_email_plain(*, filename: str, user_id: str, settings: Settings | None = None) -> str:
    templates = load_email_templates(settings)
    doc = templates.get("document", {})
    ctx = {**_base_context(settings), "filename": filename, "user_id": user_id}
    return _substitute(str(doc.get("plain_body", "")), ctx, escape_html_values=False)


def document_email_html(*, filename: str, user_id: str, settings: Settings | None = None) -> str:
    templates = load_email_templates(settings)
    doc = templates.get("document", {})
    ctx = {**_base_context(settings), "filename": filename, "user_id": user_id}
    safe_name = html.escape(filename)
    safe_user = html.escape(user_id)
    title = html.escape(_substitute(str(doc.get("title", "")), ctx, escape_html_values=False))
    intro = _substitute(str(doc.get("intro_html", "")), ctx, escape_html_values=False)
    closing = _substitute(str(doc.get("closing_html", "")), ctx, escape_html_values=False)
    body = f"""
      <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0f172a;">{title}</h1>
      {intro}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
        <tr>
          <td style="padding:16px 18px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Dosya</p>
            <p style="margin:0;font-size:16px;font-weight:600;color:#0f172a;word-break:break-word;">{safe_name}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 18px 16px;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Kullanici</p>
            <p style="margin:0;font-size:14px;color:#334155;">{safe_user}</p>
          </td>
        </tr>
      </table>
      {closing}
    """
    preheader = _substitute(str(doc.get("preheader", "")), ctx, escape_html_values=False)
    page_title = _substitute(str(doc.get("subject", "")), ctx, escape_html_values=False)
    return _layout(title=page_title, preheader=preheader, body_html=body, templates=templates, settings=settings)


def smtp_test_subject(settings: Settings | None = None) -> str:
    templates = load_email_templates(settings)
    test = templates.get("smtp_test", {})
    return _substitute(str(test.get("subject", "")), _base_context(settings), escape_html_values=False)


def smtp_test_plain(settings: Settings | None = None) -> str:
    templates = load_email_templates(settings)
    test = templates.get("smtp_test", {})
    return _substitute(str(test.get("plain_body", "")), _base_context(settings), escape_html_values=False)


def smtp_test_html(settings: Settings | None = None) -> str:
    templates = load_email_templates(settings)
    test = templates.get("smtp_test", {})
    ctx = _base_context(settings)
    title = html.escape(_substitute(str(test.get("title", "")), ctx, escape_html_values=False))
    intro = _substitute(str(test.get("intro_html", "")), ctx, escape_html_values=False)
    success = _substitute(str(test.get("success_html", "")), ctx, escape_html_values=False)
    closing = _substitute(str(test.get("closing_html", "")), ctx, escape_html_values=False)
    body = f"""
      <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0f172a;">{title}</h1>
      {intro}
      {success}
      {closing}
    """
    preheader = _substitute(str(test.get("preheader", "")), ctx, escape_html_values=False)
    page_title = _substitute(str(test.get("subject", "")), ctx, escape_html_values=False)
    return _layout(title=page_title, preheader=preheader, body_html=body, templates=templates, settings=settings)
