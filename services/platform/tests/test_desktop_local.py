import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from app.auth import AuthUser
from app.routes import desktop


def _user(user_id: str = "u1") -> AuthUser:
    return AuthUser(user_id, None, ["pdf-user"], False, False)


class DesktopLocalRunTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = SimpleNamespace(data_path=Path(self.tmp.name))
        patches = [
            mock.patch.object(desktop, "LicenseService", autospec=True),
            mock.patch.object(desktop, "assert_user_tool_allowed"),
            mock.patch.object(desktop, "write_audit"),
            mock.patch.object(
                desktop, "get_tool_api_path", side_effect=lambda tool: f"/api/v1/general/{tool}"
            ),
        ]
        self.mocks = [p.start() for p in patches]
        self.audit = self.mocks[2]
        for p in patches:
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def _start(self, **body):
        payload = {"toolId": "merge-pdfs", "inputs": [{"field": "fileInput", "sizeBytes": 10}]}
        payload.update(body)
        return desktop.start_local_run(desktop.LocalRunRequest(**payload), _user(), self.settings)

    def test_lists_only_allowed_local_tools(self) -> None:
        with mock.patch.object(desktop, "effective_tool_ids", return_value={"merge-pdfs", "ocr-pdf"}):
            result = desktop.local_tools(_user(), self.settings)
        self.assertEqual(result["tools"], ["merge-pdfs"])

    def test_server_only_tool_is_refused(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            self._start(toolId="ocr-pdf")
        self.assertEqual(caught.exception.status_code, 409)

    def test_split_mode_with_platform_step_is_refused(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            self._start(toolId="split-pages", apiPath="/api/v1/general/split-pdf-by-chapters")
        self.assertEqual(caught.exception.status_code, 409)

    def test_run_is_audited_and_closed_once(self) -> None:
        plan = self._start(formData={"sortType": "orderProvided"})
        self.assertEqual(plan["apiPath"], "/api/v1/general/merge-pdfs")
        self.assertEqual(plan["formData"]["sortType"], "orderProvided")

        done = desktop.finish_local_run(
            plan["runId"], desktop.LocalRunResult(ok=True, outputBytes=42), _user(), self.settings
        )
        self.assertTrue(done["ok"])
        actions = [call.args[2] for call in self.audit.call_args_list]
        self.assertEqual(actions, ["job.local.started", "job.local.completed"])

        with self.assertRaises(HTTPException) as caught:
            desktop.finish_local_run(
                plan["runId"], desktop.LocalRunResult(ok=True), _user(), self.settings
            )
        self.assertEqual(caught.exception.status_code, 409)

    def test_other_user_cannot_close_run(self) -> None:
        plan = self._start()
        with self.assertRaises(HTTPException) as caught:
            desktop.finish_local_run(
                plan["runId"], desktop.LocalRunResult(ok=False), _user("u2"), self.settings
            )
        self.assertEqual(caught.exception.status_code, 404)

    def test_run_id_must_be_a_guid(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            desktop.finish_local_run(
                "../../etc/passwd", desktop.LocalRunResult(ok=True), _user(), self.settings
            )
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
