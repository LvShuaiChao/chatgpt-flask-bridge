"""GUI 注册的本地直读上传文件：登记、列表与受控下载。"""
from __future__ import annotations

import mimetypes
import traceback
import uuid
from pathlib import Path

from flask import Response, jsonify, request

from app.server import state as st
from app.server.runtime_state import _log, _now

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DIR = PROJECT_ROOT / "runtime"


def _client_key(client_id: str, page_instance_id: str) -> str:
    return f"{(client_id or '').strip()}|{(page_instance_id or '').strip()}"


def _resolve_registered_path(path_text: str) -> Path:
    """登记时解析用户/GUI 提供的本地路径（仅服务端调用，不暴露给前端任意下载）。"""
    raw = (path_text or "").strip()
    if not raw:
        raise ValueError("path 不能为空")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = (PROJECT_ROOT / candidate).resolve()
    else:
        candidate = candidate.resolve()
    if not candidate.is_file():
        raise FileNotFoundError(f"文件不存在：{candidate}")
    return candidate


def _resolve_stored_upload_path(entry: dict) -> Path:
    """下载时只信任登记记录中的 path，忽略请求参数里的任意路径。"""
    if not isinstance(entry, dict):
        raise FileNotFoundError("上传文件记录无效")
    stored = (entry.get("path") or "").strip()
    if not stored:
        raise FileNotFoundError("上传文件记录缺少 path")
    candidate = Path(stored).resolve()
    if not candidate.is_file():
        raise FileNotFoundError(f"登记文件已不存在：{candidate}")
    return candidate


def _public_base_url() -> str:
    host = (st._server_public_host or "127.0.0.1").strip() or "127.0.0.1"
    port = int(st._server_port or 5000)
    return f"http://{host}:{port}"


def _file_public_meta(entry: dict, base_url: str | None = None) -> dict:
    base = (base_url or _public_base_url()).rstrip("/")
    file_id = (entry.get("file_id") or "").strip()
    name = entry.get("name") or "upload.bin"
    return {
        "file_id": file_id,
        "name": name,
        "size": int(entry.get("size") or 0),
        "source": "flask_local_direct",
        "mime_type": entry.get("mime_type") or "application/octet-stream",
        "download_url": f"{base}/api/upload_files/{file_id}/content",
        "status": entry.get("status") or "pending",
    }


def register_upload_file(
    path_text: str,
    *,
    session_id: str = "",
    client_id: str = "",
    page_instance_id: str = "",
    base_url: str | None = None,
) -> dict:
    resolved = _resolve_registered_path(path_text)
    file_id = f"uf_{uuid.uuid4().hex}"
    mime_type = (
        mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
    )
    now = _now()
    entry = {
        "file_id": file_id,
        "name": resolved.name,
        "size": resolved.stat().st_size,
        "path": str(resolved),
        "mime_type": mime_type,
        "session_id": (session_id or "").strip(),
        "client_id": (client_id or "").strip(),
        "page_instance_id": (page_instance_id or "").strip(),
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }
    with st._state_lock:
        st._upload_files_by_id[file_id] = entry
        sid = entry["session_id"]
        if sid:
            bucket = st._session_upload_file_ids.setdefault(sid, [])
            if file_id not in bucket:
                bucket.append(file_id)
        ckey = _client_key(entry["client_id"], entry["page_instance_id"])
        if ckey.strip("|"):
            cbucket = st._client_upload_file_ids.setdefault(ckey, [])
            if file_id not in cbucket:
                cbucket.append(file_id)
    _log(
        "[UPLOAD_FILES][REGISTER] "
        f"file_id={file_id} name={entry['name']} size={entry['size']} "
        f"session_id={entry['session_id'] or '-'} client_id={entry['client_id'] or '-'}"
    )
    return _file_public_meta(entry, base_url)


def list_upload_files_for_client(
    client_id: str,
    page_instance_id: str,
    *,
    base_url: str | None = None,
) -> list[dict]:
    ckey = _client_key(client_id, page_instance_id)
    with st._state_lock:
        ids = list(st._client_upload_file_ids.get(ckey) or [])
        entries = [
            st._upload_files_by_id.get(fid)
            for fid in ids
        ]
    result = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if (entry.get("status") or "") == "uploaded":
            continue
        result.append(_file_public_meta(entry, base_url))
    return result


