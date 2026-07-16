from __future__ import annotations

import unittest
from io import BytesIO

from pypdf import PdfReader, PdfWriter

from app.pdf_permissions import PermissionsError, change_permissions
from app.pdf_validate import output_error_code
from app.stirling_form import normalize_stirling_form


def _simple_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


class QaFixesTests(unittest.TestCase):
    def test_line_art_reaches_stirling(self) -> None:
        data = normalize_stirling_form("compress-pdf", {"lineArt": "on", "optimizeLevel": "4"})
        self.assertEqual(data["lineArt"], "true")
        self.assertEqual(data["optimizeLevel"], "4")

    def test_hex_color_to_decimal(self) -> None:
        data = normalize_stirling_form(
            "replace-invert-pdf",
            {
                "replaceAndInvertOption": "CUSTOM_COLOR",
                "backGroundColor": "#000000",
                "textColor": "#FFFFFF",
            },
        )
        self.assertEqual(data["backGroundColor"], "0")
        self.assertEqual(data["textColor"], str(0xFFFFFF))

    def test_bookmark_page_to_page_number(self) -> None:
        import json

        data = normalize_stirling_form(
            "edit-table-of-contents",
            {"bookmarkData": '[{"title":"A","page":2,"children":[{"title":"B","page":3}]}]'},
        )
        parsed = json.loads(data["bookmarkData"])
        self.assertEqual(parsed[0]["pageNumber"], 2)
        self.assertNotIn("page", parsed[0])
        self.assertEqual(parsed[0]["children"][0]["pageNumber"], 3)

    def test_scanner_rotation_default(self) -> None:
        data = normalize_stirling_form("scanner-effect", {"quality": "high", "yellowish": "on"})
        self.assertEqual(data["rotation"], "slight")
        self.assertEqual(data["quality"], "high")
        self.assertEqual(data["yellowish"], "true")

    def test_change_permissions_sets_encryption(self) -> None:
        out = change_permissions(
            _simple_pdf(),
            {
                "ownerPassword": "owner-secret",
                "preventPrinting": "true",
                "preventExtractContent": "true",
            },
        )
        reader = PdfReader(BytesIO(out), strict=False)
        self.assertTrue(reader.is_encrypted)
        self.assertNotEqual(reader.decrypt("owner-secret"), 0)

    def test_change_permissions_requires_owner(self) -> None:
        with self.assertRaises(PermissionsError) as ctx:
            change_permissions(_simple_pdf(), {})
        self.assertEqual(ctx.exception.code, "PERMISSIONS_OWNER_PASSWORD_MISSING")

    def test_validate_signature_rejects_pdf(self) -> None:
        self.assertEqual(output_error_code(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "validate-signature"), "VALIDATE_SIGNATURE_PDF_OUTPUT")

    def test_extract_empty_zip(self) -> None:
        # Minimal empty zip
        empty_zip = (
            b"PK\x05\x06" + b"\x00" * 18
        )
        self.assertEqual(output_error_code(empty_zip, "extract-images"), "EXTRACT_EMPTY")


if __name__ == "__main__":
    unittest.main()
