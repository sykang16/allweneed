"""src/ 조각을 합쳐 한 파일짜리 웹앱을 만듭니다.

- dist/requirements.html : claude.ai 아티팩트로 게시하는 본문 (doctype 없이)
- dist/standalone.html     : serve.py로 실행하거나(사내 LLM 연결) 브라우저에서 바로 여는(예시 모드) 완전한 HTML

사용법: python build.py
"""
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
dist = root / "dist"
dist.mkdir(exist_ok=True)

scripts = "\n".join((src / f).read_text(encoding="utf-8") for f in ["sample.js", "engine.js", "forms.js", "app.js"])
shell = (src / "shell.html").read_text(encoding="utf-8")
body = shell.replace("/*__SCRIPTS__*/", scripts)

(dist / "requirements.html").write_text(body, encoding="utf-8")
(dist / "standalone.html").write_text(
    '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    "<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n"
    # serve.py가 settings.json을 바탕으로 만들어 주는 설정. 파일로 바로 열면 없어서 예시 모드로 동작합니다.
    '<script src="config.js"></script>\n'
    "</head>\n<body>\n" + body + "\n</body>\n</html>\n",
    encoding="utf-8",
)
print("built", len(body), "chars")
