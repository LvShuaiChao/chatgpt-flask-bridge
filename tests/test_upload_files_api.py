"""本地直读上传文件登记与下载 API。"""
from __future__ import annotations

import pytest

from app.server import state as st
from app.server.upload_files import (
    list_upload_files_for_client,
    read_upload_file_bytes,
    register_upload_file,
)


@pytest.fixture(autouse=True)
def _clear_upload_registry():
    with st._state_lock:
        st._upload_files_by_id.clear()
        st._session_upload_file_ids.clear()
        st._client_upload_file_ids.clear()
    yield
    with st._state_lock:
        st._upload_files_by_id.clear()
        st._session_upload_file_ids.clear()
        st._client_upload_file_ids.clear()


def test_register_and_download_upload_file(tmp_path):
    sample = tmp_path / "0_merged_for_chatgpt.zip"
    sample.write_bytes(b"zip-content-test")

    entry = register_upload_file(
        str(sample),
        session_id="sess-1",
        client_id="client-a",
        page_instance_id="page-a",
        base_url="http://127.0.0.1:5000",
    )

    assert entry["file_id"]
    assert entry["name"] == "0_merged_for_chatgpt.zip"
    assert entry["source"] == "flask_local_direct"
    assert "/api/upload_files/" in entry["download_url"]
    assert entry["download_url"].endswith("/content")

    listed = list_upload_files_for_client("client-a", "page-a")
    assert len(listed) == 1
    assert listed[0]["file_id"] == entry["file_id"]

    data, meta = read_upload_file_bytes(entry["file_id"])
    assert data == b"zip-content-test"
    assert meta["name"] == "0_merged_for_chatgpt.zip"


def test_download_rejects_missing_file_on_disk(tmp_path):
    sample = tmp_path / "gone.zip"
    sample.write_bytes(b"zip")
    entry = register_upload_file(str(sample), client_id="c1", page_instance_id="p1")
    sample.unlink()

    with pytest.raises(FileNotFoundError):
        read_upload_file_bytes(entry["file_id"])
