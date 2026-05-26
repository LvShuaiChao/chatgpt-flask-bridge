# tools/find_stale_tests_candidates.py

from __future__ import annotations

from pathlib import Path

from _common import PROJECT_ROOT as ROOT, rel

TESTS_DIR = ROOT / "tests"

STALE_PATTERNS = [
    'job.get("status")',
    "job.get('status')",
    'j.get("status")',
    "j.get('status')",
    '"status"',
    "'status'",
    "request_id",
    "payload.request_id",
    "last_page_url",
    "page_url",
    "conversation_url",
    "remote.enabled",
    "DEFAULT_AUTO_CONFIG",
    "autoConfig",
    "promptManagerPrompts",
    "activeTab",
    "rememberActiveTab",
    "uploadActiveGroupId",
]

SAFE_TEST_CONTEXT_MARKERS = [
    "reject",
    "raises",
    "legacy",
    "guard",
    "migration",
    "deprecated",
    "assert_no_legacy_fields",
    "reject_legacy_fields",
    "validate_outbound_queue_message",
    "payload.request_id",
    "should reject",
    "拒绝",
    "旧字段",
    "迁移",
]


def iter_test_files():
    if not TESTS_DIR.exists():
        return

    for path in TESTS_DIR.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        yield path


def classify_context(line: str, window_text: str) -> str:
    combined = f"{line}\n{window_text}"

    for marker in SAFE_TEST_CONTEXT_MARKERS:
        if marker in combined:
            return "safe_guard_or_migration_test"

    return "possible_stale_behavior_test"


def main() -> int:
    print("[STALE_TESTS][START]")

    if not TESTS_DIR.exists():
        print("[STALE_TESTS][NO_TESTS_DIR]")
        return 0

    hit_count = 0

    for path in iter_test_files():
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

        for index, line in enumerate(lines, start=1):
            for pattern in STALE_PATTERNS:
                if pattern not in line:
                    continue

                start = max(0, index - 4)
                end = min(len(lines), index + 3)
                window_text = "\n".join(lines[start:end])
                context = classify_context(line, window_text)

                hit_count += 1

                print(
                    f"[STALE_TEST_CANDIDATE] {rel(path)}:{index} "
                    f"pattern={pattern} context={context} line={line.strip()[:220]}"
                )

    print(f"[STALE_TESTS][DONE] hits={hit_count}")
    print(
        "以上只是候选清单。用于验证 legacy guard / migration 的测试不能删除；"
        "继续保护旧行为的测试才需要更新或移除。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
