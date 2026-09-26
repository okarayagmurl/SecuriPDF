#!/usr/bin/env python3
"""SecuriPDF License Manager — tek araç: üret, doğrula, incele.

Kullanim:
  python cli.py packages
  python cli.py generate -p professional -c "ACME A.S." -e 2027-12-31 -o acme.lic
  python cli.py verify acme.lic
  python cli.py info acme.lic

PyInstaller (Windows exe):
  pyinstaller --onefile --name SecuriPDF-LicenseManager cli.py
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from license_core import (
    build_payload,
    load_packages,
    load_private_key,
    load_public_key,
    read_lic,
    sign_license,
    verify_license,
    write_lic,
)

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
DEFAULT_PACKAGES = REPO / "config" / "license-packages.yml"


def _expire_iso(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip()
    if "T" in raw:
        return raw if raw.endswith("Z") else raw + "Z"
    return f"{raw}T23:59:59Z"


def cmd_packages(args: argparse.Namespace) -> int:
    data = load_packages(Path(args.packages))
    packages = data.get("packages") or {}
    if not packages:
        print("Paket bulunamadi:", args.packages)
        return 1
    for key, spec in packages.items():
        limits = spec.get("limits") or {}
        tools = spec.get("enabled_tools") or []
        print(f"{key:14}  {spec.get('label', key)}")
        print(f"  {spec.get('description', '')}")
        print(f"  limits={limits}  tools={len(tools) or 'enterprise/sync'}")
        print()
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    packages = (load_packages(Path(args.packages)).get("packages") or {})
    if args.package not in packages and not args.force:
        print(f"Bilinmeyen paket: {args.package}. --force ile yine de uretin veya packages kontrol edin.")
        return 1
    pkg = packages.get(args.package) or {}
    max_users = args.max_users
    max_sessions = args.max_sessions
    if max_users is None and pkg.get("limits"):
        max_users = (pkg["limits"] or {}).get("max_users")
    if max_sessions is None and pkg.get("limits"):
        max_sessions = (pkg["limits"] or {}).get("max_concurrent_sessions")
    enabled = None
    if args.include_tools:
        enabled = list(pkg.get("enabled_tools") or [])
    payload = build_payload(
        package=args.package,
        customer=args.customer,
        expires_at=_expire_iso(args.expires),
        max_users=max_users,
        max_sessions=max_sessions,
        enabled_tools=enabled,
        notes=args.notes or "",
    )
    priv = load_private_key(Path(args.key) if args.key else None)
    doc = sign_license(payload, priv)
    out = Path(args.output)
    write_lic(out, doc)
    print(f"Yazildi: {out}")
    print(f"  key={payload['license_key']}")
    print(f"  package={payload['package']}  customer={payload['customer']}")
    print(f"  expires={payload.get('expires_at')}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    doc = read_lic(Path(args.file))
    pub = load_public_key(Path(args.pubkey) if args.pubkey else None)
    try:
        result = verify_license(doc, pub)
    except ValueError as exc:
        print("GECERSIZ:", exc)
        return 2
    print("IMZA: OK")
    print("DURUM:", "SURESI_DOLMUS" if result["expired"] else "GECERLI")
    print(json.dumps(result["payload"], indent=2, ensure_ascii=False))
    return 0 if result["valid"] else 3


def cmd_info(args: argparse.Namespace) -> int:
    doc = read_lic(Path(args.file))
    payload = doc.get("payload") or {}
    print(json.dumps({"v": doc.get("v"), "payload": payload, "has_sig": bool(doc.get("sig"))}, indent=2, ensure_ascii=False))
    return 0


def cmd_keygen(args: argparse.Namespace) -> int:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    priv_path = out / "vendor.ed25519.priv"
    pub_path = out / "vendor.ed25519.pub"
    priv_path.write_bytes(priv.private_bytes_raw() if hasattr(priv, "private_bytes_raw") else priv.private_bytes(
        encoding=__import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.Raw,
        format=__import__("cryptography.hazmat.primitives.serialization", fromlist=["PrivateFormat"]).PrivateFormat.Raw,
        encryption_algorithm=__import__("cryptography.hazmat.primitives.serialization", fromlist=["NoEncryption"]).NoEncryption(),
    ))
    pub_path.write_bytes(pub.public_bytes_raw() if hasattr(pub, "public_bytes_raw") else pub.public_bytes(
        encoding=__import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.Raw,
        format=__import__("cryptography.hazmat.primitives.serialization", fromlist=["PublicFormat"]).PublicFormat.Raw,
    ))
    print(f"Private: {priv_path}  (GIZLI — yalnizca Entera ops)")
    print(f"Public:  {pub_path}  (platforma kopyalanir)")
    print("Not: yeni public key platform license_file.py DEFAULT_PUBLIC_KEY_B64 ile eslesmeli.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="SecuriPDF-LicenseManager", description="SecuriPDF lisans uretici / yonetici")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("packages", help="Paket katalogunu listele")
    sp.add_argument("--packages", default=str(DEFAULT_PACKAGES))
    sp.set_defaults(func=cmd_packages)

    sg = sub.add_parser("generate", help="Imzali .lic uret")
    sg.add_argument("-p", "--package", required=True, help="starter|professional|enterprise")
    sg.add_argument("-c", "--customer", required=True)
    sg.add_argument("-e", "--expires", help="YYYY-MM-DD veya ISO")
    sg.add_argument("-o", "--output", required=True)
    sg.add_argument("--max-users", type=int, default=None)
    sg.add_argument("--max-sessions", type=int, default=None)
    sg.add_argument("--include-tools", action="store_true", help="Paket araclari .lic icine yaz")
    sg.add_argument("--notes", default="")
    sg.add_argument("--key", help="vendor.ed25519.priv yolu")
    sg.add_argument("--packages", default=str(DEFAULT_PACKAGES))
    sg.add_argument("--force", action="store_true")
    sg.set_defaults(func=cmd_generate)

    sv = sub.add_parser("verify", help="Imza ve sure kontrolu")
    sv.add_argument("file")
    sv.add_argument("--pubkey", help="vendor.ed25519.pub")
    sv.set_defaults(func=cmd_verify)

    si = sub.add_parser("info", help="Imza olmadan ozet")
    si.add_argument("file")
    si.set_defaults(func=cmd_info)

    sk = sub.add_parser("keygen", help="Yeni Ed25519 anahtar cifti")
    sk.add_argument("-o", "--outdir", default=str(ROOT / "keys"))
    sk.set_defaults(func=cmd_keygen)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
