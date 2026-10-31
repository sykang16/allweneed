"""Vercel용 진입점: serve.py의 요청 처리(route)를 WSGI 앱으로 감쌉니다.

Vercel은 계속 떠 있는 서버 대신 요청마다 이 app을 부릅니다.
설정은 Vercel 프로젝트의 Environment Variables에서 합니다(ANTHROPIC_API_KEY 등, 사용자 매뉴얼 4.10).
PC나 Render에서는 이 파일을 쓰지 않고 serve.py를 그대로 실행합니다.
"""
from http import HTTPStatus

import serve

CFG = serve.load_settings()


def app(environ, start_response):
    def header(name):
        key = name.upper().replace("-", "_")
        return environ.get(key if key in ("CONTENT_LENGTH", "CONTENT_TYPE") else "HTTP_" + key, "")

    stream = environ["wsgi.input"]
    code, body, ctype = serve.route(CFG, environ.get("REQUEST_METHOD", "GET"), environ.get("PATH_INFO", "/") or "/",
                                    header, lambda n: stream.read(n) if n else b"", environ.get("REMOTE_ADDR", ""))
    data = serve.encode_body(body)
    try:
        phrase = HTTPStatus(code).phrase
    except ValueError:
        phrase = "Status"
    start_response(f"{code} {phrase}", [("Content-Type", ctype), ("Content-Length", str(len(data)))] + serve.SECURITY_HEADERS)
    return [data]
