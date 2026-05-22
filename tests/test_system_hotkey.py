"""系统快捷键 API：本机限制、解析与白名单按键。"""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def server_module():
    import importlib
    import server as srv

    return importlib.reload(srv)


def test_parse_hotkey_for_pyautogui_ctrl_alt_i(server_module):
    keys = server_module._parse_hotkey_for_pyautogui("Ctrl+Alt+I")
    assert keys == ["ctrl", "alt", "i"]


def test_parse_hotkey_rejects_unknown_key(server_module):
    with pytest.raises(ValueError, match="不支持的快捷键按键"):
        server_module._parse_hotkey_for_pyautogui("Ctrl+Alt+Evil")


def test_execute_system_hotkey_rate_limited(server_module):
    server_module._LAST_SYSTEM_HOTKEY_AT = server_module.time.time()
    result = server_module.execute_system_hotkey("Ctrl+Alt+I")
    assert result["ok"] is False
    assert result["code"] == "HOTKEY_RATE_LIMITED"


def test_execute_system_hotkey_success(server_module):
    logged = []
    server_module._log = lambda msg, tag="", level=None: logged.append(msg)
    server_module._LAST_SYSTEM_HOTKEY_AT = 0.0

    mock_pyautogui = MagicMock()
    with patch.dict("sys.modules", {"pyautogui": mock_pyautogui}):
        result = server_module.execute_system_hotkey("Ctrl+Alt+I")

    assert result["ok"] is True
    assert result["keys"] == ["ctrl", "alt", "i"]
    mock_pyautogui.hotkey.assert_called_once_with("ctrl", "alt", "i")
    assert any("[SYSTEM_HOTKEY][OK]" in line for line in logged)


def test_api_v1_system_hotkey_local_only(server_module):
    logged = []
    server_module._log = lambda msg, tag="", level=None: logged.append(msg)
    server_module.API_TOKEN = ""

    client = server_module.app.test_client()
    response = client.post(
        "/api/v1/system/hotkey",
        json={"source": "pytest", "hotkey": "Ctrl+Alt+I"},
        environ_overrides={"REMOTE_ADDR": "8.8.8.8"},
    )

    assert response.status_code == 403
    data = response.get_json()
    assert data["ok"] is False
    assert data["code"] == "LOCAL_ONLY"


def test_api_v1_system_hotkey_ok(server_module):
    server_module.API_TOKEN = ""
    server_module._LAST_SYSTEM_HOTKEY_AT = 0.0

    mock_pyautogui = MagicMock()
    with patch.dict("sys.modules", {"pyautogui": mock_pyautogui}):
        client = server_module.app.test_client()
        response = client.post(
            "/api/v1/system/hotkey",
            json={"source": "pytest", "hotkey": "Ctrl+Alt+I"},
        )

    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["keys"] == ["ctrl", "alt", "i"]
    assert data["source"] == "pytest"
