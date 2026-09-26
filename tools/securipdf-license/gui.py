"""SecuriPDF License Manager — basit Tk arayuzu."""

from __future__ import annotations

import tkinter as tk
from pathlib import Path
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


class LicenseApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("SecuriPDF License Manager")
        self.geometry("720x520")
        self.store = CustomerStore(default_store_path())
        self.req_path: Path | None = None
        self.req_data: dict | None = None

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=8, pady=8)

        self.tab_cust = ttk.Frame(nb)
        self.tab_issue = ttk.Frame(nb)
        nb.add(self.tab_cust, text="Musteriler")
        nb.add(self.tab_issue, text="Lisans uret (.req)")

        self._build_customers()
        self._build_issue()
        self.refresh_customers()

    def _build_customers(self) -> None:
        frm = self.tab_cust
        row = ttk.Frame(frm)
        row.pack(fill="x", padx=8, pady=8)
        ttk.Label(row, text="Ad").pack(side="left")
        self.ent_name = ttk.Entry(row, width=28)
        self.ent_name.pack(side="left", padx=4)
        ttk.Label(row, text="E-posta").pack(side="left")
        self.ent_email = ttk.Entry(row, width=24)
        self.ent_email.pack(side="left", padx=4)
        ttk.Button(row, text="Kaydet", command=self.add_customer).pack(side="left", padx=4)
        ttk.Button(row, text="Yenile", command=self.refresh_customers).pack(side="left")

        cols = ("id", "name", "package", "licenses")
        self.tree = ttk.Treeview(frm, columns=cols, show="headings", height=16)
        for c, t, w in (
            ("id", "ID", 140),
            ("name", "Musteri", 220),
            ("package", "Paket", 100),
            ("licenses", "Lisans", 60),
        ):
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w)
        self.tree.pack(fill="both", expand=True, padx=8, pady=8)

    def _build_issue(self) -> None:
        frm = self.tab_issue
        top = ttk.Frame(frm)
        top.pack(fill="x", padx=8, pady=8)
        ttk.Button(top, text=".req sec…", command=self.pick_req).pack(side="left")
        self.lbl_req = ttk.Label(top, text="Talep secilmedi")
        self.lbl_req.pack(side="left", padx=8)

        self.txt_req = tk.Text(frm, height=10, wrap="word")
        self.txt_req.pack(fill="both", expand=True, padx=8)

        opts = ttk.Frame(frm)
        opts.pack(fill="x", padx=8, pady=4)
        ttk.Label(opts, text="Paket").pack(side="left")
        self.cmb_pkg = ttk.Combobox(opts, values=["starter", "professional", "enterprise"], width=16)
        self.cmb_pkg.set("professional")
        self.cmb_pkg.pack(side="left", padx=4)
        ttk.Label(opts, text="Bitis (YYYY-MM-DD)").pack(side="left")
        self.ent_exp = ttk.Entry(opts, width=14)
        self.ent_exp.pack(side="left", padx=4)
        self.var_auto = tk.BooleanVar(value=True)
        ttk.Checkbutton(opts, text="Musteri yoksa olustur", variable=self.var_auto).pack(side="left", padx=8)

        bot = ttk.Frame(frm)
        bot.pack(fill="x", padx=8, pady=8)
        ttk.Button(bot, text="Lisans uret (.lic)", command=self.issue_license).pack(side="left")

    def refresh_customers(self) -> None:
        for i in self.tree.get_children():
            self.tree.delete(i)
        for c in self.store.list():
            self.tree.insert(
                "",
                "end",
                values=(c["id"], c["name"], c.get("default_package"), len(c.get("licenses") or [])),
            )

    def add_customer(self) -> None:
        name = self.ent_name.get().strip()
        try:
            self.store.add(name=name, contact_email=self.ent_email.get().strip())
        except ValueError as exc:
            messagebox.showerror("Hata", str(exc))
            return
        self.ent_name.delete(0, "end")
        self.ent_email.delete(0, "end")
        self.refresh_customers()
        messagebox.showinfo("OK", f"Musteri kaydedildi: {name}")

    def pick_req(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("License request", "*.req"), ("JSON", "*.json"), ("All", "*.*")])
        if not path:
            return
        try:
            self.req_data = read_request(Path(path))
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Hata", str(exc))
            return
        self.req_path = Path(path)
        self.lbl_req.config(text=str(self.req_path.name))
        self.txt_req.delete("1.0", "end")
        import json

        self.txt_req.insert("1.0", json.dumps(self.req_data, indent=2, ensure_ascii=False))
        pkg = self.req_data.get("requested_package") or "professional"
        if pkg in self.cmb_pkg["values"]:
            self.cmb_pkg.set(pkg)

    def issue_license(self) -> None:
        if not self.req_data:
            messagebox.showerror("Hata", "Once .req secin")
            return
        name = str(self.req_data.get("company") or "").strip()
        cust = self.store.find_by_name(name)
        if not cust:
            if not self.var_auto.get():
                messagebox.showerror("Hata", f"Musteri yok: {name}")
                return
            cust = self.store.add(
                name=name or "Bilinmeyen",
                contact_email=str(self.req_data.get("contact_email") or ""),
                contact_name=str(self.req_data.get("contact_name") or ""),
                default_package=self.cmb_pkg.get(),
            )
            self.refresh_customers()

        out = filedialog.asksaveasfilename(
            defaultextension=".lic",
            filetypes=[("License", "*.lic")],
            initialfile=f"{cust['id']}.lic",
        )
        if not out:
            return
        packages = (load_packages(PACKAGES).get("packages") or {})
        package = self.cmb_pkg.get().strip()
        pkg = packages.get(package) or {}
        limits = pkg.get("limits") or {}
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
            installation_id=str(self.req_data.get("installation_id") or ""),
            request_id=str(self.req_data.get("request_id") or ""),
            customer_id=cust["id"],
            license_type="commercial",
        )
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
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Hata", str(exc))
            return
        self.refresh_customers()
        messagebox.showinfo("OK", f"Lisans yazildi:\n{out}\n{payload['license_key']}")


def run_gui() -> None:
    app = LicenseApp()
    app.mainloop()


if __name__ == "__main__":
    run_gui()
