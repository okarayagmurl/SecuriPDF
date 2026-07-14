from __future__ import annotations

import datetime
from typing import Any

import fitz
from cryptography.hazmat.primitives.serialization import load_pem_private_key, pkcs12
from cryptography.x509 import load_pem_x509_certificate
from endesive.pdf import cms

from .pdf_validate import is_valid_pdf

_VISIBLE_ALIGNED = 16384


class CertSignError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).lower() in {"true", "1", "on", "yes"}


def wants_visible_signature(form_data: dict[str, Any]) -> bool:
    return _as_bool(form_data.get("showSignature"), default=False)


def _latin1_safe(text: str) -> str:
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _page_count(pdf_bytes: bytes) -> int:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return doc.page_count
    finally:
        doc.close()


def _validate_page(page_number: int, page_count: int) -> int:
    if page_number < 1 or page_number > page_count:
        raise CertSignError("CERT_SIGN_PAGE_OUT_OF_RANGE")
    return page_number


def _signing_date() -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.strftime("D:%Y%m%d%H%M%S+00'00'")


def _signature_box(pdf_bytes: bytes, page_number: int) -> tuple[float, float, float, float]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_number - 1]
        mb = page.mediabox
        margin = 36.0
        box_w, box_h = 200.0, 55.0
        x1 = float(mb.x0 + margin)
        y1 = float(mb.y0 + margin)
        x2 = min(x1 + box_w, float(mb.x1 - margin))
        y2 = min(y1 + box_h, float(mb.y1 - margin))
        if x2 <= x1 or y2 <= y1:
            x2, y2 = x1 + box_w, y1 + box_h
        return (x1, y1, x2, y2)
    finally:
        doc.close()


def _visible_label(name: str, reason: str) -> str:
    for candidate in (name, reason, "Signed"):
        text = _latin1_safe(str(candidate or "").strip())
        if text:
            return text[:120]
    return "Signed"


def _build_sign_dict(
    pdf_bytes: bytes,
    *,
    page_number: int,
    show_signature: bool,
    reason: str,
    location: str,
    name: str,
) -> dict[str, Any]:
    reason_safe = _latin1_safe(reason)
    location_safe = _latin1_safe(location)
    dct: dict[str, Any] = {
        "aligned": _VISIBLE_ALIGNED if show_signature else 0,
        "sigflags": 3,
        "sigflagsft": 132,
        "sigpage": max(0, page_number - 1),
        "contact": "",
        "location": location_safe,
        "signingdate": _signing_date(),
        "reason": reason_safe or _visible_label(name, reason),
        "auto_sigfield": True,
    }
    if show_signature:
        dct["signaturebox"] = _signature_box(pdf_bytes, page_number)
        # Düz metin kutusu — signature_appearance Docker'da daha kırılgan.
        dct["signature"] = _visible_label(name, reason)
        dct["text"] = {"fontsize": 10, "wraptext": True, "textalign": "left"}
    return dct


def _cms_sign_pdf(
    pdf_bytes: bytes,
    dct: dict[str, Any],
    private_key: Any,
    cert: Any,
    chain: list[Any] | None,
    *,
    show_signature: bool,
) -> bytes:
    try:
        signed_tail = cms.sign(
            pdf_bytes,
            dct,
            private_key,
            cert,
            chain or [],
            "sha256",
        )
    except Exception as exc:
        if show_signature:
            raise CertSignError("CERT_SIGN_VISIBLE_FAILED") from exc
        raise CertSignError("CERT_SIGN_INVALID_OUTPUT") from exc
    if not signed_tail:
        raise CertSignError(
            "CERT_SIGN_VISIBLE_FAILED" if show_signature else "CERT_SIGN_INVALID_OUTPUT"
        )
    result = pdf_bytes + signed_tail
    if not result or not is_valid_pdf(result):
        raise CertSignError(
            "CERT_SIGN_VISIBLE_FAILED" if show_signature else "CERT_SIGN_INVALID_OUTPUT"
        )
    try:
        doc = fitz.open(stream=result, filetype="pdf")
        doc.close()
    except Exception as exc:
        raise CertSignError(
            "CERT_SIGN_VISIBLE_FAILED" if show_signature else "CERT_SIGN_INVALID_OUTPUT"
        ) from exc
    return result


def _sign_with_material(
    pdf_bytes: bytes,
    dct: dict[str, Any],
    private_key: Any,
    cert: Any,
    chain: list[Any] | None,
    *,
    show_signature: bool,
) -> bytes:
    return _cms_sign_pdf(
        pdf_bytes, dct, private_key, cert, chain, show_signature=show_signature
    )


