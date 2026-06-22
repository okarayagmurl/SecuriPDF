from __future__ import annotations

import smtplib
import ssl
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from typing import Callable

from fastapi import HTTPException

from .config import Settings
from .email_templates import (
    document_email_html,
    document_email_plain,
    document_email_subject,
    smtp_test_html,
    smtp_test_plain,
    smtp_test_subject,
)

SMTP_SECURITY_MODES = frozenset({"starttls", "ssl", "none"})


def _smtp_settings(settings: Settings) -> dict:
    security = getattr(settings, "smtp_security", "starttls")
    if security not in SMTP_SECURITY_MODES:
        security = "starttls" if settings.smtp_use_tls else "none"
    return {
        "enabled": settings.smtp_enabled,
        "host": settings.smtp_host,
        "port": settings.smtp_port,
        "user": settings.smtp_user,
        "password": settings.smtp_password,
        "from_addr": settings.smtp_from,
        "security": security,
        "auth_enabled": getattr(settings, "smtp_auth_enabled", False),
        "max_bytes": settings.smtp_max_attachment_bytes,
    }


def _login_if_needed(server: smtplib.SMTP, cfg: dict) -> None:
    if not cfg.get("auth_enabled"):
        return
    user = (cfg.get("user") or "").strip()
    if not user:
        raise smtplib.SMTPAuthenticationError(
            "Kimlik dogrulama acik ancak kullanici adi bos. Kullanici adi girin veya kimlik dogrulamayi kapatın."
        )
    if not server.has_extn("AUTH"):
        raise smtplib.SMTPNotSupportedError(
            "Sunucu AUTH desteklemiyor. Ic ag relay icin 'Kimlik dogrulama kullan' secimini kapatın."
        )
    server.login(user, cfg.get("password") or "")


def _format_smtp_error(exc: Exception, cfg: dict) -> str:
    text = str(exc)
    if "No suitable authentication method" in text or "Authentication required" in text:
        return (
            "Sunucu kullanici adi/parola ile giris desteklemiyor. "
            "Ic ag relay (Exchange/IIS) genelde IP ile calisir: "
            "Admin > SMTP > 'Kimlik dogrulama kullan' isaretini kaldirin, kaydedin ve tekrar deneyin."
        )
    return f"SMTP hatasi: {text}"


def _format_connection_error(exc: Exception, cfg: dict) -> str:
    text = str(exc)
    security = cfg.get("security", "starttls")
    port = cfg.get("port", 587)

    if "WRONG_VERSION_NUMBER" in text:
        if security == "ssl":
            return (
                f"Port {port} SSL/TLS (SMTPS) bekliyor ancak sunucu sifresiz SMTP yanit verdi. "
                "Ic ag relay (Exchange/IIS) icin: guvenlik modu 'Yok', port 587 veya 25."
            )
        return (
            f"TLS surumu uyusmuyor (port {port}). "
            "Guvenlik modunu ve portu kontrol edin: ic ag relay -> Yok + 587/25."
        )

    if security == "starttls" and "STARTTLS" in text.upper():
        return (
            "Sunucu STARTTLS desteklemiyor. Ic ag relay icin guvenlik modu 'Yok (ic ag)' secin."
        )

    if "Connection refused" in text or "actively refused" in text.lower():
        return f"Port {port} kapali veya erisilemiyor. Dogru portu deneyin (587, 25 veya 465)."

    return f"Baglanti hatasi: {text}"


def _build_html_message(
    *,
    from_addr: str,
    to_addr: str,
    subject: str,
    plain: str,
    html_body: str,
) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Date"] = formatdate(localtime=True)
    msg["Subject"] = subject
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    return msg


