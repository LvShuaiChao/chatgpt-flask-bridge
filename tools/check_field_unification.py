from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CHECKS = [
    {
        "name": "message_queue_page_id_must_not_fallback_page_instance_id",
        "path": "app/server/message_queue_core/models.py",
        "bad": 'page_id=str(data.get("page_id") or data.get("page_instance_id") or "")',
        "hint": "MessageQueueItem.from_dict 里 page_id 不能 fallback page_instance_id，应改为 page_id/page_display_id/page_no。",
    },
    {
        "name": "button_state_send_phase_must_not_use_reply_state_directly",
        "path": "chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js",
        "bad": "const sendPhase = String(reply.state || 'unknown');",
        "hint": "sendPhase 必须优先 task.sendPhase / task.phase，不能直接等于 reply.state。",
    },
    {
        "name": "top_button_state_must_not_duplicate_authority_reply_text",
        "path": "chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js",
        "bad_count_more_than": {
            "text": "authorityReplyText:",
            "max_count": 1,
        },
        "hint": "同一个 TOP_BUTTON_STATE payload 内 authorityReplyText 不能重复定义，应拆成 unifiedReplyText/statusReplyText。",
    },
    {
        "name": "page_sync_state_should_not_use_legacy_primary_fields",
        "path": "app/ui/page_sync/state.py",
        "bad_any": [
            "page_id: str = \"\"",
            "inputable: bool = False",
            "sendable: bool = False",
        ],
        "hint": "PageSyncState 主字段应改为 page_display_id/page_instance_id/can_accept_input/can_send_now，旧字段用 property 兼容。",
    },
    {
        "name": "bridge_mixin_should_not_use_is_responding_directly_1",
        "path": "app/ui/mixins/bridge_mixin.py",
        "bad": 'if client_info.get("is_responding"):',
        "hint": "bridge_mixin 必须优先 response_state in BUSY_RESPONSE_STATES，is_responding 只能在 response_state unknown 时兜底。",
    },
    {
        "name": "bridge_mixin_should_not_use_is_responding_directly_2",
        "path": "app/ui/mixins/bridge_mixin.py",
        "bad": 'if bool(response_state.get("is_responding")):',
        "hint": "bridge_mixin 不能直接用 is_responding 判断 responding。",
    },
    {
        "name": "page_bind_should_not_use_send_now_available_as_primary",
        "path": "app/ui/mixins/page_bind_mixin.py",
        "bad": 'if profile.get("send_now_available") or profile.get("send_requestable"):',
        "hint": "page_bind_mixin 应优先 send_decision/can_send_now，send_now_available 只能 legacy fallback。",
    },
    {
        "name": "page_sync_should_not_use_send_now_available_as_primary",
        "path": "app/ui/mixins/page_sync_mixin.py",
        "bad": 'if target_profile and target_profile.get("send_now_available")',
        "hint": "page_sync_mixin 应优先 target_profile.can_send_now 或 send_decision。",
    },
    {
        "name": "ui_status_compact_should_not_let_legacy_is_responding_override_idle",
        "path": "app/ui/mixins/ui_status_compact_mixin.py",
        "bad": 'if response_state in BUSY_RESPONSE_STATES or bool(data.get("is_responding")):',
        "hint": "response_state=idle 时必须覆盖旧 is_responding 残留。",
    },
    {
        "name": "page_status_log_should_use_reason_code",
        "path": "app/utils/page_status.py",
        "bad": '+ "block_reason=" + str(decision.get("block_reason") or decision.get("reason_code") or decision.get("reason") or "-")',
        "hint": "日志标准字段应输出 reason_code=，block_reason 只能作为 legacy_block_reason。",
    },
    {
        "name": "tm_page_selector_should_not_read_normalized_url",
        "path": "app/ui/mixins/tm_page_selector_format_mixin.py",
        "bad": 'page.get("normalized_url")',
        "hint": "业务代码不应继续读取 normalized_url，应使用 page_url_from(page) / url。",
    },
]


def read_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"missing file: {path}")
    return path.read_text(encoding="utf-8", errors="replace")


def main() -> int:
    failed = []
    for item in CHECKS:
        rel_path = item["path"]
        path = ROOT / rel_path
        try:
            text = read_text(path)
        except Exception as error:
            failed.append(
                f"[FIELD_UNIFICATION_CHECK][FILE_ERROR] "
                f"name={item['name']} path={rel_path} error={repr(error)}"
            )
            continue

        if "bad" in item:
            bad = item["bad"]
            if bad in text:
                failed.append(
                    f"[FIELD_UNIFICATION_CHECK][FAILED] "
                    f"name={item['name']} path={rel_path} bad={bad!r} hint={item['hint']}"
                )

        if "bad_any" in item:
            for bad in item["bad_any"]:
                if bad in text:
                    failed.append(
                        f"[FIELD_UNIFICATION_CHECK][FAILED] "
                        f"name={item['name']} path={rel_path} bad={bad!r} hint={item['hint']}"
                    )

        if "bad_count_more_than" in item:
            cfg = item["bad_count_more_than"]
            bad_text = cfg["text"]
            max_count = int(cfg["max_count"])
            count = text.count(bad_text)
            if count > max_count:
                failed.append(
                    f"[FIELD_UNIFICATION_CHECK][FAILED] "
                    f"name={item['name']} path={rel_path} text={bad_text!r} "
                    f"count={count} max_count={max_count} hint={item['hint']}"
                )

    if failed:
        print("[FIELD_UNIFICATION_CHECK][SUMMARY] status=failed count={}".format(len(failed)))
        for line in failed:
            print(line)
        return 1

    print("[FIELD_UNIFICATION_CHECK][SUMMARY] status=ok count=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
