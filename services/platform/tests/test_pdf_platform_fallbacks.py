from __future__ import annotations

import unittest
import zipfile
from io import BytesIO

import fitz

from app.pdf_autosplit import split_pdf_on_blank_pages
from app.pdf_sanitize import sanitize_pdf_bytes
from app.watermark_renderer import apply_image_watermark


def _pdf_with_blank_middle() -> bytes:
    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text((72, 72), "Birinci belge")
    doc.new_page()  # blank divider
    p3 = doc.new_page()
    p3.insert_text((72, 72), "Ikinci belge")
    data = doc.tobytes()
    doc.close()
    return data


def _tiny_png() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=40, height=40)
    page.draw_rect(page.rect, color=(0.2, 0.2, 0.8), fill=(0.2, 0.2, 0.8))
    pix = page.get_pixmap()
    png = pix.tobytes("png")
    doc.close()
    return png


class PdfSanitizeTests(unittest.TestCase):
    def test_keeps_pdf_valid(self) -> None:
        src = _pdf_with_blank_middle()
        out = sanitize_pdf_bytes(src, {"removeJavaScript": "true", "removeEmbeddedFiles": "true"})
        self.assertTrue(out.startswith(b"%PDF"))
        doc = fitz.open(stream=out, filetype="pdf")
        self.assertEqual(doc.page_count, 3)
        text = doc[0].get_text()
        self.assertIn("Birinci", text)
        doc.close()


class PdfAutosplitTests(unittest.TestCase):
    def test_blank_middle_splits_zip(self) -> None:
        zip_bytes = split_pdf_on_blank_pages(_pdf_with_blank_middle())
        self.assertIsNotNone(zip_bytes)
        assert zip_bytes is not None
        with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            self.assertEqual(len(names), 2)
            self.assertTrue(all(n.endswith(".pdf") for n in names))


class ImageWatermarkTests(unittest.TestCase):
    def test_image_overlay(self) -> None:
        doc = fitz.open()
        doc.new_page()
        pdf = doc.tobytes()
        doc.close()
        out = apply_image_watermark(pdf, _tiny_png(), style_id="tiled", opacity=0.4)
        self.assertTrue(out.startswith(b"%PDF"))
        self.assertGreater(len(out), len(pdf))


if __name__ == "__main__":
    unittest.main()
