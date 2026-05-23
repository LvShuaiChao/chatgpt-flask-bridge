
import sys
d = open(r"E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\autoqueue\\auto-queue.js", "rb").read()
try:
    text = d.decode("gbk")
    # Write the corrected content
    with open(r"E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\autoqueue\\auto-queue.js.fixed", "w", encoding="utf-8") as f:
        f.write(text)
    print("SUCCESS: File decoded as GBK")
except Exception as e:
    print(f"GBK decode failed: {e}")
    try:
        # Try GB2312
        text = d.decode("gb2312")
        with open(r"E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\autoqueue\\auto-queue.js.fixed", "w", encoding="utf-8") as f:
            f.write(text)
        print("SUCCESS: File decoded as GB2312")
    except Exception as e2:
        print(f"GB2312 also failed: {e2}")
