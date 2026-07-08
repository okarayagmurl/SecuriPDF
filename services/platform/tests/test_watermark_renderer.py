from __future__ import annotations

import unittest

import fitz

from app.watermark_renderer import apply_text_watermark


def _blank_pdf() -> bytes:
    doc = fitz.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


class WatermarkRendererTests(unittest.TestCase):
    def test_tiled_and_diagonal(self) -> None:
        pdf = _blank_pdf()
        for style in ("tiled", "diagonal", "dense", "quad"):
            out = apply_text_watermark(
                pdf,
                text="GİZLİ",
                style_id=style,
                font_size=18,
                opacity=0.4,
                color_hex="#888888",
            )
            self.assertTrue(out.startswith(b"%PDF"))
            self.assertGreater(len(out), 200)

    def test_empty_text_allowed(self) -> None:
        out = apply_text_watermark(
            _blank_pdf(),
            text=" ",
            style_id="tiled",
            font_size=None,
            opacity=0.5,
            color_hex="#d3d3d3",
        )
        self.assertTrue(out.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