def mark_upload_files_uploaded(file_ids: list[str]) -> None:
    now = _now()
    with st._state_lock:
        for fid in file_ids or []:
            entry = st._upload_files_by_id.get((fid or "").strip())
            if not isinstance(entry, dict):
                continue
            entry["status"] = "uploaded"
            entry["updated_at"] = now


def get_upload_file_entry(file_id: str) -> dict | None:
    fid = (file_id or "").strip()
    if not fid:
        return None
    with st._state_lock:
        entry = st._upload_files_by_id.get(fid)
    return dict(entry) if isinstance(entry, dict) else None


def read_upload_file_bytes(file_id: str) -> tuple[bytes, dict]:
    entry = get_upload_file_entry(file_id)
    if not entry:
        raise FileNotFoundError(f"未知 file_id：{file_id}")
    resolved = _resolve_stored_upload_path(entry)
    data = resolved.read_bytes()
    return data, entry


def upload_files_patch_for_poll(body: dict) -> dict:
    if not isinstance(body, dict):
        return {}
    client_id = (body.get("client_id") or "").strip()
    page_instance_id = (body.get("page_instance_id") or "").strip()
    if not client_id:
        return {}
    files = list_upload_files_for_client(client_id, page_instance_id)
    return {"upload_files": files}


def api_register_upload_file():
    body = request.get_json(silent=True) or {}
    path_text = (body.get("path") or body.get("file_path") or "").strip()
    if not path_text:
        return jsonify({"ok": False, "error": "缺少 path"}), 400
    try:
        entry = register_upload_file(
            path_text,
            session_id=(body.get("session_id") or "").strip(),
            client_id=(body.get("client_id") or "").strip(),
            page_instance_id=(body.get("page_instance_id") or "").strip(),
        )
        return jsonify({"ok": True, "file": entry})
    except FileNotFoundError as error:
        _log(
            "[UPLOAD_FILES][REGISTER][404] "
            f"path={path_text!r} error_type={type(error).__name__} error={error}"
        )
        return jsonify({"ok": False, "error": str(error)}), 404
    except ValueError as error:
        _log(
            "[UPLOAD_FILES][REGISTER][400] "
            f"path={path_text!r} error_type={type(error).__name__} error={error}"
        )
        return jsonify({"ok": False, "error": str(error)}), 400
    except OSError as error:
        _log(
            "[UPLOAD_FILES][REGISTER][500] "
            f"path={path_text!r} error_type={type(error).__name__} error={error}\n"
            f"{traceback.format_exc()}"
        )
        return jsonify({"ok": False, "error": str(error)}), 500


def api_download_upload_file(file_id: str):
    fid = (file_id or "").strip()
    try:
        data, entry = read_upload_file_bytes(fid)
    except FileNotFoundError as error:
        _log(
            "[UPLOAD_FILES][DOWNLOAD][404] "
            f"file_id={fid} error_type={type(error).__name__} error={error}"
        )
        return jsonify({"ok": False, "error": str(error)}), 404
    except ValueError as error:
        _log(
            "[UPLOAD_FILES][DOWNLOAD][400] "
            f"file_id={fid} error_type={type(error).__name__} error={error}"
        )
        return jsonify({"ok": False, "error": str(error)}), 400
    except OSError as error:
        _log(
            "[UPLOAD_FILES][DOWNLOAD][500] "
            f"file_id={fid} error_type={type(error).__name__} error={error}\n"
            f"{traceback.format_exc()}"
        )
        return jsonify({"ok": False, "error": str(error)}), 500

    name = entry.get("name") or "upload.bin"
    mime_type = entry.get("mime_type") or "application/octet-stream"
    response = Response(data, mimetype=mime_type)
    response.headers["Content-Disposition"] = f'attachment; filename="{name}"'
    response.headers["Content-Length"] = str(len(data))
    return response
