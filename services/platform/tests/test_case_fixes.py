"""Test case düzeltmeleri: karartma konumu, görsel, meta, imza, ek."""

from __future__ import annotations

import unittest
import zipfile
from io import BytesIO

import fitz

from app.pdf_attachments import extract_embedded_attachments
from app.pdf_images import extract_pdf_images
from app.pdf_metadata import auto_rename_pdf, update_pdf_metadata
from app.pdf_place_image import place_image_on_pdf
from app.pdf_sanitize import sanitize_pdf_bytes
from app.pdf_signatures import remove_cert_signatures
from app.pdf_validate import is_valid_pdf
from app.redaction_renderer import apply_pdf_redactions_from_form


def _png(color: tuple[int, int, int], size: int = 40) -> bytes:
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, size, size), 0)
    pix.set_rect(pix.irect, color)
    data = pix.tobytes("png")
    return data


def _sample_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    bg = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 100, 140), 0)
    bg.set_rect(bg.irect, (255, 255, 255))
    page.insert_image(page.rect, pixmap=bg)
    page.insert_text((72, 120), "TEL NO: 5335747342", fontsize=16)
    page.insert_text((72, 400), "BEKLEYEN SATIR", fontsize=16)
    page.insert_link({"kind": fitz.LINK_URI, "from": fitz.Rect(72, 140, 200, 160), "uri": "https://example.com"})
    doc.set_metadata({"title": "Kurumsal Rapor", "author": "Eski Yazar"})
    doc.embfile_add("not.txt", b"gizli-ek", filename="not.txt", ufilename="not.txt", desc="ek")
    data = doc.tobytes()
    doc.close()
    return data


def _pixel(pdf: bytes, x: int, y: int) -> tuple[int, int, int]:
    doc = fitz.open(stream=pdf, filetype="pdf")
    try:
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
        return pix.pixel(x, y)
    finally:
        doc.close()


class RedactionPlacementTests(unittest.TestCase):
    def test_black_box_covers_phone_not_page_bottom(self) -> None:
        src = _sample_pdf()
        out = apply_pdf_redactions_from_form(
            src,
            ["mobile_tr"],
            "",
            {"convertPDFToImage": "true", "customPadding": "0"},
        )
        doc = fitz.open(stream=out, filetype="pdf")
        text = doc[0].get_text("text")
        doc.close()
        self.assertNotIn("5335747342", text)
        phone = _pixel(out, 150, 112)
        other = _pixel(out, 80, 392)
        bottom = _pixel(out, 297, 800)
        self.assertLess(phone[0], 40)
        self.assertLess(other[0], 80)
        self.assertGreater(bottom[0], 200)


class ImagePlacementTests(unittest.TestCase):
    def test_click_near_top_stays_near_top(self) -> None:
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        page.draw_rect(page.rect, color=(1, 1, 1), fill=(1, 1, 1))
        src = doc.tobytes()
        doc.close()
        out = place_image_on_pdf(src, _png((255, 0, 0), 30), x=200, y=100, page_number=1, scale_percent=100)
        top = _pixel(out, 200, 100)
        bottom = _pixel(out, 297, 800)
        self.assertGreater(top[0], 200)
        self.assertLess(top[1], 40)
        self.assertGreater(bottom[0], 200)
        self.assertGreater(bottom[1], 200)
        self.assertGreater(bottom[2], 200)


class MetadataTests(unittest.TestCase):
    def test_update_writes_title(self) -> None:
        out = update_pdf_metadata(_sample_pdf(), {"title": "Yeni Baslik", "author": "Ayse"})
        doc = fitz.open(stream=out, filetype="pdf")
        meta = doc.metadata
        doc.close()
        self.assertEqual(meta["title"], "Yeni Baslik")
        self.assertEqual(meta["author"], "Ayse")

    def test_auto_rename_uses_title(self) -> None:
        data, name = auto_rename_pdf(_sample_pdf(), {})
        self.assertEqual(name, "Kurumsal Rapor.pdf")
        self.assertTrue(data.startswith(b"%PDF"))


class SanitizeTests(unittest.TestCase):
    def test_default_clears_metadata_links_and_files(self) -> None:
        out = sanitize_pdf_bytes(_sample_pdf(), {})
        doc = fitz.open(stream=out, filetype="pdf")
        try:
            self.assertEqual(doc.embfile_count(), 0)
            self.assertFalse(doc[0].get_links())
            self.assertFalse((doc.metadata or {}).get("title"))
            self.assertIn("TEL", doc[0].get_text("text"))
        finally:
            doc.close()


class SignatureTests(unittest.TestCase):
    def test_signature_object_removed(self) -> None:
        doc = fitz.open()
        page = doc.new_page()
        sig = doc.get_new_xref()
        doc.update_object(
            sig,
            "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached "
            "/ByteRange [0 10 20 30] /Contents <00> >>",
        )
        widget = doc.get_new_xref()
        doc.update_object(
            widget,
            f"<< /Type /Annot /Subtype /Widget /FT /Sig /T (Imza1) /Rect [72 72 220 120] /V {sig} 0 R >>",
        )
        doc.xref_set_key(page.xref, "Annots", f"[{widget} 0 R]")
        doc.xref_set_key(doc.pdf_catalog(), "AcroForm", f"<< /Fields [{widget} 0 R] /SigFlags 3 >>")
        raw = doc.tobytes()
        doc.close()
        self.assertIn(b"/ByteRange", raw)
        out = remove_cert_signatures(raw)
        self.assertTrue(is_valid_pdf(out))
        self.assertNotIn(b"/ByteRange", out)
        self.assertNotIn(b"/Type /Sig", out)
        self.assertNotIn(b"/Type/Sig", out)


class ExtractTests(unittest.TestCase):
    def test_embedded_file_and_image(self) -> None:
        blob = extract_embedded_attachments(_sample_pdf())
        with zipfile.ZipFile(BytesIO(blob)) as zf:
            names = zf.namelist()
        self.assertTrue(any(n.startswith("not") for n in names))

    def test_images_zip(self) -> None:
        blob = extract_pdf_images(_sample_pdf(), "png")
        with zipfile.ZipFile(BytesIO(blob)) as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
        self.assertGreaterEqual(len(names), 1)


if __name__ == "__main__":
    unittest.main()
