from __future__ import annotations

import unittest

from app.url_to_pdf import _inject_base_href


class UrlToPdfTests(unittest.TestCase):
    def test_inject_base_into_head(self) -> None:
        html = "<html><head><title>x</title></head><body><p>Hi</p></body></html>"
        out = _inject_base_href(html, "https://example.com/page")
        self.assertIn('<base href="https://example.com/">', out)

    def test_wrap_fragment(self) -> None:
        out = _inject_base_href("<p>Hi</p>", "https://example.com/")
        self.assertIn("<base href=", out)
        self.assertIn("<body>", out)


if __name__ == "__main__":
    unittest.main()
