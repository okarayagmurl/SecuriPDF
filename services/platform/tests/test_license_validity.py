from __future__ import annotations

import unittest

from app.license import LicenseService


def _svc(config: dict, packages: dict | None = None) -> LicenseService:
    svc = LicenseService.__new__(LicenseService)
    svc._config = config
    svc._packages = packages or {
        "packages": {
            "starter": {"label": "Başlangıç", "enabled_tools": ["merge-pdfs"]},
            "enterprise": {"label": "Kurumsal", "enabled_tools": []},
        }
    }
    return svc


class LicenseValidityTests(unittest.TestCase):
    def test_unsigned_enterprise_is_not_valid(self) -> None:
        svc = _svc(
            {
                "package": "enterprise",
                "enabled_tools": ["merge-pdfs", "ocr-pdf"],
                "license_key": "SECURIPDF-DEV-ENTERPRISE-2026",
                "expires_at": "2027-12-31T23:59:59Z",
            }
        )
        status = svc.status()
        self.assertEqual(status["licenseType"], "none")
        self.assertFalse(status["valid"])

    def test_self_selected_legacy_package_is_not_valid(self) -> None:
        svc = _svc(
            {
                "package": "starter",
                "license_type": "legacy",
                "enabled_tools": ["merge-pdfs"],
                "expires_at": "2027-12-31T23:59:59Z",
            }
        )
        self.assertFalse(svc.status()["valid"])

    def test_commercial_license_with_installation_is_valid(self) -> None:
        svc = _svc(
            {
                "package": "starter",
                "license_type": "commercial",
                "installation_id": "SPDF-INST-B4C9C7AB35B04D48",
                "enabled_tools": ["merge-pdfs"],
                "expires_at": "2027-12-31T23:59:59Z",
            }
        )
        status = svc.status()
        self.assertTrue(status["valid"])
        self.assertEqual(status["enabledTools"], ["merge-pdfs"])

    def test_commercial_without_installation_is_rejected(self) -> None:
        svc = _svc(
            {
                "package": "starter",
                "license_type": "commercial",
                "enabled_tools": ["merge-pdfs"],
                "expires_at": "2027-12-31T23:59:59Z",
            }
        )
        self.assertFalse(svc.status()["valid"])


if __name__ == "__main__":
    unittest.main()
