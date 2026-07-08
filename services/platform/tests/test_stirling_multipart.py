from __future__ import annotations

import unittest

import httpx

from app.stirling_form import encode_stirling_multipart


class StirlingMultipartTests(unittest.TestCase):
    def test_url_only_still_multipart(self) -> None:
        parts = encode_stirling_multipart({"urlInput": "https://example.com"}, [])
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0][0], "urlInput")
        req = httpx.Request("POST", "http://test.local/api", files=parts)
        content_type = req.headers.get("content-type", "")
        self.assertIn("multipart/form-data", content_type)
        self.assertNotIn("application/x-www-form-urlencoded", content_type)

    def test_file_plus_fields(self) -> None:
        parts = encode_stirling_multipart(
            {"duplexMode": "false", "prepress": "true"},
            [("fileInput", ("doc.pdf", b"%PDF-1.4", "application/pdf"))],
        )
        names = [p[0] for p in parts]
        self.assertEqual(names[0], "fileInput")
        self.assertIn("duplexMode", names)
        self.assertIn("prepress", names)
        req = httpx.Request("POST", "http://test.local/api", files=parts)
        self.assertIn("multipart/form-data", req.headers.get("content-type", ""))


if __name__ == "__main__":
    unittest.main()
