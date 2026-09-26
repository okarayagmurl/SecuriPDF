"""SecuriPDF host diagnostic page — Keycloak/SSO bagimsiz, yerel parola."""

from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import subprocess
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any, Callable


def _run(cmd: list[str], cwd: Path | None = None, timeout: int = 20) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return proc.returncode, out
    except Exception as exc:  # noqa: BLE001
        return 1, str(exc)


def diag_password(cfg: dict[str, str]) -> str:
    return (cfg.get("SECURIPDF_DIAG_PASSWORD") or "").strip()


def _session_secret(cfg: dict[str, str]) -> bytes:
    raw = (cfg.get("SECURIPDF_UPDATER_TOKEN") or "") + ":" + diag_password(cfg)
    return hashlib.sha256(raw.encode("utf-8")).digest()


def make_session_token(cfg: dict[str, str]) -> str:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return hmac.new(_session_secret(cfg), day.encode("utf-8"), hashlib.sha256).hexdigest()


def session_ok(cfg: dict[str, str], cookie_header: str | None) -> bool:
    pwd = diag_password(cfg)
    if not pwd:
        return False
    if not cookie_header:
        return False
    jar = SimpleCookie()
    try:
        jar.load(cookie_header)
    except Exception:  # noqa: BLE001
        return False
    morsel = jar.get("securipdf_diag")
    if not morsel:
        return False
    expected = make_session_token(cfg)
    return hmac.compare_digest(morsel.value.strip(), expected)


def password_ok(cfg: dict[str, str], password: str) -> bool:
    expected = diag_password(cfg)
    if not expected:
        return False
    return hmac.compare_digest(password.strip(), expected)


def collect_diagnostics(
    cfg: dict[str, str],
    offline_dir_fn: Callable[[], Path],
) -> dict[str, Any]:
    """SSO/platform bagimsiz host teshis ozeti."""
    now = datetime.now(timezone.utc).isoformat()
    offline = cfg.get("SECURIPDF_OFFLINE_DIR", "")
    root: Path | None = Path(offline) if offline else None
    try:
        root = offline_dir_fn()
    except Exception:  # noqa: BLE001
        pass

    checks: list[dict[str, Any]] = []

    def add(cid: str, label: str, ok: bool, detail: str = "") -> None:
        checks.append({"id": cid, "label": label, "ok": ok, "detail": (detail or "")[:800]})

    code, out = _run(["docker", "info"])
    add("docker", "Docker daemon", code == 0, out if code else "OK")

    code, out = _run(["docker", "ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}"])
    containers = out.strip() if code == 0 else ""
    add("containers", "Container listesi", code == 0, containers or out)

    expected = (
        "securipdf-platform",
        "securipdf-oauth2-proxy",
        "securipdf-keycloak",
        "securipdf-nginx",
        "entera-pdf",
        "securipdf-postgres",
    )
    running = {line.split("\t")[0] for line in containers.splitlines() if line.strip()}
    missing = [n for n in expected if n not in running]
    add("expected_containers", "Beklenen container'lar", not missing, "Eksik: " + ", ".join(missing) if missing else "Tumu ayakta")

    manifest: dict[str, Any] | None = None
    if root and (root / "MANIFEST.json").is_file():
        try:
            manifest = json.loads((root / "MANIFEST.json").read_text(encoding="utf-8"))
            add("manifest", "MANIFEST.json", True, f"version={manifest.get('version')} kind={manifest.get('package_kind', 'full')}")
        except Exception as exc:  # noqa: BLE001
            add("manifest", "MANIFEST.json", False, str(exc))
    else:
        add("manifest", "MANIFEST.json", False, "Offline dizinde yok")

    env_ok = bool(root and (root / "docker" / ".env").is_file())
    add("env", "docker/.env", env_ok, str(root / "docker" / ".env") if root else "")

    images_full = root / "images" / "securipdf-images.tar" if root else None
    images_delta = root / "images" / "securipdf-images-delta.tar" if root else None
    has_images = bool(
        (images_full and images_full.is_file()) or (images_delta and images_delta.is_file())
    )
    add(
        "images",
        "Image arsivi",
        has_images,
        "full" if images_full and images_full.is_file() else ("delta" if images_delta and images_delta.is_file() else "yok"),
    )

    # HTTP probes (localhost)
    probes: dict[str, Any] = {}
    for name, url in (
        ("nginx_health", "http://127.0.0.1:8080/nginx-health"),
        ("platform_health", "http://127.0.0.1:8080/health"),
        ("updater_health", f"http://127.0.0.1:{cfg.get('SECURIPDF_UPDATER_PORT', '8765')}/health"),
    ):
        code, out = _run(["curl", "-sf", "--max-time", "5", url])
        probes[name] = {"ok": code == 0, "body": (out or "")[:200]}
        add(f"probe_{name}", f"Probe {name}", code == 0, out[:200] if out else f"curl exit {code}")

    disk = ""
    code, out = _run(["df", "-h", str(root) if root else "/"])
    if code == 0:
        disk = out.strip()

    logs: dict[str, str] = {}
    for cname in ("securipdf-platform", "securipdf-oauth2-proxy", "securipdf-keycloak", "securipdf-nginx"):
        code, out = _run(["docker", "logs", "--tail", "40", cname], timeout=15)
        logs[cname] = out[-2500:] if out else f"(exit {code})"

    return {
        "ok": all(c["ok"] for c in checks if c["id"] in ("docker", "expected_containers", "env")),
        "reportedAt": now,
        "offlineDir": str(root) if root else None,
        "listen": f"{cfg.get('SECURIPDF_UPDATER_HOST', '0.0.0.0')}:{cfg.get('SECURIPDF_UPDATER_PORT', '8765')}",
        "manifest": manifest,
        "checks": checks,
        "probes": probes,
        "disk": disk,
        "logs": logs,
        "hint": (
            "Bu sayfa Keycloak/SSO disindadir. Uygulama acilmiyorsa once Docker ve container durumuna bakin; "
            "oauth2-proxy veya Keycloak loglarini asagida inceleyin."
        ),
    }


