"""Kurumsal TLS: CA talep dosyası (CSR) ve dönen sertifika.

Özel anahtar yalnızca sunucuda durur. İndirilen dosya CSR'dir.
"""

from __future__ import annotations

import base64
import ipaddress
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import HTTPException

_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,253}$")


def tls_dir() -> Path:
    path = Path(os.getenv("SECURIPDF_TLS_DIR", "/vault-data/tls"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _key_path() -> Path:
    return tls_dir() / "securipdf.key"


def _csr_path() -> Path:
    return tls_dir() / "securipdf.csr"


def _crt_path() -> Path:
    return tls_dir() / "securipdf.crt"


def _meta_path() -> Path:
    return tls_dir() / "meta.json"


def _read_meta() -> dict[str, Any]:
    path = _meta_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _write_meta(data: dict[str, Any]) -> None:
    _meta_path().write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _load_key():
    path = _key_path()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Once CA talep dosyasi olusturun. Ozel anahtar sunucuda yok.")
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def _names(common_name: str, dns_names: list[str], ip_addresses: list[str]) -> tuple[str, list[str], list[str]]:
    cn = (common_name or "").strip()
    if not cn or not _NAME_RE.match(cn):
        raise HTTPException(status_code=400, detail="Ortak ad bos veya gecersiz. Ornek: pdf.sirket.local")
    dns: list[str] = []
    ips: list[str] = []
    for raw in [cn, *dns_names]:
        item = (raw or "").strip().rstrip(".")
        if not item:
            continue
        try:
            ipaddress.ip_address(item)
            ips.append(item)
            continue
        except ValueError:
            pass
        if not _NAME_RE.match(item):
            raise HTTPException(status_code=400, detail=f"DNS adi gecersiz: {item}")
        if item.lower() not in {d.lower() for d in dns}:
            dns.append(item)
    for raw in ip_addresses:
        item = (raw or "").strip()
        if not item:
            continue
        try:
            ipaddress.ip_address(item)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"IP gecersiz: {item}") from exc
        if item not in ips:
            ips.append(item)
    if not dns and not ips:
        raise HTTPException(status_code=400, detail="En az bir DNS adi veya IP gerekli")
    return cn, dns, ips


def create_csr(
    common_name: str,
    dns_names: list[str] | None = None,
    ip_addresses: list[str] | None = None,
    organization: str = "",
) -> dict[str, Any]:
    cn, dns, ips = _names(common_name, dns_names or [], ip_addresses or [])
    org = (organization or "SecuriPDF").strip()[:64] or "SecuriPDF"
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cn_value = cn if len(cn) <= 64 else cn[:64]
    name = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "TR"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, org),
            x509.NameAttribute(NameOID.COMMON_NAME, cn_value),
        ]
    )
    builder = x509.CertificateSigningRequestBuilder().subject_name(name)
    san: list[x509.GeneralName] = [x509.DNSName(item) for item in dns]
    san.extend(x509.IPAddress(ipaddress.ip_address(item)) for item in ips)
    builder = builder.add_extension(x509.SubjectAlternativeName(san), critical=False)
    csr = builder.sign(key, hashes.SHA256())
    directory = tls_dir()
    key_path = directory / "securipdf.key"
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    os.chmod(key_path, 0o644)
    csr_path = directory / "securipdf.csr"
    csr_path.write_bytes(csr.public_bytes(serialization.Encoding.PEM))
    if _crt_path().is_file():
        _crt_path().unlink()
    _write_meta(
        {
            "commonName": cn,
            "dnsNames": dns,
            "ipAddresses": ips,
            "organization": org,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "hasCertificate": False,
        }
    )
    return status()


def csr_file() -> Path:
    path = _csr_path()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="CA talep dosyasi yok. Once olusturun.")
    return path


def _certs_from_payload(pem: str | None, der_b64: str | None) -> list[x509.Certificate]:
    found: list[x509.Certificate] = []
    text = (pem or "").strip()
    if text:
        if "BEGIN CERTIFICATE" not in text:
            raise HTTPException(status_code=400, detail="Sertifika PEM formatinda degil")
        try:
            found.extend(x509.load_pem_x509_certificates(text.encode("utf-8")))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Sertifika okunamadi") from exc
    if der_b64:
        try:
            raw = base64.b64decode(der_b64, validate=True)
            found.append(x509.load_der_x509_certificate(raw))
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail="CER dosyasi okunamadi") from exc
    return found


def _private_key_from_pem(pem: str):
    text = (pem or "").strip()
    if "PRIVATE KEY" not in text:
        raise HTTPException(status_code=400, detail="Ozel anahtar PEM formatinda degil")
    try:
        return serialization.load_pem_private_key(text.encode("utf-8"), password=None)
    except TypeError as exc:
        raise HTTPException(status_code=400, detail="Anahtar sifreli. Sifresiz PEM yukleyin.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Ozel anahtar okunamadi") from exc


