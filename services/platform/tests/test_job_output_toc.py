from __future__ import annotations

import unittest
from io import BytesIO

from pypdf import PdfWriter

from app.job_output import ensure_filename_ext, filename_stem, output_file_info
from app.pdf_toc import TocError, apply_toc


def _pdf() -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    w.add_blank_page(width=200, height=200)
    buf = BytesIO()
    w.write(buf)
    return buf.getvalue()


class JobOutputNamingTests(unittest.TestCase):
    def test_strip_double_extension(self) -> None:
        self.assertEqual(filename_stem("deneme.docx.pdf"), "deneme")
        self.assertEqual(ensure_filename_ext("deneme.docx.pdf", ".pdf"), "deneme.pdf")
        self.assertEqual(ensure_filename_ext("rapor.pptx.pdf", ".pptx"), "rapor.pptx")

    def test_convert_to_pdf_uses_pdf_name(self) -> None:
        data = _pdf()
        info = output_file_info(data, "convert", {"outputFormat": "pdf", "toExt": "pdf"})
        self.assertEqual(info["ext"], ".pdf")
        self.assertTrue(info["default_name"].endswith(".pdf"))

    def test_pdf_content_overrides_wrong_docx_label(self) -> None:
        data = _pdf()
        info = output_file_info(data, "pdf-to-word", {"outputFormat": "docx"})
        self.assertEqual(info["ext"], ".pdf")


class TocTests(unittest.TestCase):
    def test_apply_toc_writes_bookmarks(self) -> None:
        import fitz

        out = apply_toc(
            _pdf(),
            '[{"title":"Bolum 1","pageNumber":1,"children":[{"title":"Alt","page":2}]}]',
        )
        doc = fitz.open(stream=out, filetype="pdf")
        try:
            toc = doc.get_toc()
            self.assertGreaterEqual(len(toc), 2)
            self.assertEqual(toc[0][1], "Bolum 1")
            self.assertEqual(toc[0][2], 1)
        finally:
            doc.close()

    def test_empty_toc_fails(self) -> None:
        with self.assertRaises(TocError) as ctx:
            apply_toc(_pdf(), "[]")
        self.assertEqual(ctx.exception.code, "TOC_EMPTY")


if __name__ == "__main__":
    unittest.main()
