from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.debug_report import write_job_debug_report


class DebugReportTests(unittest.TestCase):
    @patch("app.debug_report.is_debug_mode", return_value=True)
    def test_html_body_yields_hint_and_url(self, _debug: object) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = SimpleNamespace(data_path=Path(tmp))
            body = b"<html><body><h1>Internal Server Error</h1><p>WeasyPrint failed</p></body></html>"
            report = write_job_debug_report(
                settings,
                report_id="RPT-TEST-001",
                job_id="job-1",
                user_id="u1",
                tool_id="url-to-pdf",
                status="failed",
                error_code="STIRLING_HTTP_500",
                created_at=None,
                completed_at=None,
                stirling_status=500,
                stirling_body=body,
                form_data={"urlInput": "https://example.com"},
            )
            self.assertIn("publicHint", report)
            self.assertIn("example.com", report["publicHint"])
            self.assertEqual(report["formContext"]["urlInput"], "https://example.com")


if __name__ == "__main__":
    unittest.main()
