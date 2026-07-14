from __future__ import annotations

import datetime
import unittest

import fitz
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app.pdf_cert_sign import CertSignError, sign_pdf_pkcs12
from app.pdf_validate import is_valid_pdf


def _tiny_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Test belgesi")
    data = doc.tobytes()
    doc.close()
    return data


def _test_p12(password: str = "test-pass") -> bytes:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "SecuriPDF Test"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SecuriPDF"),
        ]
    )
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30))
        .sign(key, hashes.SHA256())
    )
    return serialization.pkcs12.serialize_key_and_certificates(
        b"securipdf-test",
        key,
        cert,
        None,
        serialization.BestAvailableEncryption(password.encode("utf-8")),
    )


class PdfCertSignTests(unittest.TestCase):
    def test_pkcs12_sign_produces_valid_pdf(self) -> None:
        pdf = _tiny_pdf()
        p12 = _test_p12()
        signed = sign_pdf_pkcs12(
            pdf,
            p12,
            "test-pass",
            page_number=1,
            show_signature=True,
            reason="SecuriPDF ile imzalandi",
            location="TR",
            name="Tester",
        )
        self.assertTrue(signed.startswith(b"%PDF"))
        self.assertTrue(is_valid_pdf(signed))
        self.assertGreater(len(signed), len(pdf))
        doc = fitz.open(stream=signed, filetype="pdf")
        self.assertEqual(doc.page_count, 1)
        doc.close()

    def test_visible_vs_invisible_both_open(self) -> None:
        pdf = _tiny_pdf()
        p12 = _test_p12()
        for visible in (False, True):
            signed = sign_pdf_pkcs12(
                pdf, p12, "test-pass", show_signature=visible, reason="QA"
            )
            self.assertTrue(is_valid_pdf(signed))
            doc = fitz.open(stream=signed, filetype="pdf")
            doc.close()

    def test_wrong_password_fails(self) -> None:
        with self.assertRaises(CertSignError) as ctx:
            sign_pdf_pkcs12(_tiny_pdf(), _test_p12(), "wrong")
        self.assertEqual(ctx.exception.code, "CERT_SIGN_KEY_LOAD_FAILED")

    def test_page_out_of_range_fails(self) -> None:
        with self.assertRaises(CertSignError) as ctx:
            sign_pdf_pkcs12(_tiny_pdf(), _test_p12("test-pass"), "test-pass", page_number=9)
        self.assertEqual(ctx.exception.code, "CERT_SIGN_PAGE_OUT_OF_RANGE")


if __name__ == "__main__":
    unittest.main()
