import re
import sys
from pathlib import Path

from _common import read_text

ROOT = Path("chatgpt-toolbox/tampermonkey-userscript-src")

FAIL_PATTERNS = [
    {
        "name": "上传开始按钮默认 success 绿色",
        "pattern": r"startBtnEl\.classList\.add\(['\"]success['\"]\)",
        "reason": "#cgpt-upload-start idle 状态不应使用 success 绿色",
    },
    {
        "name": "上传运行中 disabled",
        "pattern": r"startBtnEl\.disabled\s*=\s*true",
        "reason": "上传运行中按钮应允许点击取消，不能直接 disabled",
    },
    {
        "name": "上传按钮只显示上传中",
        "pattern": r"startBtnEl\.textContent\s*=\s*['\"]上传中['\"]",
        "reason": "运行中应显示“上传中，点击取消”，并绑定取消逻辑",
    },
    {
        "name": "等待发送使用 danger",
        "pattern": r"classList\.add\([^;\n]*['\"]danger['\"][^;\n]*['\"]cgpt-wait-send-cancel['\"]",
        "reason": "waiting_send 应使用 waiting/warning，不应使用 danger",
    },
    {
        "name": "通过取消等待文案反推状态",
        "pattern": r"textContent[^;\n]*===\s*['\"]取消等待['\"]",
        "reason": "不能通过按钮文案反推真实状态，应读取 sendTask.phase 或内部状态",
    },
    {
        "name": "通过 cgpt-wait-send-cancel class 反推状态",
        "pattern": r"classList\.contains\(['\"]cgpt-wait-send-cancel['\"]\)",
        "reason": "不能通过 class 反推真实状态，应读取 sendTask.phase 或内部状态",
    },
    {
        "name": "Enter 发送依赖 sendBtn.disabled",
        "pattern": r"sendBtn\.disabled\s*\|\|\s*sendBtn\.getAttribute\(['\"]aria-disabled['\"]\)",
        "reason": "Enter 发送应读取 sendTask.phase，不应只依赖 DOM disabled",
    },
    {
        "name": "Enter 直接 sendBtn.click",
        "pattern": r"sendBtn\.click\(\)",
        "reason": "Enter 发送应进入统一发送流程，不应直接触发按钮 click",
    },
    {
        "name": "runUploadActionPromise 统一加 danger",
        "pattern": r"classList\.add\([^;\n]*['\"]danger['\"][^;\n]*['\"]cgpt-action-running['\"]",
        "reason": "runUploadActionPromise 不应统一管理按钮颜色，应由具体 task.phase 渲染",
    },
    {
        "name": "runUploadActionPromise 写 actionRunning",
        "pattern": r"dataset\.actionRunning\s*=\s*['\"]1['\"]",
        "reason": "dataset.actionRunning 不能作为长流程真实状态源",
    },
    {
        "name": "连续循环停止中直接 disabled",
        "pattern": r"textContent\s*=\s*['\"]停止中\.['\"][\s\S]{0,200}?disabled\s*=\s*true",
        "reason": "连续循环停止应设置 phase='stopping'，由统一渲染函数控制按钮",
    },
    {
        "name": "旧自动继续 selector 残留",
        "pattern": r"#cgpt-upload-auto-continue|cgpt-upload-auto-continue",
        "reason": "旧 selector 应统一迁移到 #cgpt-auto-continue-once，或集中封装兼容查找函数",
    },
]

SOURCE_SUFFIXES = {".js", ".mjs", ".ts", ".tsx", ".html", ".css"}


def iter_source_files():
    if not ROOT.exists():
        print(f"[AUDIT][ERROR] 源码目录不存在: {ROOT}")
        sys.exit(2)

    for path in ROOT.rglob("*"):
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            yield path


def main():
    failures = []

    for path in iter_source_files():
        text = read_text(path)

        for item in FAIL_PATTERNS:
            pattern = re.compile(item["pattern"], re.MULTILINE)
            for match in pattern.finditer(text):
                line_no = text[: match.start()].count("\n") + 1
                lines = text.splitlines()
                line_text = lines[line_no - 1].strip() if line_no <= len(lines) else ""
                failures.append(
                    {
                        "file": path.as_posix(),
                        "line": line_no,
                        "name": item["name"],
                        "reason": item["reason"],
                        "text": line_text,
                    }
                )

    if not failures:
        print("[BUTTON_STATE_AUDIT][PASS] 未发现高危旧按钮状态逻辑残留")
        return

    print("[BUTTON_STATE_AUDIT][FAIL] 发现高危旧按钮状态逻辑残留")
    print("")

    for index, failure in enumerate(failures, start=1):
        print(f"{index}. {failure['name']}")
        print(f"   文件: {failure['file']}:{failure['line']}")
        print(f"   原因: {failure['reason']}")
        print(f"   代码: {failure['text']}")
        print("")

    sys.exit(1)


if __name__ == "__main__":
    main()
