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

    def test_cert_sign_keeps_page_number(self) -> None:
        data = normalize_stirling_form(
            "cert-sign",
            {"pageNumber": "3", "certType": "PKCS12", "showSignature": "true"},
        )
        self.assertEqual(data["pageNumber"], "3")
        self.assertEqual(data["showSignature"], "true")

    def test_vector_to_pdf_maps_input_format(self) -> None:
        data = normalize_stirling_form("vector-to-pdf", {"outputFormat": "pcl"})
        self.assertEqual(data["inputFormat"], "pcl")
        self.assertNotIn("outputFormat", data)

    def test_sanitize_pdf_boolean_defaults(self) -> None:
        data = normalize_stirling_form("sanitize-pdf", {"removeLinks": "on"})
        self.assertEqual(data["removeJavaScript"], "true")
        self.assertEqual(data["removeEmbeddedFiles"], "true")
        self.assertEqual(data["removeLinks"], "true")
        self.assertEqual(data["removeFonts"], "false")

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
