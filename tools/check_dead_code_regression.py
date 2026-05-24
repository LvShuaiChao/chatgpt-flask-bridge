"""Static checks to prevent dead-code / field-migration regressions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 僵尸代码清理时不得删除的 legacy 边界（须存在于源码中）。
REQUIRED_LEGACY_GUARDS = [
    {
        "path": "app/utils/legacy_cleanup.py",
        "required": (
            "LEGACY_FIELD_NAMES",
            "def assert_no_legacy_fields",
            "def reject_legacy_fields",
        ),
        "message": "legacy_cleanup.py 是出站/入站旧字段 fail-fast 保护，不能当 dead code 删除",
    },
    {
        "path": "app/utils/bridge_payload.py",
        "required": (
            "from app.utils.legacy_cleanup import",
            "assert_no_legacy_fields",
            "def validate_outbound_queue_message",
        ),
        "message": "bridge_payload 须继续调用 legacy_cleanup 做出站校验",
    },
    {
        "path": "app/server/control_commands.py",
        "required": ("assert_no_legacy_fields",),
        "message": "control_commands 须保留 assert_no_legacy_fields 深检",
    },
]

CHECKS = [
    {
        "path": "app/core/job_scheduler.py",
        "forbidden": 'job.get("status")',
        "message": (
            "job_scheduler.py 不允许继续直接读取旧字段 status，"
            "请使用 job_status_from(job)"
        ),
    },
    {
        "path": "app/core/job_scheduler.py",
        "forbidden": 'j.get("status")',
        "message": (
            "get_job_scheduler_snapshot() 不允许用旧字段 status 统计，"
            "请使用 job_status_from(j)"
        ),
    },
    {
        "path": "client.user.js",
        "forbidden": "DEFAULT_AUTO_CONFIG",
        "message": (
            "生成产物中不应再出现 DEFAULT_AUTO_CONFIG；"
            "源码侧应统一使用 createDefaultAutoConfig()"
        ),
    },
]


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def main():
    errors = []

    for item in REQUIRED_LEGACY_GUARDS:
        path = ROOT / item["path"]
        text = read_text(path)
        if not text:
            errors.append(f"{item['path']}: 文件缺失 — {item['message']}")
            continue
        for needle in item["required"]:
            if needle not in text:
                errors.append(
                    f"{item['path']}: 缺少 {needle!r} — {item['message']}"
                )

    for item in CHECKS:
        path = ROOT / item["path"]
        text = read_text(path)
        if not text:
            continue

        forbidden = item["forbidden"]
        if forbidden in text:
            errors.append(
                f"{item['path']}: {item['message']} forbidden={forbidden!r}"
            )

    if errors:
        print("[DEAD_CODE_REGRESSION][FAILED]")
        for err in errors:
            print(f"- {err}")
        raise SystemExit(1)

    print("[DEAD_CODE_REGRESSION][OK]")


if __name__ == "__main__":
    main()
