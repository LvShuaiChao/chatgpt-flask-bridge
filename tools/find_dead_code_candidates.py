from pathlib import Path
import ast
import re

ROOT = Path(__file__).resolve().parents[1]

PY_TARGETS = [
    ROOT / "app",
    ROOT / "gui.py",
    ROOT / "server.py",
]

IGNORE_DIR_NAMES = {
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    "runtime",
    "logs",
    "dist",
    "build",
}

DEPRECATED_PATTERNS = [
    "DEFAULT_AUTO_CONFIG",
    "LEGACY_KEYS",
    "DEPRECATED_TOOLBOX_PATCH_KEYS",
    "uploadActiveGroupId",
    "last_page_url",
    "conversation_url",
    "remote_binding_enabled",
    "status_chip_text",
]

OLD_STATUS_PATTERNS = [
    'job.get("status")',
    "job.get('status')",
    'j.get("status")',
    "j.get('status')",
    '["status"]',
    "['status']",
]


def iter_files():
    for target in PY_TARGETS:
        if target.is_file():
            yield target
            continue

        if not target.exists():
            continue

        for path in target.rglob("*.py"):
            if any(part in IGNORE_DIR_NAMES for part in path.parts):
                continue
            yield path



def read_text(path):
    return path.read_text(encoding="utf-8", errors="replace")


def rel(path):
    return str(path.relative_to(ROOT)).replace("\\", "/")


def collect_python_defs(path, text):
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        print(f"[PY_PARSE_FAILED] {rel(path)} error={exc}")
        return []

    items = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            items.append((node.name, node.lineno, type(node).__name__))
    return items


def count_token_occurrences(all_text, token):
    return len(re.findall(rf"\b{re.escape(token)}\b", all_text))


def main():
    files = list(iter_files())
    file_texts = {}
    project_text = ""

    for path in files:
        text = read_text(path)
        file_texts[path] = text
        project_text += "\n" + text

    print("[DEAD_CODE_CANDIDATE_SCAN][START]")
    print(f"files={len(files)}")

    print("\n[OLD_STATUS_FIELD]")
    for path, text in file_texts.items():
        for pattern in OLD_STATUS_PATTERNS:
            if pattern in text:
                print(f"- {rel(path)} contains {pattern}")

    print("\n[DEPRECATED_OR_COMPAT_PATTERN]")
    for path, text in file_texts.items():
        for pattern in DEPRECATED_PATTERNS:
            if pattern in text:
                print(f"- {rel(path)} contains {pattern}")

    print("\n[PYTHON_DEF_SINGLE_OCCURRENCE]")
    for path, text in file_texts.items():
        if path.suffix != ".py":
            continue

        for name, lineno, kind in collect_python_defs(path, text):
            if name.startswith("__") and name.endswith("__"):
                continue
            count = count_token_occurrences(project_text, name)
            if count <= 1:
                print(f"- {rel(path)}:{lineno} {kind} {name} occurrence={count}")

    print("\n[NOTE]")
    print(
        "以上只是候选清单，不能自动删除。"
        "Qt 信号、Flask 路由、getattr、字符串动态调用都可能导致误判。"
        "删除前请先运行: python tools/find_dynamic_reference_entries.py"
    )
    print(
        "已排除构建产物扫描: client.user.js、dist/**、build/**、runtime/**、logs/** 等。"
        "油猴请改 chatgpt-toolbox/tampermonkey-userscript-src/ 后 npm run build。"
    )


if __name__ == "__main__":
    main()