def install_certificate(
    certificate_pem: str | None = None,
    certificate_der_b64: str | None = None,
    chain_pem: str | None = None,
    chain_der_b64: str | None = None,
    private_key_pem: str | None = None,
) -> dict[str, Any]:
    leaf_list = _certs_from_payload(certificate_pem, certificate_der_b64)
    if not leaf_list:
        raise HTTPException(status_code=400, detail="Sertifika dosyasi secin")
    extra = _certs_from_payload(chain_pem, chain_der_b64)
    leaf = leaf_list[0]
    chain = leaf_list[1:] + extra
    supplied = (private_key_pem or "").strip()
    private_key = _private_key_from_pem(supplied) if supplied else _load_key()
    if private_key.public_key().public_numbers() != leaf.public_key().public_numbers():
        if supplied:
            detail = "Sertifika ile secilen ozel anahtar eslesmiyor."
        else:
            detail = (
                "Sertifika sunucudaki talep anahtari ile eslesmiyor. "
                "Hazir anahtariniz varsa Ozel anahtar alanina da ekleyin."
            )
        raise HTTPException(status_code=400, detail=detail)
    if supplied:
        key_path = _key_path()
        key_path.write_text(supplied if supplied.endswith("\n") else supplied + "\n", encoding="utf-8")
        os.chmod(key_path, 0o644)
    blob = b"".join(item.public_bytes(serialization.Encoding.PEM) for item in [leaf, *chain])
    _crt_path().write_bytes(blob)
    meta = _read_meta()
    meta.update(
        {
            "hasCertificate": True,
            "certificateSubject": leaf.subject.rfc4514_string(),
            "certificateIssuer": leaf.issuer.rfc4514_string(),
            "notBefore": leaf.not_valid_before_utc.isoformat(),
            "notAfter": leaf.not_valid_after_utc.isoformat(),
            "installedAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    _write_meta(meta)
    return status()


def mark_applied(applied: bool) -> None:
    meta = _read_meta()
    meta["applied"] = applied
    if applied:
        meta["appliedAt"] = datetime.now(timezone.utc).isoformat()
    _write_meta(meta)


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address((value or "").strip())
        return True
    except ValueError:
        return False


def certificate_dns_names() -> list[str]:
    """Kurulu yaprağın DNS adları. IP SAN ve ara sertifikalar dahil edilmez."""
    path = _crt_path()
    if not path.is_file():
        return []
    try:
        certs = x509.load_pem_x509_certificates(path.read_bytes())
    except ValueError:
        return []
    if not certs:
        return []
    leaf = certs[0]
    names: list[str] = []
    try:
        san = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        for item in san.get_values_for_type(x509.DNSName):
            if item and not _is_ip(item) and item not in names:
                names.append(item)
    except x509.ExtensionNotFound:
        pass
    if not names:
        attrs = leaf.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        if attrs:
            cn = str(attrs[0].value)
            if cn and not _is_ip(cn):
                names.append(cn)
    return names


def preferred_https_host(configured: str, server_ip: str = "") -> str:
    """Kayıtlı adres IP ise sertifikadaki alan adını kullan."""
    host = (configured or "").strip()
    names = certificate_dns_names()
    if names and (not host or host in ("localhost", "127.0.0.1") or _is_ip(host)):
        return names[0]
    if host in ("", "localhost", "127.0.0.1"):
        return (server_ip or "").strip()
    return host


def status() -> dict[str, Any]:
    meta = _read_meta()
    not_after = meta.get("notAfter")
    days = None
    if isinstance(not_after, str):
        try:
            end = datetime.fromisoformat(not_after)
            days = (end - datetime.now(timezone.utc)).days
        except ValueError:
            days = None
    return {
        "hasKey": _key_path().is_file(),
        "hasCsr": _csr_path().is_file(),
        "hasCertificate": _crt_path().is_file() and bool(meta.get("hasCertificate")),
        "commonName": meta.get("commonName") or "",
        "dnsNames": meta.get("dnsNames") or [],
        "ipAddresses": meta.get("ipAddresses") or [],
        "organization": meta.get("organization") or "",
        "certificateSubject": meta.get("certificateSubject") or "",
        "certificateIssuer": meta.get("certificateIssuer") or "",
        "notBefore": meta.get("notBefore"),
        "notAfter": meta.get("notAfter"),
        "daysRemaining": days,
        "applied": bool(meta.get("applied")),
        "createdAt": meta.get("createdAt"),
    }
