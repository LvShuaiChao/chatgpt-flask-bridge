import importlib


def test_main_window_has_reply_upsert_when_external_api_disabled(monkeypatch):
    monkeypatch.delenv("CHATGPT_BRIDGE_ENABLE_EXTERNAL_API", raising=False)

    import app.ui.main_window as main_window

    main_window = importlib.reload(main_window)

    assert hasattr(main_window.MainWindow, "_upsert_assistant_reply_from_bridge")
