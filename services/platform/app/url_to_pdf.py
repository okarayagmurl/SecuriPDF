from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import httpx

_FETCH_TIMEOUT = httpx.Timeout(45.0, connect=15.0)
_USER_AGENT = "SecuriPDF/1.0 (URL-to-PDF; +https://github.com/okarayagmurl/SecuriPDF)"


class UrlFetchError(Exception):
    """URL içeriği alınamadı."""


def _inject_base_href(html: str, page_url: str) -> str:
    base = page_url if page_url.endswith("/") else page_url.rsplit("/", 1)[0] + "/"
    base_tag = f'<base href="{base}">'
    if re.search(r"<head\b", html, flags=re.I):
        return re.sub(r"(<head[^>]*>)", r"\1" + base_tag, html, count=1, flags=re.I)
    if re.search(r"<html\b", html, flags=re.I):
        return re.sub(r"(<html[^>]*>)", r"\1<head>" + base_tag + "</head>", html, count=1, flags=re.I)
    return f"<!DOCTYPE html><html><head>{base_tag}</head><body>{html}</body></html>"


def fetch_url_html(url: str) -> bytes:
    """Hedef URL'yi indirir; Stirling url/pdf ServletRequestAttributes bug'ından kaçınmak için."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise UrlFetchError("Geçersiz URL — http:// veya https:// ile başlamalıdır")

    with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
        try:
            resp = client.get(url, headers={"User-Agent": _USER_AGENT})
        except httpx.RequestError as exc:
            raise UrlFetchError(f"URL'ye bağlanılamadı: {exc}") from exc

    if resp.status_code >= 400:
        raise UrlFetchError(f"URL HTTP {resp.status_code} döndü")

    ctype = (resp.headers.get("content-type") or "").lower()
    body = resp.content
    if not body:
        raise UrlFetchError("URL boş yanıt döndü")

    final_url = str(resp.url)
    if "html" in ctype or body.lstrip()[:1] in (b"<", b"\xef", b"\xfe"):
        text = body.decode("utf-8", errors="replace")
        # JS-only SPA kabukları çok kısa olur; anlamlı içerik yoksa uyar.
        visible = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.I)
        visible = re.sub(r"<style[\s\S]*?</style>", "", visible, flags=re.I)
        visible = re.sub(r"<[^>]+>", " ", visible)
        visible = re.sub(r"\s+", " ", visible).strip()
        if len(visible) < 40:
            raise UrlFetchError(
                "Sayfa içeriği çok zayıf (muhtemelen JavaScript gerektiren SPA). "
                "Statik HTML bir adres deneyin."
            )
        return _inject_base_href(text, final_url).encode("utf-8")

    raise UrlFetchError(
        "URL HTML değil — yalnızca web sayfaları desteklenir (PDF/görsel doğrudan indirilemez)"
    )


def url_to_html_pdf_request(url: str, zoom: str = "1") -> tuple[str, list, dict[str, str]]:
    """Stirling html/pdf isteği: (endpoint, files, form_data)."""
    html_bytes = fetch_url_html(url)
    endpoint = "/api/v1/convert/html/pdf"
    files = [("fileInput", ("page.html", html_bytes, "text/html; charset=utf-8"))]
    form = {"zoom": str(zoom or "1")}
    return endpoint, files, form
