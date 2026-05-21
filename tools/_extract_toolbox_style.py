"""从 client.user.js 抽出 injectStyle CSS 为 TOOLBOX_STYLE 常量。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "client.user.js"
text = JS.read_text(encoding="utf-8")
func_start = text.find("    function injectStyle()")
if func_start < 0:
    raise SystemExit("injectStyle not found")
func_end = text.find("\n    function ", func_start + 20)
if func_end < 0:
    raise SystemExit("next function after injectStyle not found")
block = text[func_start:func_end]
marker = "style.textContent = `"
m0 = block.find(marker)
if m0 < 0:
    raise SystemExit("style.textContent not found")
m0 += len(marker)
m1 = block.find("`;", m0)
if m1 < 0:
    raise SystemExit("css end not found")
css_body = block[m0:m1]
replacement = (
    "    /* ===== toolbox UI: styles ===== */\n"
    "    const TOOLBOX_STYLE = `\n"
    + css_body
    + "\n    `;\n\n"
    "    function injectStyle() {\n"
    "      const old = document.getElementById(APP.styleId);\n"
    "      if (old) {\n"
    "        old.remove();\n"
    "      }\n"
    "      const style = document.createElement('style');\n"
    "      style.id = APP.styleId;\n"
    "      style.textContent = TOOLBOX_STYLE;\n"
    "      document.documentElement.appendChild(style);\n"
    "    }\n"
)
new_text = text[:func_start] + replacement + text[func_end:]
JS.write_text(new_text, encoding="utf-8")
print(f"TOOLBOX_STYLE {len(css_body)} chars")
