from __future__ import annotations

import threading
import time

from .config import Settings
from .vault_retention import purge_expired_documents

_worker: RetentionWorker | None = None


class RetentionWorker:
    def __init__(self, settings: Settings, session_factory, interval_seconds: float = 60.0) -> None:
        self._settings = settings
        self._session_factory = session_factory
        self._interval = interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="securipdf-retention-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            db = self._session_factory()
            try:
                moved = purge_expired_documents(db, self._settings)
                if moved:
                    print(f"[retention] {moved} belge arsive tasindi")
            except Exception as exc:
                print(f"[retention-worker] {exc}")
            finally:
                db.close()
            self._stop.wait(self._interval)


def start_retention_worker(settings: Settings, session_factory) -> RetentionWorker:
    global _worker
    _worker = RetentionWorker(settings, session_factory)
    _worker.start()
    return _worker


def stop_retention_worker() -> None:
    global _worker
    if _worker:
        _worker.stop()
        _worker = None
