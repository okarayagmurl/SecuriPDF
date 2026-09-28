"""SecuriPDF License Manager — musteri kaydi ve imzali .lic uretimi."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from customer_store import CustomerStore, default_store_path
from license_core import (
    build_payload,
    load_packages,
    load_private_key,
    read_request,
    sign_license,
    write_lic,
)

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
PACKAGES = REPO / "config" / "license-packages.yml"


def _default_expiry() -> str:
    day = datetime.now(timezone.utc).date() + timedelta(days=365)
    return day.isoformat()


def _short_date(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return "—"
    return text[:10]


class LicenseApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("SecuriPDF License Manager")
        self.geometry("1180x760")
        self.minsize(980, 640)
        self.store = CustomerStore(default_store_path())
        self.req_path: Path | None = None
        self.req_data: dict | None = None
        self.packages = (load_packages(PACKAGES).get("packages") or {})
        self.package_ids = [key for key in ("starter", "professional", "enterprise") if key in self.packages] or [
            "starter",
            "professional",
            "enterprise",
        ]

        self._build()
        self.refresh_all()

    def _build(self) -> None:
        top = ttk.Frame(self)
        top.pack(fill="x", padx=10, pady=(10, 4))
        ttk.Label(top, text="Ara").pack(side="left")
        self.ent_search = ttk.Entry(top, width=36)
        self.ent_search.pack(side="left", padx=6)
        self.ent_search.bind("<KeyRelease>", lambda _e: self.refresh_all(keep_selection=True))
        ttk.Button(top, text="Yenile", command=self.refresh_all).pack(side="left")
        self.lbl_status = ttk.Label(top, text="")
        self.lbl_status.pack(side="right")

        body = ttk.Panedwindow(self, orient="horizontal")
        body.pack(fill="both", expand=True, padx=10, pady=4)

        left = ttk.Frame(body)
        right = ttk.Frame(body)
        body.add(left, weight=2)
        body.add(right, weight=3)

        ttk.Label(left, text="Müşteriler").pack(anchor="w")
        cols = ("name", "email", "package", "count")
        self.tree = ttk.Treeview(left, columns=cols, show="headings", height=14)
        for key, title, width in (
            ("name", "Müşteri", 180),
            ("email", "E-posta", 160),
            ("package", "Paket", 100),
            ("count", "Lisans", 60),
        ):
            self.tree.heading(key, text=title)
            self.tree.column(key, width=width, anchor="w")
        self.tree.pack(fill="both", expand=True, pady=(4, 6))
        self.tree.bind("<<TreeviewSelect>>", self.on_select_customer)

        add = ttk.Frame(left)
        add.pack(fill="x")
        self.ent_name = ttk.Entry(add, width=22)
        self.ent_name.pack(side="left")
        self.ent_email = ttk.Entry(add, width=22)
        self.ent_email.pack(side="left", padx=4)
        ttk.Button(add, text="Müşteri ekle", command=self.add_customer).pack(side="left")

        edit = ttk.LabelFrame(right, text="Seçili müşteri")
        edit.pack(fill="x", pady=(0, 8))
        grid = ttk.Frame(edit)
        grid.pack(fill="x", padx=8, pady=8)
        self.lbl_cust = ttk.Label(grid, text="Listeden müşteri seçin")
        self.lbl_cust.grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 6))
        ttk.Label(grid, text="Ad").grid(row=1, column=0, sticky="w")
        self.ent_rename = ttk.Entry(grid, width=28)
        self.ent_rename.grid(row=1, column=1, sticky="we", padx=(4, 12))
        ttk.Label(grid, text="E-posta").grid(row=1, column=2, sticky="w")
        self.ent_edit_email = ttk.Entry(grid, width=28)
        self.ent_edit_email.grid(row=1, column=3, sticky="we", padx=(4, 0))
        ttk.Label(grid, text="İletişim").grid(row=2, column=0, sticky="w", pady=(6, 0))
        self.ent_contact = ttk.Entry(grid, width=28)
        self.ent_contact.grid(row=2, column=1, sticky="we", padx=(4, 12), pady=(6, 0))
        ttk.Label(grid, text="Not").grid(row=2, column=2, sticky="w", pady=(6, 0))
        self.ent_notes = ttk.Entry(grid, width=28)
        self.ent_notes.grid(row=2, column=3, sticky="we", padx=(4, 0), pady=(6, 0))
        grid.columnconfigure(1, weight=1)
        grid.columnconfigure(3, weight=1)
        ttk.Button(edit, text="Müşteriyi kaydet", command=self.save_customer).pack(anchor="w", padx=8, pady=(0, 8))

        lic_head = ttk.Frame(self)
        lic_head.pack(fill="x", padx=10)
        ttk.Label(lic_head, text="Verilen lisanslar").pack(side="left")
        self.var_only_selected = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            lic_head,
            text="Yalnızca seçili müşteri",
            variable=self.var_only_selected,
            command=self.refresh_licenses,
        ).pack(side="left", padx=12)

        lic_wrap = ttk.Frame(self)
        lic_wrap.pack(fill="both", expand=True, padx=10, pady=(4, 4))
        lic_cols = ("customer", "package", "key", "install", "request", "issued", "expires")
        self.lic_tree = ttk.Treeview(lic_wrap, columns=lic_cols, show="headings", height=8)
        for key, title, width in (
            ("customer", "Müşteri", 160),
            ("package", "Paket", 110),
            ("key", "Lisans anahtarı", 280),
            ("install", "Kurulum", 220),
            ("request", "Talep", 160),
            ("issued", "Veriliş", 100),
            ("expires", "Bitiş", 100),
        ):
            self.lic_tree.heading(key, text=title)
            self.lic_tree.column(key, width=width, anchor="w")
        scroll = ttk.Scrollbar(lic_wrap, orient="vertical", command=self.lic_tree.yview)
        self.lic_tree.configure(yscrollcommand=scroll.set)
        self.lic_tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.lic_tree.bind("<Double-1>", self.copy_license_key)

        issue = ttk.LabelFrame(self, text="Talep dosyasından lisans üret")
        issue.pack(fill="x", padx=10, pady=(4, 10))
        row = ttk.Frame(issue)
        row.pack(fill="x", padx=8, pady=8)
        ttk.Button(row, text=".req seç…", command=self.pick_req).pack(side="left")
        self.lbl_req = ttk.Label(row, text="Talep seçilmedi")
        self.lbl_req.pack(side="left", padx=8)
        ttk.Label(row, text="Paket").pack(side="left", padx=(12, 0))
        self.cmb_pkg = ttk.Combobox(row, values=self.package_ids, width=16, state="readonly")
        self.cmb_pkg.set("professional" if "professional" in self.package_ids else self.package_ids[0])
        self.cmb_pkg.pack(side="left", padx=4)
        ttk.Label(row, text="Bitiş").pack(side="left")
        self.ent_exp = ttk.Entry(row, width=12)
        self.ent_exp.insert(0, _default_expiry())
        self.ent_exp.pack(side="left", padx=4)
        self.var_auto = tk.BooleanVar(value=True)
        ttk.Checkbutton(row, text="Müşteri yoksa oluştur", variable=self.var_auto).pack(side="left", padx=8)
        ttk.Button(row, text="Lisans üret (.lic)", command=self.issue_license).pack(side="right")
        self.lbl_req_facts = ttk.Label(issue, text="Şirket, kurulum ve talep burada görünür.", wraplength=1100)
        self.lbl_req_facts.pack(anchor="w", padx=8, pady=(0, 8))

    def _query(self) -> str:
        return self.ent_search.get().strip().lower()

    def _matches(self, *parts: object) -> bool:
        query = self._query()
        if not query:
            return True
        blob = " ".join(str(part or "") for part in parts).lower()
        return all(word in blob for word in query.split())

    def refresh_all(self, keep_selection: bool = False) -> None:
        selected = self._selected_customer_id() if keep_selection else None
        self.refresh_customers()
        if selected and self.tree.exists(selected):
            self.tree.selection_set(selected)
            self.tree.see(selected)
            self.on_select_customer()
        self.refresh_licenses()

    def refresh_customers(self) -> None:
        for item in self.tree.get_children():
            self.tree.delete(item)
        try:
            rows = self.store.list()
        except (json.JSONDecodeError, ValueError, OSError) as exc:
            messagebox.showerror("Müşteri dosyası", str(exc))
            return
        shown = 0
        for cust in rows:
            if not self._matches(cust.get("id"), cust.get("name"), cust.get("contact_email"), cust.get("contact_name")):
                continue
            self.tree.insert(
                "",
                "end",
                iid=cust["id"],
                values=(
                    cust.get("name") or "",
                    cust.get("contact_email") or "",
                    cust.get("default_package") or "",
                    len(cust.get("licenses") or []),
                ),
            )
            shown += 1
        self.lbl_status.config(text=f"{shown} müşteri")

    def refresh_licenses(self) -> None:
        for item in self.lic_tree.get_children():
            self.lic_tree.delete(item)
        selected = self._selected_customer_id() if self.var_only_selected.get() else None
        try:
            rows = self.store.all_licenses()
        except (json.JSONDecodeError, ValueError, OSError) as exc:
            messagebox.showerror("Müşteri dosyası", str(exc))
            return
        for lic in rows:
            if selected and lic.get("customer_id") != selected:
                continue
            if not self._matches(
                lic.get("customer_name"),
                lic.get("package"),
                lic.get("license_key"),
                lic.get("installation_id"),
                lic.get("request_id"),
            ):
                continue
            self.lic_tree.insert(
                "",
                "end",
                values=(
                    lic.get("customer_name") or "",
                    lic.get("package") or "",
                    lic.get("license_key") or "",
                    lic.get("installation_id") or "",
                    lic.get("request_id") or "",
                    _short_date(lic.get("issued_at")),
                    _short_date(lic.get("expires_at")),
                ),
            )

    def _selected_customer_id(self) -> str | None:
        sel = self.tree.selection()
        return sel[0] if sel else None

    def on_select_customer(self, _event: object = None) -> None:
        cid = self._selected_customer_id()
        if not cid:
            return
        cust = self.store.get(cid)
        if not cust:
            return
        self.lbl_cust.config(text=cid)
        self._set_entry(self.ent_rename, str(cust.get("name") or ""))
        self._set_entry(self.ent_edit_email, str(cust.get("contact_email") or ""))
        self._set_entry(self.ent_contact, str(cust.get("contact_name") or ""))
        self._set_entry(self.ent_notes, str(cust.get("notes") or ""))
        if self.var_only_selected.get():
            self.refresh_licenses()

    def _set_entry(self, entry: ttk.Entry, value: str) -> None:
        entry.delete(0, "end")
        entry.insert(0, value)

    def add_customer(self) -> None:
        name = self.ent_name.get().strip()
        try:
            cust = self.store.add(name=name, contact_email=self.ent_email.get().strip())
        except ValueError as exc:
            messagebox.showerror("Hata", str(exc))
            return
        self.ent_name.delete(0, "end")
        self.ent_email.delete(0, "end")
        self.refresh_all()
        if self.tree.exists(cust["id"]):
            self.tree.selection_set(cust["id"])
            self.on_select_customer()
        self.lbl_status.config(text=f"Müşteri kaydedildi: {cust['name']}")

    def save_customer(self) -> None:
        cid = self._selected_customer_id()
        if not cid:
            messagebox.showerror("Hata", "Önce listeden müşteri seçin")
            return
        try:
            cust = self.store.update(
                cid,
                name=self.ent_rename.get(),
                contact_email=self.ent_edit_email.get(),
                contact_name=self.ent_contact.get(),
                notes=self.ent_notes.get(),
            )
        except ValueError as exc:
            messagebox.showerror("Hata", str(exc))
            return
        self.refresh_all()
        if self.tree.exists(cid):
            self.tree.selection_set(cid)
            self.tree.see(cid)
        self.on_select_customer()
        self.lbl_status.config(text=f"Müşteri güncellendi: {cust['name']}")

    def copy_license_key(self, _event: object = None) -> None:
        sel = self.lic_tree.selection()
        if not sel:
            return
        values = self.lic_tree.item(sel[0], "values")
        if len(values) < 3 or not values[2]:
            return
        self.clipboard_clear()
        self.clipboard_append(values[2])
        self.lbl_status.config(text=f"Anahtar kopyalandı: {values[2]}")

    def pick_req(self) -> None:
        path = filedialog.askopenfilename(
            filetypes=[("License request", "*.req"), ("JSON", "*.json"), ("All", "*.*")]
        )
        if not path:
            return
        try:
            data = read_request(Path(path))
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Hata", str(exc))
            return
        self.req_data = data
        self.req_path = Path(path)
        self.lbl_req.config(text=self.req_path.name)
        pkg = str(data.get("requested_package") or "professional")
        if pkg in self.package_ids:
            self.cmb_pkg.set(pkg)
        facts = [
            f"Şirket: {data.get('company') or '—'}",
            f"İletişim: {data.get('contact_name') or '—'}",
            f"E-posta: {data.get('contact_email') or '—'}",
            f"Paket: {pkg}",
            f"Kurulum: {data.get('installation_id') or '—'}",
            f"Talep: {data.get('request_id') or '—'}",
            f"Sunucu: {data.get('public_fqdn') or data.get('server_ip') or '—'}",
        ]
        self.lbl_req_facts.config(text="   ·   ".join(facts))

    def issue_license(self) -> None:
        if not self.req_data:
            messagebox.showerror("Hata", "Önce .req seçin")
            return
        name = str(self.req_data.get("company") or "").strip()
        cust = self.store.find_by_name(name)
        if not cust:
            if not self.var_auto.get():
                messagebox.showerror("Hata", f"Müşteri yok: {name}")
                return
            cust = self.store.add(
                name=name or "Bilinmeyen",
                contact_email=str(self.req_data.get("contact_email") or ""),
                contact_name=str(self.req_data.get("contact_name") or ""),
                notes=str(self.req_data.get("notes") or ""),
                default_package=self.cmb_pkg.get(),
            )
        package = self.cmb_pkg.get().strip()
        pkg = self.packages.get(package) or {}
        limits = pkg.get("limits") or {}
        tools = list(pkg.get("enabled_tools") or [])
        exp = self.ent_exp.get().strip()
        expires = None
        if exp:
            expires = exp if "T" in exp else f"{exp}T23:59:59Z"
        payload = build_payload(
            package=package,
            customer=cust["name"],
            expires_at=expires,
            max_users=limits.get("max_users"),
            max_sessions=limits.get("max_concurrent_sessions"),
            enabled_tools=tools or None,
            notes=str(self.req_data.get("notes") or ""),
            installation_id=str(self.req_data.get("installation_id") or ""),
            request_id=str(self.req_data.get("request_id") or ""),
            customer_id=cust["id"],
            license_type="commercial",
        )
        out = filedialog.asksaveasfilename(
            defaultextension=".lic",
            filetypes=[("License", "*.lic")],
            initialfile=f"{self.req_data.get('request_id') or cust['id']}.lic",
        )
        if not out:
            return
        try:
            priv = load_private_key()
            doc = sign_license(payload, priv)
            write_lic(Path(out), doc)
            self.store.record_license(
                cust["id"],
                installation_id=payload.get("installation_id") or "",
                request_id=payload.get("request_id") or "",
                package=package,
                license_key=payload["license_key"],
                expires_at=payload.get("expires_at"),
                lic_path=str(Path(out).resolve()),
            )
            if cust.get("default_package") != package:
                self.store.update(cust["id"], default_package=package)
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Hata", str(exc))
            return
        self.refresh_all()
        if self.tree.exists(cust["id"]):
            self.tree.selection_set(cust["id"])
            self.on_select_customer()
        messagebox.showinfo("Lisans yazıldı", f"{out}\n{payload['license_key']}")


def run_gui() -> None:
    app = LicenseApp()
    app.mainloop()


if __name__ == "__main__":
    run_gui()
