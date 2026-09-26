#!/usr/bin/env python3
"""SecuriPDF License Manager — musteri kaydi + .req'ten lisans + dogrulama.

Ornekler:
  python cli.py customer-add -n "ACME A.S." --email satis@acme.com
  python cli.py customer-list
  python cli.py issue --request musteri.req --customer-id CUST-... -e 2027-12-31 -o acme.lic
  python cli.py issue --request musteri.req --customer-name "ACME A.S." -p professional -o acme.lic
  python cli.py gui
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from customer_store import CustomerStore, default_store_path
from license_core import (
    build_payload,
    load_packages,
    load_private_key,
    load_public_key,
    read_lic,
    read_request,
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


def _store(args: argparse.Namespace) -> CustomerStore:
    path = Path(args.store) if getattr(args, "store", None) else default_store_path()
    return CustomerStore(path)


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


def cmd_customer_add(args: argparse.Namespace) -> int:
    store = _store(args)
    try:
        cust = store.add(
            name=args.name,
            contact_email=args.email or "",
            contact_name=args.contact or "",
            notes=args.notes or "",
            default_package=args.package or "professional",
        )
    except ValueError as exc:
        print("HATA:", exc)
        return 1
    print(f"Kaydedildi: {cust['id']}  {cust['name']}")
    return 0


def cmd_customer_list(args: argparse.Namespace) -> int:
    store = _store(args)
    rows = store.list()
    if not rows:
        print("Musteri yok. customer-add ile ekleyin.")
        return 0
    for c in rows:
        nlic = len(c.get("licenses") or [])
        ninst = len(c.get("installations") or [])
        print(f"{c['id']:16}  {c['name']:40}  pkg={c.get('default_package')}  lic={nlic}  inst={ninst}")
    return 0


def cmd_customer_show(args: argparse.Namespace) -> int:
    store = _store(args)
    cust = store.get(args.id) or store.find_by_name(args.id)
    if not cust:
        print("Bulunamadi:", args.id)
        return 1
    print(json.dumps(cust, indent=2, ensure_ascii=False))
    return 0


def _resolve_customer(store: CustomerStore, args: argparse.Namespace, req: dict) -> dict:
    if args.customer_id:
        cust = store.get(args.customer_id)
        if not cust:
            raise ValueError(f"Musteri id yok: {args.customer_id}")
        return cust
    name = args.customer_name or req.get("company") or ""
    cust = store.find_by_name(name) if name else None
    if cust:
        return cust
    if args.auto_create:
        return store.add(
            name=name or "Bilinmeyen",
            contact_email=str(req.get("contact_email") or ""),
            contact_name=str(req.get("contact_name") or ""),
            default_package=str(req.get("requested_package") or "professional"),
        )
    raise ValueError(
        f"Musteri kaydi yok: '{name}'. Once customer-add yapin veya --auto-create kullanin."
    )


def cmd_issue(args: argparse.Namespace) -> int:
    req = read_request(Path(args.request))
    store = _store(args)
    try:
        cust = _resolve_customer(store, args, req)
    except ValueError as exc:
        print("HATA:", exc)
        return 1

    packages = (load_packages(Path(args.packages)).get("packages") or {})
    package = (args.package or req.get("requested_package") or cust.get("default_package") or "professional").strip()
    if package not in packages and not args.force:
        print(f"Bilinmeyen paket: {package}")
        return 1
    pkg = packages.get(package) or {}
    max_users = args.max_users
    max_sessions = args.max_sessions
    if max_users is None and pkg.get("limits"):
        max_users = (pkg["limits"] or {}).get("max_users")
    if max_sessions is None and pkg.get("limits"):
        max_sessions = (pkg["limits"] or {}).get("max_concurrent_sessions")
    enabled = list(pkg.get("enabled_tools") or []) if args.include_tools else None

    payload = build_payload(
        package=package,
        customer=cust["name"],
        expires_at=_expire_iso(args.expires),
        max_users=max_users,
        max_sessions=max_sessions,
        enabled_tools=enabled,
        notes=args.notes or str(req.get("notes") or ""),
        installation_id=str(req.get("installation_id") or ""),
        request_id=str(req.get("request_id") or ""),
        customer_id=cust["id"],
        license_type="commercial",
    )
    priv = load_private_key(Path(args.key) if args.key else None)
    doc = sign_license(payload, priv)
    out = Path(args.output)
    write_lic(out, doc)
    store.record_license(
        cust["id"],
        installation_id=payload.get("installation_id") or "",
        request_id=payload.get("request_id") or "",
        package=package,
        license_key=payload["license_key"],
        expires_at=payload.get("expires_at"),
        lic_path=str(out.resolve()),
    )
    print(f"Yazildi: {out}")
    print(f"  musteri={cust['id']} {cust['name']}")
    print(f"  installation={payload.get('installation_id')}")
    print(f"  request={payload.get('request_id')}")
    print(f"  key={payload['license_key']}  package={package}  expires={payload.get('expires_at')}")
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    """Eski yol — installation_id olmadan (yeni musteriler icin issue kullanin)."""
    packages = (load_packages(Path(args.packages)).get("packages") or {})
    if args.package not in packages and not args.force:
        print(f"Bilinmeyen paket: {args.package}")
        return 1
    pkg = packages.get(args.package) or {}
    max_users = args.max_users
    max_sessions = args.max_sessions
    if max_users is None and pkg.get("limits"):
        max_users = (pkg["limits"] or {}).get("max_users")
    if max_sessions is None and pkg.get("limits"):
        max_sessions = (pkg["limits"] or {}).get("max_concurrent_sessions")
    enabled = list(pkg.get("enabled_tools") or []) if args.include_tools else None
    payload = build_payload(
        package=args.package,
        customer=args.customer,
        expires_at=_expire_iso(args.expires),
        max_users=max_users,
        max_sessions=max_sessions,
        enabled_tools=enabled,
        notes=args.notes or "",
        installation_id=args.installation_id or "",
        license_type="commercial",
    )
    priv = load_private_key(Path(args.key) if args.key else None)
    doc = sign_license(payload, priv)
    out = Path(args.output)
    write_lic(out, doc)
    print(f"Yazildi: {out}  (uyari: .req ile issue tercih edin)")
    print(f"  key={payload['license_key']}  installation={payload.get('installation_id')}")
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
    path = Path(args.file)
    if path.suffix.lower() == ".req":
        print(json.dumps(read_request(path), indent=2, ensure_ascii=False))
        return 0
    doc = read_lic(path)
    print(json.dumps({"v": doc.get("v"), "payload": doc.get("payload"), "has_sig": bool(doc.get("sig"))}, indent=2, ensure_ascii=False))
    return 0


def cmd_show_req(args: argparse.Namespace) -> int:
    print(json.dumps(read_request(Path(args.file)), indent=2, ensure_ascii=False))
    return 0


def cmd_gui(_args: argparse.Namespace) -> int:
    from gui import run_gui

    run_gui()
    return 0


def cmd_keygen(args: argparse.Namespace) -> int:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    priv_path = out / "vendor.ed25519.priv"
    pub_path = out / "vendor.ed25519.pub"
    priv_path.write_bytes(
        priv.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    pub_path.write_bytes(
        pub.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    )
    print(f"Private: {priv_path}")
    print(f"Public:  {pub_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="SecuriPDF-LicenseManager", description="Musteri + lisans yonetimi")
    p.add_argument("--store", help="customers.json yolu", default=str(default_store_path()))
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("packages", help="Paket katalogu")
    sp.add_argument("--packages", default=str(DEFAULT_PACKAGES))
    sp.set_defaults(func=cmd_packages)

    ca = sub.add_parser("customer-add", help="Musteri kaydet")
    ca.add_argument("-n", "--name", required=True)
    ca.add_argument("--email", default="")
    ca.add_argument("--contact", default="")
    ca.add_argument("--notes", default="")
    ca.add_argument("-p", "--package", default="professional")
    ca.set_defaults(func=cmd_customer_add)

    cl = sub.add_parser("customer-list", help="Musterileri listele")
    cl.set_defaults(func=cmd_customer_list)

    cs = sub.add_parser("customer-show", help="Musteri detay")
    cs.add_argument("id", help="CUST-... veya ad")
    cs.set_defaults(func=cmd_customer_show)

    si = sub.add_parser("issue", help=".req talebinden imzali .lic uret")
    si.add_argument("--request", "-r", required=True)
    si.add_argument("--customer-id", default="")
    si.add_argument("--customer-name", default="")
    si.add_argument("--auto-create", action="store_true", help="Musteri yoksa .req sirketinden olustur")
    si.add_argument("-p", "--package", default="")
    si.add_argument("-e", "--expires", help="YYYY-MM-DD")
    si.add_argument("-o", "--output", required=True)
    si.add_argument("--max-users", type=int, default=None)
    si.add_argument("--max-sessions", type=int, default=None)
    si.add_argument("--include-tools", action="store_true")
    si.add_argument("--notes", default="")
    si.add_argument("--key", default="")
    si.add_argument("--packages", default=str(DEFAULT_PACKAGES))
    si.add_argument("--force", action="store_true")
    si.set_defaults(func=cmd_issue)

    sg = sub.add_parser("generate", help="(Eski) Elle .lic uret")
    sg.add_argument("-p", "--package", required=True)
    sg.add_argument("-c", "--customer", required=True)
    sg.add_argument("-e", "--expires")
    sg.add_argument("-o", "--output", required=True)
    sg.add_argument("--installation-id", default="")
    sg.add_argument("--max-users", type=int, default=None)
    sg.add_argument("--max-sessions", type=int, default=None)
    sg.add_argument("--include-tools", action="store_true")
    sg.add_argument("--notes", default="")
    sg.add_argument("--key", default="")
    sg.add_argument("--packages", default=str(DEFAULT_PACKAGES))
    sg.add_argument("--force", action="store_true")
    sg.set_defaults(func=cmd_generate)

    sv = sub.add_parser("verify", help="Imza dogrula")
    sv.add_argument("file")
    sv.add_argument("--pubkey", default="")
    sv.set_defaults(func=cmd_verify)

    sif = sub.add_parser("info", help=".lic veya .req ozeti")
    sif.add_argument("file")
    sif.set_defaults(func=cmd_info)

    sr = sub.add_parser("show-req", help=".req goster")
    sr.add_argument("file")
    sr.set_defaults(func=cmd_show_req)

    sk = sub.add_parser("keygen", help="Anahtar cifti")
    sk.add_argument("-o", "--outdir", default=str(ROOT / "keys"))
    sk.set_defaults(func=cmd_keygen)

    sgui = sub.add_parser("gui", help="Windows arayuz")
    sgui.set_defaults(func=cmd_gui)

    return p


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        argv = ["gui"]
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