LOGIN_HTML = """<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SecuriPDF Teşhis</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
form{background:#1e293b;padding:2rem;border-radius:12px;width:min(400px,92vw);box-shadow:0 8px 32px #0006}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{color:#94a3b8;font-size:.9rem;margin:0 0 1.25rem}
input{width:100%;padding:.65rem .75rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff;box-sizing:border-box}
button{margin-top:1rem;width:100%;padding:.7rem;border:0;border-radius:8px;background:#0ea5e9;color:#082f49;font-weight:600;cursor:pointer}
.err{color:#fca5a5;font-size:.85rem;margin-top:.75rem}
</style></head><body>
<form method="post" action="/diag/login">
<h1>SecuriPDF Teşhis</h1>
<p>SSO/Keycloak bağımsız yerel teşhis. Host updater parolası ile giriş.</p>
<input type="password" name="password" placeholder="Teşhis parolası" autofocus required>
<button type="submit">Giriş</button>
__ERR__
</form></body></html>
"""


def render_diag_page(data: dict[str, Any]) -> str:
    rows = []
    for c in data.get("checks") or []:
        mark = "OK" if c.get("ok") else "FAIL"
        color = "#4ade80" if c.get("ok") else "#f87171"
        detail = html.escape(str(c.get("detail") or "")).replace("\n", "<br>")
        rows.append(
            f'<tr><td style="color:{color};font-weight:600">{mark}</td>'
            f'<td>{html.escape(c.get("label") or "")}</td>'
            f'<td style="font-size:.8rem;color:#94a3b8;word-break:break-word">{detail}</td></tr>'
        )
    log_blocks = []
    for name, text in (data.get("logs") or {}).items():
        log_blocks.append(
            f"<details><summary>{html.escape(name)}</summary>"
            f"<pre>{html.escape(text)}</pre></details>"
        )
    disk = html.escape(data.get("disk") or "")
    hint = html.escape(data.get("hint") or "")
    offline = html.escape(str(data.get("offlineDir") or "—"))
    when = html.escape(str(data.get("reportedAt") or ""))
    return f"""<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SecuriPDF Teşhis</title>
<style>
body{{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:1.5rem}}
h1{{margin:0 0 .25rem}} .meta{{color:#94a3b8;font-size:.9rem;margin-bottom:1rem}}
table{{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}}
td,th{{padding:.55rem .75rem;border-bottom:1px solid #334155;vertical-align:top;text-align:left}}
pre{{background:#020617;padding:.75rem;border-radius:8px;overflow:auto;max-height:220px;font-size:.75rem}}
details{{margin:.5rem 0;background:#1e293b;padding:.5rem .75rem;border-radius:8px}}
a{{color:#38bdf8}} .bar{{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}}
</style></head><body>
<h1>SecuriPDF Teşhis</h1>
<p class="meta">{when} · Offline: {offline}</p>
<p class="meta">{hint}</p>
<div class="bar">
  <a href="/diag">Yenile</a>
  <a href="/diag/api">JSON</a>
  <a href="/diag/logout">Çıkış</a>
</div>
<table><thead><tr><th>Durum</th><th>Kontrol</th><th>Ayrıntı</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<h2>Disk</h2><pre>{disk}</pre>
<h2>Son loglar</h2>{''.join(log_blocks)}
</body></html>
"""


def login_page(error: str = "") -> str:
    err = f'<p class="err">{html.escape(error)}</p>' if error else ""
    return LOGIN_HTML.replace("__ERR__", err)
