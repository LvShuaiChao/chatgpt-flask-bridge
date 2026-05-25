"""§131 对应场景的 VM 矩阵静态契约验收（无需 ChatGPT 页面）。"""
from pathlib import Path
import re
import sys

ROOT = Path("chatgpt-toolbox/tampermonkey-userscript-src")

# 每个场景：在指定文件中必须存在的契约片段（正则）
MATRIX = [
    {
        "id": "1",
        "scene": "开始上传 idle",
        "file": "upload/upload-button-vm.js",
        "patterns": [
            r"buttonPhase:\s*['\"]idle['\"]",
            r"text:\s*['\"]开始上传['\"]",
        ],
        "forbidden": [
            (r"phase === TaskPhase\.IDLE[\s\S]{0,400}buttonPhase:\s*['\"]success['\"]", "idle 不应使用 success"),
        ],
    },
    {
        "id": "2",
        "scene": "上传运行中",
        "file": "upload/upload-button-vm.js",
        "patterns": [
            r"text:\s*['\"]上传中，点击取消['\"]",
            r"disabled:\s*false[\s\S]{0,80}allowCancel:\s*true[\s\S]{0,80}action:\s*['\"]cancel['\"]",
        ],
        "forbidden": [],
    },
    {
        "id": "3",
        "scene": "发送信息 waiting_send",
        "file": "upload/upload-send-button-vm.js",
        "patterns": [
            r"text:\s*['\"]等待可发送，点击取消['\"]",
            r"disabled:\s*false",
            r"addClasses:\s*\[['\"]warning['\"]\]",
        ],
        "forbidden": [
            (r"waitingSend[\s\S]{0,500}addClasses:\s*\[['\"]danger['\"]\]", "waiting_send 不应默认 danger"),
        ],
    },
    {
        "id": "4",
        "scene": "Enter 发送",
        "file": "upload/upload-module.js",
        "patterns": [
            r"getSendTaskPhase\(\)",
            r"sendPhase !== 'idle'",
            r"\[TOOLBOX_HOTKEY\]\[enter-send-skip\]",
        ],
        "forbidden": [
            (r"sendBtn\.click\(\)", "Enter 不应直接 sendBtn.click"),
            (r"sendBtn\.disabled\s*\|\|\s*sendBtn\.getAttribute", "Enter 不应只依赖 sendBtn.disabled"),
        ],
    },
    {
        "id": "5",
        "scene": "复制并继续 waiting_reply",
        "file": "upload/upload-button-vm.js",
        "patterns": [
            r"phase === TaskPhase\.WAITING_REPLY[\s\S]{0,200}disabled:\s*false",
            r"text:\s*['\"]等待回复，点击取消['\"]",
        ],
        "forbidden": [],
    },
    {
        "id": "6",
        "scene": "连续复制循环 stopping",
        "file": "upload/upload-button-vm.js",
        "patterns": [
            r"rawPhase === 'stopping'",
            r"text:\s*['\"]停止中['\"]",
            r"buttonPhase:\s*['\"]cancelled['\"]",
        ],
        "forbidden": [
            (r"textContent\s*=\s*['\"]停止中", "stopping 应由 VM 渲染，不应散落 textContent 直写"),
        ],
    },
]


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


def check_scene(scene: dict) -> list[str]:
    errors = []
    rel = scene["file"]
    path = ROOT / rel
    if not path.is_file():
        return [f"文件不存在: {rel}"]

    text = read_text(path)

    for pattern in scene.get("patterns", []):
        if not re.search(pattern, text, re.MULTILINE):
            errors.append(f"缺少契约: /{pattern}/")

    for pattern, reason in scene.get("forbidden", []):
        if re.search(pattern, text, re.MULTILINE):
            errors.append(f"禁止模式命中 ({reason}): /{pattern}/")

    return errors


def main() -> int:
    if not ROOT.exists():
        print(f"[VM_MATRIX][FAIL] 源码目录不存在: {ROOT}")
        return 2

    failures = []
    passed = []

    for scene in MATRIX:
        errors = check_scene(scene)
        row = f"{scene['id']}|{scene['scene']}"
        if errors:
            failures.append((row, errors))
        else:
            passed.append(row)

    print(f"[VM_MATRIX] 通过 {len(passed)}/{len(MATRIX)}")
    for row in passed:
        print(f"  OK  {row}")

    if failures:
        print("[VM_MATRIX][FAIL] 以下场景未通过契约验收:")
        for row, errors in failures:
            print(f"  FAIL {row}")
            for err in errors:
                print(f"       - {err}")
        return 1

    print("[VM_MATRIX][PASS] §131 六场景 VM/快捷键契约全部命中")
    return 0


if __name__ == "__main__":
    sys.exit(main())
