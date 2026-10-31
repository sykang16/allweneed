"""모두의 요구사항 한 번에! 실행 서버

브라우저 화면(dist/standalone.html)을 띄우고, 사내 LLM 호출을 대신 전달합니다.
파이썬 표준 라이브러리만 씁니다(추가 설치 없음, Python 3.8 이상).

    python serve.py            # 실행 후 브라우저에서 http://127.0.0.1:8080
    python serve.py --check    # settings.json의 사내 LLM 연결만 시험
    python serve.py --port 9000 --no-browser

사내 LLM 연결 설정은 settings.json에서 합니다(사용자 매뉴얼 4장).
OpenAI 호환 API가 아닌 사내 LLM이면 아래 call_llm() 함수 하나만 고치면 됩니다.

보안 메모
- API 키는 이 서버에만 있고 브라우저로 보내지 않습니다.
- 자료 본문과 AI 응답은 화면에 찍거나 파일로 남기지 않습니다(크기와 소요 시간만 표시).
- 기본값으로 이 PC(127.0.0.1)에서만 접속됩니다.
"""
import argparse
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "standalone.html"
VENDOR = ROOT / "vendor"
VENDOR_FILES = ["pdf.min.js", "pdf.worker.min.js", "mammoth.browser.min.js", "jszip.min.js", "xlsx.full.min.js"]

DEFAULTS = {
    "server": {"host": "127.0.0.1", "port": 8080, "open_browser": True},
    "llm": {
        "provider": "none",
        "base_url": "",
        "api_key": "",
        "model": "",
        "model_precise": "",
        "temperature": 0.2,
        "max_tokens": 8192,
        "timeout_sec": 300,
        "json_mode": True,
        "max_prompt_bytes": 200000,
        "verify_tls": True,
        "ca_bundle": "",
        "use_system_proxy": False,
        "extra_headers": {},
    },
    "assets": {"offline": False},
}

SYSTEM_PROMPT = "당신은 요구사항 분석을 돕는 AI입니다. 사용자가 요청한 형식의 JSON 객체 하나만 답하세요. 설명, 머리말, 코드 울타리(```)를 붙이지 마세요."

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ───────── 설정 ─────────
def load_settings(path=None):
    path = Path(path) if path else ROOT / "settings.json"
    if not path.exists():
        path = ROOT / "settings.example.json"
        log("settings.json이 없어 settings.example.json으로 실행합니다. 사내 LLM을 쓰려면 복사해서 settings.json을 만드세요.")
    raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    cfg = json.loads(json.dumps(DEFAULTS))
    for sec, vals in raw.items():
        if sec.startswith("_") or not isinstance(vals, dict):
            continue
        cfg.setdefault(sec, {}).update({k: v for k, v in vals.items() if not k.startswith("_")})
    llm = cfg["llm"]
    # 환경변수가 있으면 파일보다 우선합니다(키를 파일에 두지 않을 때).
    for env, key in [("REQAI_LLM_API_KEY", "api_key"), ("REQAI_LLM_BASE_URL", "base_url"), ("REQAI_LLM_MODEL", "model")]:
        if os.environ.get(env):
            llm[key] = os.environ[env]
    llm["base_url"] = str(llm["base_url"]).rstrip("/")
    return cfg


def llm_enabled(cfg):
    return cfg["llm"]["provider"] != "none" and bool(cfg["llm"]["base_url"])


def vendor_ready():
    return all((VENDOR / f).exists() for f in VENDOR_FILES)


# ───────── 사내 LLM 호출 ─────────
def http_json(cfg, url, payload=None, timeout=30):
    llm = cfg["llm"]
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if llm["api_key"]:
        headers["Authorization"] = "Bearer " + llm["api_key"]
    headers.update(llm.get("extra_headers") or {})
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    if url.startswith("https"):
        ctx = ssl.create_default_context(cafile=llm["ca_bundle"] or None)
        if not llm["verify_tls"]:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
    else:
        ctx = None
    handlers = [urllib.request.HTTPSHandler(context=ctx)] if ctx else []
    if not llm["use_system_proxy"]:
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    with opener.open(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def call_llm(cfg, prompt, tier="default", want_json=True):
    """프롬프트 하나를 보내고 답 글자를 돌려줍니다.

    ★ 사내 LLM이 OpenAI 호환(/v1/chat/completions)이 아니면 이 함수만 사내 API 규격에 맞게 고치세요.
      입력: prompt(문자열), 출력: (답 글자, 실제 모델 이름)
    """
    llm = cfg["llm"]
    model = (llm["model_precise"] if tier == "precise" and llm["model_precise"] else llm["model"])
    body = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
        "temperature": llm["temperature"],
        "max_tokens": llm["max_tokens"],
        "stream": False,
    }
    if want_json and llm["json_mode"]:
        body["response_format"] = {"type": "json_object"}
    url = llm["base_url"] + "/chat/completions"
    try:
        out = http_json(cfg, url, body, timeout=llm["timeout_sec"])
    except urllib.error.HTTPError as e:
        # JSON 모드를 지원하지 않는 서버가 있어 한 번은 빼고 다시 보냅니다.
        if e.code in (400, 422) and "response_format" in body:
            log("  JSON 모드를 지원하지 않는 것 같아 response_format 없이 다시 보냅니다(이후 호출도 끔).")
            body.pop("response_format")
            llm["json_mode"] = False
            out = http_json(cfg, url, body, timeout=llm["timeout_sec"])
        else:
            raise
    msg = (out.get("choices") or [{}])[0].get("message") or {}
    content = msg.get("content") or ""
    if isinstance(content, list):  # 일부 서버는 조각 목록으로 줍니다.
        content = "".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in content)
    return content, out.get("model") or model


