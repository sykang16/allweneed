"""폐쇄망 반입용 라이브러리 내려받기

인터넷이 되는 PC에서 한 번 실행하면 vendor 폴더에 브라우저 라이브러리 5개가 저장됩니다.
이 폴더를 반입 절차에 따라 폐쇄망 PC의 같은 위치로 옮기고 settings.json의 assets.offline을 true로 바꾸세요.

    python fetch_vendor.py

모두 공개 오픈소스(Apache-2.0, BSD-2-Clause, MIT 등)이며, 업무 자료는 들어 있지 않습니다.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

CDN = "https://cdnjs.cloudflare.com/ajax/libs/"
FILES = [  # src/engine.js의 LIB_FILES와 같아야 합니다.
    "pdf.js/3.11.174/pdf.min.js",
    "pdf.js/3.11.174/pdf.worker.min.js",
    "mammoth/1.6.0/mammoth.browser.min.js",
    "jszip/3.10.1/jszip.min.js",
    "xlsx/0.18.5/xlsx.full.min.js",
]

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

out = Path(__file__).resolve().parent / "vendor"
out.mkdir(exist_ok=True)
for f in FILES:
    name = f.split("/")[-1]
    data = urllib.request.urlopen(CDN + f, timeout=60).read()
    (out / name).write_bytes(data)
    print(f"{name:28s} {len(data):>10,} B  sha256 {hashlib.sha256(data).hexdigest()[:16]}…")
print(f"완료: {out}")
