import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.settings_store import SettingsStore
from app.tls_certs import certificate_dns_names, create_csr, install_certificate, preferred_https_host, status


class TlsCertTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old = os.environ.get("SECURIPDF_TLS_DIR")
        self.dir = Path(self.id().replace(".", "_"))
        root = Path(__file__).resolve().parent / "_tls_tmp" / self.dir
        root.mkdir(parents=True, exist_ok=True)
        os.environ["SECURIPDF_TLS_DIR"] = str(root)
        self.root = root

    def tearDown(self) -> None:
        if self._old is None:
            os.environ.pop("SECURIPDF_TLS_DIR", None)
        else:
            os.environ["SECURIPDF_TLS_DIR"] = self._old

    def test_csr_then_matching_certificate(self) -> None:
        info = create_csr("pdf.example.com", ["pdf.example.com", "giris.example.com"], ["192.168.6.176"], "Ornek")
        self.assertTrue(info["hasCsr"])
        self.assertFalse(info["hasCertificate"])
        self.assertIn("192.168.6.176", info["ipAddresses"])
        key = serialization.load_pem_private_key((self.root / "securipdf.key").read_bytes(), password=None)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "pdf.example.com")])
        now = datetime.now(timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(1)
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=30))
            .sign(key, hashes.SHA256())
        )
        installed = install_certificate(cert.public_bytes(serialization.Encoding.PEM).decode("ascii"))
        self.assertTrue(installed["hasCertificate"])
        self.assertIn("pdf.example.com", installed["certificateSubject"])
        self.assertGreater(status()["daysRemaining"], 20)

    def test_install_with_supplied_key(self) -> None:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "securipdf.int.entera.net")])
        now = datetime.now(timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(2)
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=10))
            .sign(key, hashes.SHA256())
        )
        key_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ).decode("ascii")
        installed = install_certificate(
            cert.public_bytes(serialization.Encoding.PEM).decode("ascii"),
            private_key_pem=key_pem,
        )
        self.assertTrue(installed["hasCertificate"])
        self.assertTrue(installed["hasKey"])
        san = x509.SubjectAlternativeName([x509.DNSName("securipdf.int.entera.net")])
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(3)
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=10))
            .add_extension(san, critical=False)
            .sign(key, hashes.SHA256())
        )
        install_certificate(cert.public_bytes(serialization.Encoding.PEM).decode("ascii"), private_key_pem=key_pem)
        self.assertEqual(certificate_dns_names(), ["securipdf.int.entera.net"])
        self.assertEqual(preferred_https_host("192.168.6.176", "192.168.6.176"), "securipdf.int.entera.net")
        self.assertEqual(preferred_https_host("pdf.example.com", "192.168.6.176"), "pdf.example.com")

    def test_https_urls_cover_app_and_keycloak(self) -> None:
        urls = SettingsStore.deployment_access_urls(
            {
                "public_fqdn": "pdf.example.com",
                "server_ip": "10.1.1.5",
                "keycloak_fqdn": "pdf.example.com",
                "use_https": True,
                "https_port": 443,
                "keycloak_https_port": 8443,
            }
        )
        self.assertEqual(urls["app_url"], "https://pdf.example.com")
        self.assertEqual(urls["keycloak_admin_url"], "https://pdf.example.com:8443")
        self.assertTrue(urls["oauth_issuer_url"].startswith("https://pdf.example.com:8443/realms/"))


if __name__ == "__main__":
    unittest.main()
