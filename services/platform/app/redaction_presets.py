"""Hassas veri (PII) karartma desenleri — Türkiye odaklı hazır regex preset'leri."""

from __future__ import annotations

import re
from typing import Any

CATEGORY_LABELS: dict[str, str] = {
    "identity": "Kimlik",
    "contact": "İletişim",
    "financial": "Finans",
    "location": "Adres",
    "custom": "Özel",
}

# Platform içi karartma (Stirling auto-redact kullanılmaz)
REDACTION_PRESETS: list[dict[str, Any]] = [
    {
        "id": "tckn",
        "title": "T.C. Kimlik No",
        "description": "11 haneli kimlik numarası (ilk hane 0 olamaz)",
        "category": "identity",
        "regex": r"\b[1-9][0-9]{10}\b",
        "example": "12345678901",
    },
    {
        "id": "vkn",
        "title": "Vergi Kimlik No (VKN)",
        "description": "10 haneli vergi kimlik numarası",
        "category": "identity",
        "regex": r"\b[0-9]{10}\b",
        "example": "1234567890",
    },
    {
        "id": "mobile_tr",
        "title": "Cep Telefonu",
        "description": "05xx, 905xx ve +90 formatları (satır kırıklarında da)",
        "category": "contact",
        "regex": (
            r"(?:\+?90[\s.-]?|0)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}"
            r"|\+?90[\s.-]?5\d{9}"
            r"|\b90[\s.-]?5\d{9}\b"
        ),
        "example": "0532 123 45 67",
    },
    {
        "id": "phone_tr",
        "title": "Telefon (sabit/cep)",
        "description": "Türkiye alan kodlu telefon; 90 (312) 4736570, TEL/FAX satırları dahil",
        "category": "contact",
        "regex": (
            r"(?:\+?90[\s.-]?|0)?[\s.-]*\(?"
            r"(?:2\d{2}|3\d{2}|4\d{2}|5\d{2})"
            r"\)?[\s.-]*"
            r"(?:\d{7}|\d{3}[\s.-]?\d{2}[\s.-]?\d{2})"
            r"|\+?90[\s.-]?[2345]\d{9}"
            r"|\b90[\s.-]?\(?[2345]\d{2}\)?[\s.-]*\d{7}\b"
        ),
        "example": "90 (312) 4736570",
    },
    {
        "id": "email",
        "title": "E-posta",
        "description": "E-posta adresleri (satır sonu kırılmalarında)",
        "category": "contact",
        "regex": r"[a-zA-Z0-9][a-zA-Z0-9._%+\-]{0,63}@[a-zA-Z0-9][a-zA-Z0-9.\-]{0,62}\.[a-zA-Z]{2,}",
        "example": "ornek@kurum.com",
    },
    {
        "id": "passport",
        "title": "Pasaport No",
        "description": "Harf + rakam pasaport numaraları",
        "category": "identity",
        "regex": r"\b[A-Z]{1,2}[0-9]{6,9}\b",
        "example": "U12345678",
    },
    {
        "id": "iban_tr",
        "title": "IBAN (TR)",
        "description": "Türkiye IBAN formatı",
        "category": "financial",
        "regex": r"TR\d{2}[\s]?(?:\d{4}[\s]?){5}\d{2}",
        "example": "TR33 0006 1005 1978 6457 8413 26",
    },
    {
        "id": "credit_card",
        "title": "Banka / Kredi Kartı",
        "description": "13–19 haneli kart numaraları (boşluk veya tire ile)",
        "category": "financial",
        "regex": r"\b(?:\d{4}[\s\-]?){3}\d{4,7}\b",
        "example": "4508 0345 0345 0345",
    },
    {
        "id": "postal_code_tr",
        "title": "Posta Kodu",
        "description": "5 haneli Türkiye posta kodu",
        "category": "location",
        "regex": r"\b[0-9]{5}\b",
        "example": "34000",
    },
    {
        "id": "address_tr",
        "title": "Adres",
        "description": "Mahalle, sokak/cadde, kapı no ve il/ilçe (TR formatı)",
        "category": "location",
        "regex": (
            r"(?i)"
            r"[\wÇĞİÖŞÜçğıöşü''\-\.]+\s+"
            r"(?:mah\.?|mahallesi?|mh\.?)\s+"
            r".{5,200}?"
            r"(?:sk\.?|sok\.?|sokak|cad\.?|cadde|cd\.?|bulvar|blv\.?|site(?:si)?|sit\.?)"
            r".{0,140}?"
            r"(?:no\.?\s*:?\s*\d+)"
            r".{0,120}?"
            r"[A-ZÇĞİÖŞÜ][A-Za-zçğıöşü''\-]+"
            r"(?:\s*/\s*[A-ZÇĞİÖŞÜ][A-Za-zçğıöşü''\-]+)?"
        ),
        "example": "Hidayet Mah. Günay Sk. No: 12 Malatya",
    },
]

_PRESET_BY_ID: dict[str, dict[str, Any]] = {p["id"]: p for p in REDACTION_PRESETS}


def list_redaction_presets() -> list[dict[str, Any]]:
    return [
        {
            "id": p["id"],
            "title": p["title"],
            "description": p.get("description", ""),
            "category": p["category"],
            "categoryLabel": CATEGORY_LABELS.get(p["category"], p["category"]),
            "example": p.get("example", ""),
        }
        for p in REDACTION_PRESETS
    ]


def _validate_custom_regex(pattern: str) -> str:
    raw = pattern.strip()
    if not raw:
        return ""
    try:
        re.compile(raw)
    except re.error as exc:
        raise ValueError(f"Geçersiz regex: {exc}") from exc
    return raw


def expand_redaction_patterns(pattern_ids: list[str], custom_regex: str = "") -> list[str]:
    """Seçilen preset ID'lerini ve özel regex'i karartma regex listesine çevirir."""
    return [rule["regex"] for rule in resolve_redaction_rules(pattern_ids, custom_regex)]


def resolve_redaction_rules(pattern_ids: list[str], custom_regex: str = "") -> list[dict[str, str]]:
    rules: list[dict[str, str]] = []
    seen: set[str] = set()
    for pid in pattern_ids:
        preset = _PRESET_BY_ID.get(str(pid).strip())
        if not preset:
            continue
        regex = str(preset["regex"])
        if regex in seen:
            continue
        seen.add(regex)
        rules.append({"id": str(pid), "regex": regex, "title": str(preset["title"])})
    custom = _validate_custom_regex(custom_regex)
    if custom and custom not in seen:
        rules.append({"id": "custom", "regex": custom, "title": "Özel regex"})
    return rules
