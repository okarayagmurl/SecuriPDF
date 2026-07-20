from __future__ import annotations

import unittest
from io import BytesIO
from zipfile import ZipFile

from app.document_names import resolve_document_filename
from app.pdf_cbz import CbzError, cbz_to_pdf
from app.pdf_validate import is_valid_pdf


class DocumentNamingTests(unittest.TestCase):
    def test_office_mime_does_not_append_pdf(self) -> None:
        name, mime = resolve_document_filename(
            "rapor.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        self.assertEqual(name, "rapor.docx")
        self.assertIn("wordprocessingml", mime)

    def test_strips_double_extension_for_pdf(self) -> None:
        name, mime = resolve_document_filename(
            "standart_doküman.docx.pdf",
            "application/pdf",
            b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
        )
        self.assertEqual(name, "standart_doküman.pdf")
        self.assertEqual(mime, "application/pdf")

    def test_content_docx_overrides_pdf_suffix(self) -> None:
        buf = BytesIO()
        with ZipFile(buf, "w") as zf:
            zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
            zf.writestr("word/document.xml", "<w:document/>")
        data = buf.getvalue()
        name, mime = resolve_document_filename("x.docx.pdf", "application/pdf", data)
        self.assertEqual(name, "x.docx")
        self.assertIn("wordprocessingml", mime)


class CbzTests(unittest.TestCase):
    def test_cbz_to_pdf(self) -> None:
        import fitz

        # Tiny PNG via pymupdf
        img_doc = fitz.open()
        page = img_doc.new_page(width=40, height=40)
        page.draw_rect(page.rect, color=(1, 0, 0), fill=(1, 0, 0))
        png = page.get_pixmap().tobytes("png")
        img_doc.close()

        zbuf = BytesIO()
        with ZipFile(zbuf, "w") as zf:
            zf.writestr("001.png", png)
        pdf = cbz_to_pdf(zbuf.getvalue())
        self.assertTrue(is_valid_pdf(pdf))

    def test_cbz_not_zip(self) -> None:
        with self.assertRaises(CbzError) as ctx:
            cbz_to_pdf(b"not-a-zip")
        self.assertEqual(ctx.exception.code, "CBZ_NOT_ZIP")


if __name__ == "__main__":
    unittest.main()