def health(cfg):
    if not llm_enabled(cfg):
        return {"ok": False, "error": "settings.json에서 사내 LLM이 꺼져 있습니다(provider: none)."}
    llm = cfg["llm"]
    try:
        http_json(cfg, llm["base_url"] + "/models", timeout=8)
        return {"ok": True, "model": llm["model"]}
    except urllib.error.HTTPError as e:
        # 서버는 응답했습니다. /models를 막아 둔 게이트웨이도 있어 인증 오류만 실패로 봅니다.
        if e.code in (401, 403):
            return {"ok": False, "error": f"사내 LLM이 인증을 거부했습니다(HTTP {e.code}). api_key를 확인하세요."}
        return {"ok": True, "model": llm["model"]}
    except Exception as e:
        return {"ok": False, "error": f"사내 LLM({llm['base_url']})에 연결하지 못했습니다: {reason(e)}"}


def reason(e):
    if isinstance(e, urllib.error.URLError) and not isinstance(e, urllib.error.HTTPError):
        return str(e.reason)
    if isinstance(e, TimeoutError) or "timed out" in str(e):
        return "응답 시간 초과"
    return str(e)[:300]


# ───────── 웹 서버 ─────────
class Handler(BaseHTTPRequestHandler):
    cfg = None
    server_version = "reqai"

    def log_message(self, fmt, *args):  # 기본 접속 로그는 끕니다(필요한 것만 직접 찍음).
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else (json.dumps(body, ensure_ascii=False) if not isinstance(body, str) else body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        cfg = self.cfg
        if path in ("/", "/index.html"):
            if not DIST.exists():
                return self.send(500, "dist/standalone.html이 없습니다. python build.py를 먼저 실행하세요.", "text/plain; charset=utf-8")
            html = DIST.read_text(encoding="utf-8")
            if cfg["assets"]["offline"]:  # 폐쇄망: 외부 글꼴 요청이 화면을 붙잡지 않도록 뺍니다.
                html = re.sub(r'<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*', "", html)
            return self.send(200, html, "text/html; charset=utf-8")
        if path == "/config.js":
            llm = cfg["llm"]
            conf = {
                "llm": {"endpoint": "/api/llm", "health": "/api/health", "model": llm["model"], "modelPrecise": llm["model_precise"], "maxPromptBytes": llm["max_prompt_bytes"]} if llm_enabled(cfg) else None,
                "libBase": "/vendor/" if cfg["assets"]["offline"] else "",
            }
            return self.send(200, "window.REQAI_CONFIG = " + json.dumps(conf, ensure_ascii=False) + ";\n", "text/javascript; charset=utf-8")
        if path.startswith("/vendor/"):
            name = path[len("/vendor/"):]
            if name in VENDOR_FILES and (VENDOR / name).exists():
                return self.send(200, (VENDOR / name).read_bytes(), "text/javascript; charset=utf-8")
            return self.send(404, "vendor 파일이 없습니다. python fetch_vendor.py 참고", "text/plain; charset=utf-8")
        if path == "/api/health":
            return self.send(200, health(cfg))
        self.send(404, "없는 주소입니다.", "text/plain; charset=utf-8")

    def do_POST(self):
        if self.path.split("?")[0] != "/api/llm":
            return self.send(404, {"error": "없는 주소입니다."})
        cfg = self.cfg
        if not llm_enabled(cfg):
            return self.send(503, {"error": "사내 LLM이 꺼져 있습니다(settings.json의 provider)."})
        size = int(self.headers.get("Content-Length") or 0)
        if size > cfg["llm"]["max_prompt_bytes"] * 2 + 10000:
            return self.send(413, {"error": "자료가 너무 깁니다."})
        try:
            req = json.loads(self.rfile.read(size).decode("utf-8"))
            prompt = str(req.get("prompt") or "")
        except Exception:
            return self.send(400, {"error": "요청 형식이 잘못됐습니다."})
        nbytes = len(prompt.encode("utf-8"))
        if nbytes > cfg["llm"]["max_prompt_bytes"]:
            return self.send(413, {"error": f"자료가 너무 깁니다({nbytes:,}B > {cfg['llm']['max_prompt_bytes']:,}B)."})
        t0 = time.time()
        try:
            text, model = call_llm(cfg, prompt, req.get("tier", "default"), bool(req.get("json", True)))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            log(f"LLM 오류 HTTP {e.code} ({time.time() - t0:.1f}초)")
            code = 429 if e.code == 429 else 502
            return self.send(code, {"error": f"HTTP {e.code} {detail}".strip()})
        except Exception as e:
            r = reason(e)
            log(f"LLM 호출 실패: {r} ({time.time() - t0:.1f}초)")
            return self.send(504 if "시간 초과" in r else 502, {"error": r})
        log(f"LLM 호출 {nbytes:,}B 보냄 → {len(text):,}자 받음, {time.time() - t0:.1f}초, 모델 {model}")
        self.send(200, {"text": text, "model": model})


def check(cfg):
    llm = cfg["llm"]
    print("사내 LLM 연결 시험")
    print(f"  provider : {llm['provider']}")
    print(f"  base_url : {llm['base_url'] or '(비어 있음)'}")
    print(f"  model    : {llm['model'] or '(비어 있음)'}")
    print(f"  api_key  : {'설정됨' if llm['api_key'] else '없음'}")
    if not llm_enabled(cfg):
        print("→ provider가 none이거나 base_url이 비어 있습니다. settings.json을 고치세요.")
        return 1
    h = health(cfg)
    print(f"1) 서버 응답: {'성공' if h['ok'] else '실패 - ' + h['error']}")
    if not h["ok"]:
        return 1
    t0 = time.time()
    try:
        text, model = call_llm(cfg, '다음 JSON을 그대로 답하세요: {"ok": true, "msg": "연결 성공"}')
    except Exception as e:
        detail = e.read().decode("utf-8", "replace")[:300] if isinstance(e, urllib.error.HTTPError) else reason(e)
        print(f"2) 시험 호출: 실패 - {detail}")
        return 1
    print(f"2) 시험 호출: 성공 ({time.time() - t0:.1f}초, 모델 {model})")
    print(f"   응답: {text.strip()[:200]}")
    try:
        text = re.sub(r"<think>[\s\S]*?</think>", "", text)
        start, end = text.index("{"), text.rindex("}") + 1
        json.loads(text[start:end])
        print("3) JSON 응답: 정상 → 이 설정으로 쓸 수 있습니다.")
    except Exception:
        print("3) JSON 응답: 읽지 못함 → 지시를 잘 따르는 모델(instruct/chat)을 쓰거나 json_mode를 확인하세요.")
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(description="모두의 요구사항 한 번에! 실행 서버")
    ap.add_argument("--host")
    ap.add_argument("--port", type=int)
    ap.add_argument("--no-browser", action="store_true", help="브라우저를 자동으로 열지 않음")
    ap.add_argument("--check", action="store_true", help="사내 LLM 연결만 시험하고 끝냄")
    ap.add_argument("--settings", help="설정 파일 경로 (기본: settings.json)")
    args = ap.parse_args()
    cfg = load_settings(args.settings)
    if args.check:
        sys.exit(check(cfg))
    host = args.host or cfg["server"]["host"]
    port = args.port or cfg["server"]["port"]
    if not DIST.exists():
        sys.exit("dist/standalone.html이 없습니다. python build.py를 먼저 실행하세요.")
    if cfg["assets"]["offline"] and not vendor_ready():
        log("경고: assets.offline이 켜져 있는데 vendor 폴더에 라이브러리가 없습니다. PDF·Word·Excel 읽기와 Word·Excel 내려받기가 동작하지 않습니다(사용자 매뉴얼 3.3).")
    if host not in ("127.0.0.1", "localhost"):
        log(f"주의: {host}로 열면 같은 망의 다른 PC도 이 서버와 사내 LLM을 쓸 수 있습니다. 공용 운영 전에는 정보보호 검토를 받으세요.")
    Handler.cfg = cfg
    httpd = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '') else host}:{port}"
    log(f"실행 중: {url}  (끝내려면 Ctrl+C)")
    log(f"AI: {'사내 LLM ' + cfg['llm']['model'] + ' @ ' + cfg['llm']['base_url'] if llm_enabled(cfg) else '꺼짐 (예시 모드)'} / 라이브러리: {'vendor 폴더' if cfg['assets']['offline'] else 'CDN(인터넷)'}")
    if llm_enabled(cfg):
        h = health(cfg)
        log("사내 LLM 응답 확인" if h["ok"] else "경고: " + h["error"])
    if cfg["server"]["open_browser"] and not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("종료합니다.")


if __name__ == "__main__":
    main()
