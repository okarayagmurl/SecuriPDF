from __future__ import annotations

import json
from datetime import datetime, timezone

from .audit_privacy import sanitize_audit_detail
from .audit_privacy import sanitize_audit_entry
from .config import Settings
from .user_directory import resolve_user_labels

USER_ACTION_LABELS: dict[str, str] = {
    "document.job_import": "Araç çıktısı belgelere eklendi",
    "document.upload": "Belge yüklendi",
    "document.delete": "Belge silindi",
    "document.archive": "Arşive taşındı",
    "document.restore": "Belgelerden geri alındı",
    "document.pin": "Belge sabitlendi",
    "document.unpin": "Sabitleme kaldırıldı",
    "document.email": "E-posta ile gönderildi",
    "document.email.upload": "Yüklenen belge e-postalandı",
    "folder.create": "Klasör oluşturuldu",
    "job.queued": "PDF işi kuyruğa alındı",
    "job.completed": "PDF işi tamamlandı",
    "job.failed": "PDF işi başarısız",
}


def _action_label(action: str) -> str:
    return USER_ACTION_LABELS.get(action, action)


def read_document_activity(
    settings: Settings,
    user_id: str,
    document_id: str,
    limit: int = 100,
) -> list[dict]:
    """Kullanicinin kendi belgesi icin islem gecmisi (KVKK: yalnizca sahip gorur)."""
    if not settings.audit_log_path.exists():
        return []

    doc_prefix = "document."
    items: list[dict] = []
    with settings.audit_log_path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("userId") != user_id:
                continue
            action = str(entry.get("action") or "")
            if not action.startswith(doc_prefix) and action not in ("folder.create",):
                continue
            resource = entry.get("resource")
            detail = entry.get("detail") if isinstance(entry.get("detail"), dict) else {}
            doc_ref = detail.get("documentRef") or resource
            if doc_ref != document_id and resource != document_id:
                continue
            user_detail = dict(detail)
            if action == "document.email":
                user_detail["channel"] = "email"
            items.append(
                {
                    "timestamp": entry.get("timestamp"),
                    "action": action,
                    "label": _action_label(action),
                    "documentGuid": document_id,
                    "detail": user_detail,
                }
            )

    items.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return items[:limit]


def write_audit(settings: Settings, user_id: str, action: str, resource: str, detail: dict | None = None) -> None:
    settings.audit_log_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "userId": user_id,
        "action": action,
        "resource": resource,
        "detail": sanitize_audit_detail(detail),
    }
    with settings.audit_log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def read_audit(
    settings: Settings,
    user_id: str | None = None,
    action: str | None = None,
    action_prefix: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    page: int = 1,
    size: int = 50,
) -> dict:
    if not settings.audit_log_path.exists():
        return {"items": [], "total": 0, "page": page, "size": size}

    from_dt = _parse_iso(from_ts)
    to_dt = _parse_iso(to_ts)

    items: list[dict] = []
    with settings.audit_log_path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if user_id and entry.get("userId") != user_id:
                continue
            entry_action = str(entry.get("action") or "")
            if action and entry_action != action:
                continue
            if action_prefix and not entry_action.startswith(action_prefix):
                continue
            ts = _parse_iso(entry.get("timestamp"))
            if from_dt and ts and ts < from_dt:
                continue
            if to_dt and ts and ts > to_dt:
                continue
            items.append(sanitize_audit_entry(entry))

    items.reverse()
    total = len(items)
    start = (page - 1) * size
    end = start + size
    page_items = items[start:end]
    user_ids = {str(i.get("userId")) for i in page_items if i.get("userId")}
    labels = resolve_user_labels(settings, user_ids)
    for item in page_items:
        uid = str(item.get("userId") or "")
        item["userLabel"] = labels.get(uid, uid or "—")
    return {"items": page_items, "total": total, "page": page, "size": size}
