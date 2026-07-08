from __future__ import annotations

import unittest

from app.stirling_form import normalize_stirling_form


class StirlingFormTests(unittest.TestCase):
    def test_convert_keeps_camel_case(self) -> None:
        data = normalize_stirling_form(
            "convert",
            {
                "outputFormat": "docx",
                "imageFormat": "png",
                "fitOption": "maintainAspectRatio",
                "singleOrMultiple": "multiple",
                "colorType": "color",
                "autoRotate": "true",
            },
        )
        self.assertEqual(data["outputFormat"], "docx")
        self.assertEqual(data["imageFormat"], "png")
        self.assertEqual(data["fitOption"], "maintainAspectRatio")
        self.assertEqual(data["singleOrMultiple"], "multiple")
        self.assertEqual(data["colorType"], "color")
        self.assertEqual(data["autoRotate"], "true")

    def test_add_image_drops_platform_fields(self) -> None:
        data = normalize_stirling_form(
            "add-image",
            {
                "x": "10",
                "y": "20",
                "pageNumber": "2",
                "imageScalePercent": "80",
                "everyPage": "false",
            },
        )
        self.assertNotIn("pageNumber", data)
        self.assertNotIn("imageScalePercent", data)
        self.assertEqual(data["everyPage"], "false")

    def test_cert_sign_keeps_page_number_and_required_bools(self) -> None:
        data = normalize_stirling_form(
            "cert-sign",
            {"pageNumber": "3", "certType": "PKCS12", "showSignature": "true"},
        )
        self.assertEqual(data["pageNumber"], "3")
        self.assertEqual(data["showSignature"], "true")
        self.assertEqual(data["showLogo"], "false")
        self.assertEqual(data["password"], "")
        self.assertEqual(data["certType"], "PKCS12")

    def test_cert_sign_pfx_maps_to_pkcs12(self) -> None:
        data = normalize_stirling_form("cert-sign", {"certType": "PFX"})
        self.assertEqual(data["certType"], "PKCS12")

    def test_cert_sign_password_always_string(self) -> None:
        data = normalize_stirling_form("cert-sign", {"certType": "PKCS12", "password": None})
        self.assertEqual(data["password"], "")
        self.assertEqual(data["reason"], "")
        self.assertEqual(data["location"], "")
        self.assertEqual(data["name"], "")

    def test_cbr_optimize_default(self) -> None:
        data = normalize_stirling_form("cbr-to-pdf", {})
        self.assertEqual(data["optimizeForEbook"], "false")

    def test_vector_to_pdf_drops_format_fields_and_sets_prepress(self) -> None:
        data = normalize_stirling_form("vector-to-pdf", {"outputFormat": "pcl", "inputFormat": "eps"})
        self.assertNotIn("outputFormat", data)
        self.assertNotIn("inputFormat", data)
        self.assertEqual(data["prepress"], "false")

    def test_ebook_to_pdf_required_booleans(self) -> None:
        data = normalize_stirling_form("ebook-to-pdf", {"optimizeForEbook": "on"})
        self.assertEqual(data["embedAllFonts"], "false")
        self.assertEqual(data["includeTableOfContents"], "false")
        self.assertEqual(data["includePageNumbers"], "false")
        self.assertEqual(data["optimizeForEbook"], "true")

    def test_sanitize_pdf_boolean_defaults(self) -> None:
        data = normalize_stirling_form("sanitize-pdf", {"removeLinks": "on"})
        self.assertEqual(data["removeJavaScript"], "true")
        self.assertEqual(data["removeEmbeddedFiles"], "true")
        self.assertEqual(data["removeLinks"], "true")
        self.assertEqual(data["removeFonts"], "false")

    def test_url_to_pdf_keeps_only_url(self) -> None:
        data = normalize_stirling_form(
            "url-to-pdf",
            {"urlInput": " https://example.com ", "fileInput": "should-drop", "fileId": "x"},
        )
        self.assertEqual(data["urlInput"], "https://example.com")
        self.assertNotIn("fileInput", data)
        self.assertNotIn("fileId", data)

    def test_auto_split_duplex_default(self) -> None:
        data = normalize_stirling_form("auto-split-pdf", {})
        self.assertEqual(data["duplexMode"], "false")

    def test_compress_mutual_exclusion(self) -> None:
        data = normalize_stirling_form(
            "compress-pdf",
            {"optimizeLevel": "3", "expectedOutputSize": "10MB", "grayscale": "on"},
        )
        self.assertNotIn("optimizeLevel", data)
        self.assertEqual(data["expectedOutputSize"], "10MB")
        self.assertEqual(data["grayscale"], "true")

    def test_compress_level_when_no_target_size(self) -> None:
        data = normalize_stirling_form(
            "compress-pdf",
            {"optimizeLevel": "4", "expectedOutputSize": "", "linearize": "false"},
        )
        self.assertEqual(data["optimizeLevel"], "4")
        self.assertNotIn("expectedOutputSize", data)
        self.assertEqual(data["linearize"], "false")

    def test_auto_rename_fallback_flag(self) -> None:
        data = normalize_stirling_form("auto-rename", {"useFirstTextAsFallback": "on"})
        self.assertEqual(data["useFirstTextAsFallback"], "true")


if __name__ == "__main__":
    unittest.main()
