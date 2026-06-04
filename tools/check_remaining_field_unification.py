from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CHECKS = [
    {
        "name": "diagnostics_should_not_prefer_send_now_available",
        "path": "app/ui/page_sync/diagnostics.py",
        "bad_any": [
            'target.get("send_now_available")\n        if target.get("send_now_available") is not None',
            'else target.get("sendable", profile.get("sendable"))',
            'else target.get("inputable", profile.get("inputable"))',
        ],
        "hint": "diagnose_sync_target 必须优先 can_accept_input/can_send_now/send_decision，旧字段只能作为 fallback。",
    },
    {
        "name": "page_sync_plan_logs_must_use_reason_code",
        "path": "app/ui/mixins/page_sync_mixin.py",
        "bad_any": [
            '+ "block_reason={}".format(block_reason or "-")',
            'block_reason={}".format(block_reason or "-")',
        ],
        "hint": "同步计划日志主字段必须是 reason_code，block_reason 只能作为 legacy_block_reason。",
    },
    {
        "name": "page_sync_state_must_not_use_legacy_primary_fields",
        "path": "app/ui/page_sync/state.py",
        "bad_any": [
            'page_id: str = ""',
            'inputable: bool = False',
            'sendable: bool = False',
            'or payload.get("page_instance_id")\n            or self.page_id',
        ],
        "hint": "PageSyncState 主字段必须是 page_display_id/page_instance_id/can_accept_input/can_send_now。",
    },
    {
        "name": "page_snapshot_logs_must_use_standard_fields",
        "path": "app/ui/page_sync/page_snapshot.py",
        "bad_any": [
            "[PAGE_SYNC_SNAPSHOT][PARSE] page_id=",
            "[PAGE_SYNC_SNAPSHOT][RESULT] page_id=",
            "inputable=%s sendable=%s",
        ],
        "hint": "page_snapshot 日志必须输出 page_display_id/page_instance_id/can_accept_input/can_send_now。",
    },
    {
        "name": "sync_runner_logs_must_use_standard_fields",
        "path": "app/ui/page_sync/sync_runner.py",
        "bad_any": [
            "[PAGE_SYNC_RUNNER][START] page_id=",
            "[PAGE_SYNC_RUNNER][UPDATE] page_id=",
            "[PAGE_SYNC_RUNNER][FINISH] page_id=",
        ],
        "hint": "sync_runner 日志必须输出 page_display_id/page_instance_id。",
    },
    {
        "name": "top_button_state_must_not_duplicate_authority_reply_text",
        "path": "chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js",
        "bad_count_more_than": {
            "text": "authorityReplyText:",
            "max_count": 1,
        },
        "hint": "logTopButtonStateConsistency payload 内不要重复 authorityReplyText，应拆成 unifiedReplyText/statusReplyText。",
    },
    {
        "name": "tm_page_selector_must_not_read_normalized_url",
        "path": "app/ui/mixins/tm_page_selector_format_mixin.py",
        "bad_any": [
            'page.get("normalized_url")',
            "page.get('normalized_url')",
        ],
        "hint": "业务代码不要继续读取 normalized_url，应使用 page_url_from(page)/url。",
    },
    {
        "name": "button_state_send_phase_must_not_use_reply_state_directly",
        "path": "chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js",
        "bad_any": [
            "const sendPhase = String(reply.state || 'unknown');",
        ],
        "hint": "sendPhase 必须优先 task.sendPhase/task.phase，不能直接等于 reply.state。",
    },
    {
        "name": "message_queue_page_id_must_not_fallback_page_instance_id",
        "path": "app/server/message_queue_core/models.py",
        "bad_any": [
            'page_id=str(data.get("page_id") or data.get("page_instance_id") or "")',
        ],
        "hint": "MessageQueueItem.from_dict 里 page_id 不能 fallback page_instance_id。",
    },
]


def read_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"missing file: {path}")
    return path.read_text(encoding="utf-8", errors="replace")


def main() -> int:
    failures = []
    for check in CHECKS:
        path = ROOT / check["path"]
        try:
            text = read_text(path)
        except Exception as error:
            failures.append(
                "[FIELD_UNIFICATION_REMAINING][FILE_ERROR] "
                f"name={check['name']} path={check['path']} "
                f"error_type={type(error).__name__} error={error}"
            )
            continue
        for bad in check.get("bad_any", []):
            if bad in text:
                failures.append(
                    "[FIELD_UNIFICATION_REMAINING][FAILED] "
                    f"name={check['name']} path={check['path']} "
                    f"bad={bad!r} hint={check['hint']}"
                )
        count_rule = check.get("bad_count_more_than")
        if count_rule:
            needle = count_rule["text"]
            max_count = int(count_rule["max_count"])
            count = text.count(needle)
            if count > max_count:
                failures.append(
                    "[FIELD_UNIFICATION_REMAINING][FAILED] "
                    f"name={check['name']} path={check['path']} "
                    f"text={needle!r} count={count} max_count={max_count} "
                    f"hint={check['hint']}"
                )
    if failures:
        print(f"[FIELD_UNIFICATION_REMAINING][SUMMARY] status=failed count={len(failures)}")
        for line in failures:
            print(line)
        return 1
    print("[FIELD_UNIFICATION_REMAINING][SUMMARY] status=ok count=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
