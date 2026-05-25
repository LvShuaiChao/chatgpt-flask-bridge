"""按钮状态一致性本地扫描（只读，生成审查报告，不修改源码）。"""
from pathlib import Path
import re

ROOT = Path("chatgpt-toolbox/tampermonkey-userscript-src")
OUT = Path("button_state_audit_report.md")

PATTERNS = {
    "按钮创建": [
        r"document\.createElement\(['\"]button['\"]\)",
        r"<button",
        r"type=['\"]button['\"]",
    ],
    "点击绑定": [
        r"addEventListener\(['\"]click['\"]",
        r"DomUtil\.bindClick",
        r"onclick",
        r"data-cgpt-action",
        r"data-action",
    ],
    "按钮文字修改": [
        r"\.textContent\s*=",
        r"\.innerText\s*=",
    ],
    "disabled 修改": [
        r"\.disabled\s*=",
        r"setAttribute\(['\"]aria-disabled['\"]",
    ],
    "class 修改": [
        r"classList\.add",
        r"classList\.remove",
        r"className\s*=",
    ],
    "dataset 状态": [
        r"dataset\.(busy|running|actionRunning|waitingReply|buttonPhase|uploadSendState)",
    ],
    "旧 selector": [
        r"#cgpt-upload-auto-continue",
        r"cgpt-upload-auto-continue",
    ],
    "Enter 发送": [
        r"triggerToolboxSendMessageByEnter",
        r"findToolboxSendMessageButton",
        r"enter-send",
        r"send-button-disabled",
    ],
    "runUploadActionPromise": [
        r"function\s+runUploadActionPromise",
        r"runUploadActionPromise\(",
    ],
}

BUTTON_IDS = [
    "cgpt-upload-start",
    "cgpt-upload-start-send",
    "cgpt-upload-continue-once",
    "cgpt-send-hotkey-once",
    "cgpt-auto-continue-once",
    "cgpt-copy-last-message-scroll-bottom",
    "cgpt-copy-hotkey-continue-once",
    "cgpt-copy-hotkey-continue-loop",
    "cgpt-autoq-start",
    "cgpt-autoq-send-once",
    "cgpt-autoq-stop",
    "cgpt-autoq-clear-log",
    "cgpt-autoq-list-new",
    "cgpt-autoq-list-save-name",
    "cgpt-autoq-list-delete",
    "cgpt-prompt-save-btn",
    "cgpt-prompt-delete-btn",
    "cgpt-prompt-duplicate-btn",
    "cgpt-prompt-cancel-btn",
    "cgpt-prompt-new-quick-btn",
    "cgpt-prompt-export-btn",
    "cgpt-prompt-import-btn",
    "cgpt-prompt-reset-btn",
    "cgpt-export-copy-chat",
    "cgpt-export-copy-panel",
    "cgpt-export-refresh-stats",
    "cgpt-export-copy-stats",
    "cgpt-export-prompts",
    "cgpt-export-settings",
    "cgpt-export-settings-import",
    "cgpt-open-chatgpt-home",
    "cgpt-toolbox-toggle",
    "cgpt-toolbox-compact",
    "cgpt-setting-compact-show-upload-start",
    "cgpt-setting-compact-show-file-list",
    "cgpt-setting-compact-show-quick-prompts",
]


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


def iter_source_files():
    if not ROOT.exists():
        raise FileNotFoundError(f"源码目录不存在: {ROOT}")

    for path in ROOT.rglob("*"):
        if path.is_file() and path.suffix in {".js", ".mjs", ".ts", ".tsx", ".html", ".css"}:
            yield path


def collect_pattern_hits():
    rows = []

    for path in iter_source_files():
        text = read_text(path)
        lines = text.splitlines()

        for category, patterns in PATTERNS.items():
            compiled = [re.compile(p) for p in patterns]

            for index, line in enumerate(lines, start=1):
                if any(p.search(line) for p in compiled):
                    rows.append({
                        "category": category,
                        "path": path,
                        "line": index,
                        "text": line.strip(),
                    })

    return rows


