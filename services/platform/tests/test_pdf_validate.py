from __future__ import annotations

import unittest

from app.pdf_validate import is_valid_pdf, output_error_code


class PdfValidateTests(unittest.TestCase):
    def test_empty_output(self) -> None:
        self.assertEqual(output_error_code(b"", "cert-sign"), "OUTPUT_EMPTY")
        self.assertEqual(output_error_code(None, "merge-pdfs"), "OUTPUT_EMPTY")

    def test_invalid_cert_sign(self) -> None:
        self.assertEqual(output_error_code(b"not a pdf", "cert-sign"), "CERT_SIGN_INVALID_OUTPUT")

    def test_valid_pdf_ok(self) -> None:
        import fitz

        doc = fitz.open()
        doc.new_page()
        data = doc.tobytes()
        doc.close()
        self.assertTrue(is_valid_pdf(data))
        self.assertIsNone(output_error_code(data, "cert-sign"))


if __name__ == "__main__":
    unittest.main()