def sign_pdf_pkcs12(
    pdf_bytes: bytes,
    p12_bytes: bytes,
    password: str,
    *,
    page_number: int = 1,
    show_signature: bool = False,
    reason: str = "",
    location: str = "",
    name: str = "",
    show_logo: bool = False,
) -> bytes:
    del show_logo  # platform yolunda logo desteklenmiyor
    if not pdf_bytes:
        raise CertSignError("INPUT_MISSING")
    if not p12_bytes:
        raise CertSignError("CERT_SIGN_P12_MISSING")
    page_number = _validate_page(page_number, _page_count(pdf_bytes))
    pwd = password.encode("utf-8") if password else None
    try:
        key, cert, extra = pkcs12.load_key_and_certificates(p12_bytes, pwd)
    except Exception as exc:
        raise CertSignError("CERT_SIGN_KEY_LOAD_FAILED") from exc
    if key is None or cert is None:
        raise CertSignError("CERT_SIGN_KEY_LOAD_FAILED")
    chain = list(extra) if extra else []
    dct = _build_sign_dict(
        pdf_bytes,
        page_number=page_number,
        show_signature=show_signature,
        reason=reason,
        location=location,
        name=name,
    )
    return _sign_with_material(
        pdf_bytes, dct, key, cert, chain, show_signature=show_signature
    )


def sign_pdf_pem(
    pdf_bytes: bytes,
    private_key_bytes: bytes,
    cert_bytes: bytes,
    password: str,
    *,
    page_number: int = 1,
    show_signature: bool = False,
    reason: str = "",
    location: str = "",
    name: str = "",
    show_logo: bool = False,
) -> bytes:
    del show_logo
    if not pdf_bytes:
        raise CertSignError("INPUT_MISSING")
    if not private_key_bytes or not cert_bytes:
        raise CertSignError("CERT_SIGN_PEM_MISSING")
    page_number = _validate_page(page_number, _page_count(pdf_bytes))
    pwd = password.encode("utf-8") if password else None
    try:
        key = load_pem_private_key(private_key_bytes, password=pwd)
        cert = load_pem_x509_certificate(cert_bytes)
    except Exception as exc:
        raise CertSignError("CERT_SIGN_KEY_LOAD_FAILED") from exc
    dct = _build_sign_dict(
        pdf_bytes,
        page_number=page_number,
        show_signature=show_signature,
        reason=reason,
        location=location,
        name=name,
    )
    return _sign_with_material(
        pdf_bytes, dct, key, cert, [cert], show_signature=show_signature
    )


def sign_pdf_from_job(
    pdf_bytes: bytes,
    form_data: dict[str, Any],
    files: list[tuple[str, tuple[str | None, bytes, str | None]]],
) -> bytes:
    cert_type = str(form_data.get("certType") or "PKCS12").upper()
    if cert_type == "PFX":
        cert_type = "PKCS12"
    page_number = int(str(form_data.get("pageNumber") or "1") or "1")
    show_signature = wants_visible_signature(form_data)
    reason = str(form_data.get("reason") or "")
    location = str(form_data.get("location") or "")
    name = str(form_data.get("name") or "")
    password = str(form_data.get("password") if form_data.get("password") is not None else "")

    if cert_type in ("PKCS12", "PFX"):
        p12_item = next((item for item in files if item[0] == "p12File"), None)
        p12_bytes = p12_item[1][1] if p12_item else b""
        return sign_pdf_pkcs12(
            pdf_bytes,
            p12_bytes,
            password,
            page_number=page_number,
            show_signature=show_signature,
            reason=reason,
            location=location,
            name=name,
        )

    if cert_type == "PEM":
        pk_item = next((item for item in files if item[0] == "privateKeyFile"), None)
        cert_item = next((item for item in files if item[0] == "certFile"), None)
        return sign_pdf_pem(
            pdf_bytes,
            pk_item[1][1] if pk_item else b"",
            cert_item[1][1] if cert_item else b"",
            password,
            page_number=page_number,
            show_signature=show_signature,
            reason=reason,
            location=location,
            name=name,
        )

    raise CertSignError("CERT_SIGN_UNSUPPORTED_TYPE")


def supports_platform_cert_sign(cert_type: str) -> bool:
    return str(cert_type or "PKCS12").upper() in {"PKCS12", "PFX", "PEM"}
