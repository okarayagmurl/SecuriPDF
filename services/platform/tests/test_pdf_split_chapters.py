from __future__ import annotations

import unittest
from io import BytesIO
from zipfile import ZipFile

import fitz

from app.pdf_split_chapters import SplitChaptersError, split_pdf_by_chapters
from app.pdf_validate import is_valid_pdf


def _pdf_with_toc() -> bytes:
    doc = fitz.open()
    for _ in range(6):
        doc.new_page(width=200, height=200)
    doc.set_toc(
        [
            [1, "Bolum A", 1],
            [2, "Alt A1", 2],
            [1, "Bolum B", 4],
            [1, "Bolum C", 6],
        ]
    )
    data = doc.tobytes()
    doc.close()
    return data


class SplitChaptersTests(unittest.TestCase):
    def test_split_top_level(self) -> None:
        zdata = split_pdf_by_chapters(_pdf_with_toc(), bookmark_level=0)
        with ZipFile(BytesIO(zdata)) as zf:
            names = zf.namelist()
            self.assertGreaterEqual(len(names), 3)
            for name in names:
                self.assertTrue(name.lower().endswith(".pdf"))
                self.assertTrue(is_valid_pdf(zf.read(name)))

    def test_no_bookmarks(self) -> None:
        doc = fitz.open()
        doc.new_page()
        data = doc.tobytes()
        doc.close()
        with self.assertRaises(SplitChaptersError) as ctx:
            split_pdf_by_chapters(data)
        self.assertEqual(ctx.exception.code, "SPLIT_NO_BOOKMARKS")

    def test_level_filter(self) -> None:
        # Level 0: only top (A,B,C) — not Alt A1 as separate if deduped by page
        zdata = split_pdf_by_chapters(_pdf_with_toc(), bookmark_level=0, allow_duplicates=False)
        with ZipFile(BytesIO(zdata)) as zf:
            self.assertGreaterEqual(len(zf.namelist()), 3)


if __name__ == "__main__":
    unittest.main()