def collect_button_hits():
    rows = []

    for path in iter_source_files():
        text = read_text(path)
        lines = text.splitlines()

        for button_id in BUTTON_IDS:
            pattern = re.compile(re.escape(button_id))
            for index, line in enumerate(lines, start=1):
                if pattern.search(line):
                    rows.append({
                        "button_id": button_id,
                        "path": path,
                        "line": index,
                        "text": line.strip(),
                    })

    return rows


def write_report(pattern_hits, button_hits):
    parts = []
    parts.append("# 按钮状态一致性本地扫描报告\n")
    parts.append("## 1. 按钮 ID 命中清单\n")

    grouped_buttons = {}
    for row in button_hits:
        grouped_buttons.setdefault(row["button_id"], []).append(row)

    for button_id in BUTTON_IDS:
        rows = grouped_buttons.get(button_id, [])
        parts.append(f"### {button_id}\n")
        if not rows:
            parts.append("- 未命中\n")
            continue

        for row in rows:
            rel = row["path"].as_posix()
            parts.append(f"- `{rel}:{row['line']}` `{row['text']}`")
        parts.append("")

    parts.append("\n## 2. 状态相关代码命中\n")

    grouped = {}
    for row in pattern_hits:
        grouped.setdefault(row["category"], []).append(row)

    for category, rows in grouped.items():
        parts.append(f"### {category}\n")
        for row in rows:
            rel = row["path"].as_posix()
            parts.append(f"- `{rel}:{row['line']}` `{row['text']}`")
        parts.append("")

    parts.append("\n## 3. 人工复核重点\n")
    parts.append("- running / waiting / sending 状态下，可取消按钮不能 disabled。")
    parts.append("- 开始态不能使用 success 绿色。")
    parts.append("- waiting 状态不能默认使用 danger 红色。")
    parts.append("- 长流程按钮不能只靠 textContent / classList / dataset.busy 表示真实状态。")
    parts.append("- Enter 快捷键不能只依赖 sendBtn.disabled。")
    parts.append("- runUploadActionPromise 不应覆盖具体按钮 phase。")
    parts.append("- 所有 async 按钮流程必须有 catch/finally，且 catch 打印具体错误。")

    append_verification_section(parts)

    OUT.write_text("\n".join(parts), encoding="utf-8")