def _with_smtp_server(cfg: dict, action: Callable[[smtplib.SMTP], None]) -> None:
    security = cfg.get("security", "starttls")
    host = cfg["host"]
    port = cfg["port"]

    if security == "ssl":
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, timeout=30, context=context) as server:
            server.ehlo()
            _login_if_needed(server, cfg)
            action(server)
        return

    with smtplib.SMTP(host, port, timeout=30) as server:
        server.ehlo()
        if security == "starttls":
            if not server.has_extn("STARTTLS"):
                raise smtplib.SMTPNotSupportedError(
                    "STARTTLS desteklenmiyor. Guvenlik modunu 'Yok (ic ag)' veya 'SSL/TLS (465)' yapin."
                )
            context = ssl.create_default_context()
            server.starttls(context=context)
            server.ehlo()
        _login_if_needed(server, cfg)
        action(server)


def test_smtp_connection(settings: Settings, recipient: str | None = None) -> tuple[bool, str]:
    cfg = _smtp_settings(settings)
    if not cfg["enabled"]:
        return False, "SMTP devre disi (enabled=false)"
    if not cfg["host"]:
        return False, "SMTP sunucu adresi (host) tanimli degil"
    if not cfg["from_addr"]:
        return False, "Gonderici adresi (from) tanimli degil"

    try:
        if recipient:
            msg = _build_html_message(
                from_addr=cfg["from_addr"],
                to_addr=recipient,
                subject=smtp_test_subject(settings),
                plain=smtp_test_plain(settings),
                html_body=smtp_test_html(settings),
            )

            def send_test(server: smtplib.SMTP) -> None:
                server.sendmail(cfg["from_addr"], [recipient], msg.as_string())

            _with_smtp_server(cfg, send_test)
            return True, f"Test e-postasi gonderildi: {recipient}"

        def ping(server: smtplib.SMTP) -> None:
            server.noop()

        _with_smtp_server(cfg, ping)
        mode_label = {"starttls": "STARTTLS", "ssl": "SSL/TLS", "none": "sifresiz"}[cfg["security"]]
        return True, f"SMTP baglantisi basarili ({cfg['host']}:{cfg['port']}, {mode_label})"
    except smtplib.SMTPException as exc:
        return False, _format_smtp_error(exc, cfg)
    except (OSError, ssl.SSLError) as exc:
        return False, _format_connection_error(exc, cfg)


def send_document_email(
    settings: Settings,
    *,
    to_addr: str,
    filename: str,
    pdf_bytes: bytes,
    user_id: str,
) -> None:
    cfg = _smtp_settings(settings)
    if not cfg["enabled"]:
        raise HTTPException(status_code=503, detail="E-posta servisi yapilandirilmamis (SMTP devre disi)")
    if not cfg["host"] or not cfg["from_addr"]:
        raise HTTPException(status_code=503, detail="SMTP sunucusu veya gonderici adresi eksik")
    if len(pdf_bytes) > cfg["max_bytes"]:
        raise HTTPException(status_code=413, detail="E-posta eki boyut limiti asildi")

    subject = document_email_subject(filename=filename, user_id=user_id, settings=settings)
    body = MIMEMultipart("mixed")
    body["From"] = cfg["from_addr"]
    body["To"] = to_addr
    body["Date"] = formatdate(localtime=True)
    body["Subject"] = subject

    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(document_email_plain(filename=filename, user_id=user_id, settings=settings), "plain", "utf-8"))
    alternative.attach(MIMEText(document_email_html(filename=filename, user_id=user_id, settings=settings), "html", "utf-8"))
    body.attach(alternative)

    attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
    attachment.add_header("Content-Disposition", "attachment", filename=filename)
    body.attach(attachment)

    try:

        def send_mail(server: smtplib.SMTP) -> None:
            server.sendmail(cfg["from_addr"], [to_addr], body.as_string())

        _with_smtp_server(cfg, send_mail)
    except smtplib.SMTPException as exc:
        raise HTTPException(status_code=502, detail=_format_smtp_error(exc, cfg)) from exc
    except (OSError, ssl.SSLError) as exc:
        raise HTTPException(status_code=502, detail=_format_connection_error(exc, cfg)) from exc