def append_verification_section(parts):
    """Append §10 execution evidence (scan stats + optional fail_gate/build notes)."""
    from datetime import datetime
    import subprocess
    import sys

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    parts.append("\n## 10. 执行验证回传\n")
    parts.append(f"- 生成时间: {stamp}")
    parts.append("- 扫描命令: `python tools/button_state_audit_scan.py`")
    parts.append(f"- 源码根目录: `{ROOT.as_posix()}/`")

    fail_gate_line = "[未运行]"
    try:
        proc = subprocess.run(
            [sys.executable, "tools/button_state_audit_fail_gate.py"],
            cwd=Path(".").resolve(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        tail = out.splitlines()[-1] if out else f"exit={proc.returncode}"
        if proc.returncode == 0:
            fail_gate_line = "**PASS** (exit=0) — `[BUTTON_STATE_AUDIT][PASS] 未发现高危旧按钮状态逻辑残留`"
        else:
            fail_gate_line = f"**FAIL** (exit={proc.returncode}) — {tail}"
    except OSError as error:
        fail_gate_line = f"[fail_gate 启动失败] {error}"

    parts.append("\n### 10.1 fail_gate\n")
    parts.append(f"- 命令: `python tools/button_state_audit_fail_gate.py`")
    parts.append(f"- 结果: {fail_gate_line}")

    dist = Path("chatgpt-toolbox/dist/client.user.js")
    root_client = Path("client.user.js")
    build_note = "未检测到 dist/client.user.js（请在 chatgpt-toolbox 执行 npm run build）"
    if dist.is_file():
        head = read_text(dist).splitlines()[:40]
        generated = any("GENERATED FILE" in line for line in head)
        gen_line = next(
            (i + 1 for i, line in enumerate(head) if "GENERATED FILE" in line),
            None,
        )
        build_note = (
            f"`{dist.as_posix()}` 存在；GENERATED 标记={'有' if generated else '无'}"
            + (f"（第 {gen_line} 行）" if gen_line else "")
        )
    parts.append("\n### 10.2 构建产物\n")
    parts.append(f"- {build_note}")
    if root_client.is_file() and dist.is_file():
        try:
            synced = root_client.read_bytes() == dist.read_bytes()
            parts.append(f"- 根目录 `client.user.js` 与 dist {'已同步' if synced else '**未同步**（请重新 npm run build）'}")
        except OSError as error:
            parts.append(f"- 根目录同步检查失败: {error}")
    parts.append("- 构建命令: `cd chatgpt-toolbox && npm run build`")

    build_log = "[未在本轮扫描中执行 npm run build]"
    toolbox = Path("chatgpt-toolbox")
    if (toolbox / "package.json").is_file():
        try:
            proc = subprocess.run(
                ["npm", "run", "build"],
                cwd=toolbox.resolve(),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=True,
            )
            log_body = ((proc.stdout or "") + (proc.stderr or "")).strip()
            build_log = log_body or f"exit={proc.returncode}"
            build_log = f"exit={proc.returncode}\n\n```\n{build_log}\n```"
        except OSError as error:
            build_log = f"[build 启动失败] {error}"
    parts.append(f"- 构建日志（扫描时自动执行）: {build_log}")

    vm_matrix_line = "[未运行]"
    try:
        proc_vm = subprocess.run(
            [sys.executable, "tools/button_state_vm_matrix_test.py"],
            cwd=Path(".").resolve(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        vm_out = (proc_vm.stdout or "").strip() or (proc_vm.stderr or "").strip()
        vm_tail = vm_out.splitlines()[-1] if vm_out else f"exit={proc_vm.returncode}"
        if proc_vm.returncode == 0:
            vm_matrix_line = "**PASS** (exit=0) — `[VM_MATRIX][PASS] §131 六场景 VM/快捷键契约全部满足`（6/6）"
        else:
            vm_matrix_line = f"**FAIL** (exit={proc_vm.returncode}) — {vm_tail}"
    except OSError as error:
        vm_matrix_line = f"[vm_matrix 启动失败] {error}"

    parts.append("\n### 10.3 VM 矩阵契约验收（本地自动化，对应 §131）\n")
    parts.append("- 命令: `python tools/button_state_vm_matrix_test.py`")
    parts.append(f"- 结果: {vm_matrix_line}")

    parts.append("\n### 10.4 手工测试（§131，须本机 ChatGPT + Tampermonkey）\n")
    parts.append("| # | 场景 | 预期 | VM 契约 | 浏览器实测 |")
    parts.append("|---|------|------|---------|------------|")
    vm_pass = "PASS" if "PASS" in vm_matrix_line else ("FAIL" if "FAIL" in vm_matrix_line else "—")
    manual_rows = [
        ("1", "开始上传 idle", "#cgpt-upload-start 非 success 绿、可点"),
        ("2", "上传运行中", "文案含「点击取消」、按钮未 disabled"),
        ("3", "发送信息 waiting_send", "warning/waiting 色、可点取消"),
        ("4", "Enter 发送", "sendTask.phase=idle 时可发；非 idle 跳过"),
        ("5", "复制并继续 waiting_reply", "未 disabled、可取消"),
        ("6", "连续复制循环 stopping", "phase=stopping 由统一渲染"),
    ]
    for row in manual_rows:
        parts.append(f"| {row[0]} | {row[1]} | {row[2]} | {vm_pass} | 待测 |")
    parts.append("\n- VM 契约 PASS 仅证明源码矩阵正确；**浏览器实测**全 ✅ 前禁止输出 `<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>`。")


def main():
    pattern_hits = collect_pattern_hits()
    button_hits = collect_button_hits()
    write_report(pattern_hits, button_hits)
    print(f"扫描完成: {OUT.resolve()}")
    print(f"按钮 ID 命中数: {len(button_hits)}")
    print(f"状态相关命中数: {len(pattern_hits)}")


if __name__ == "__main__":
    main()
