"""모두의 요구사항 한 번에! 실행 서버

브라우저 화면(dist/standalone.html)을 띄우고, 사내 LLM 호출을 대신 전달합니다.
파이썬 표준 라이브러리만 씁니다(추가 설치 없음, Python 3.8 이상).

    python serve.py            # 실행 후 브라우저에서 http://127.0.0.1:8080
    python serve.py --check    # settings.json의 사내 LLM 연결만 시험
    python serve.py --port 9000 --no-browser

웹 호스팅(Render 등)에서는 설정 파일 대신 환경변수로 설정합니다(사용자 매뉴얼 4.9).
    PORT                      호스팅이 정해 주는 포트(있으면 0.0.0.0:PORT로 열고 브라우저는 열지 않음)
    REQAI_LLM_PROVIDER        anthropic 또는 openai
    ANTHROPIC_API_KEY         Claude API 키
    REQAI_ACCESS_CODE         (선택) 심사용 접속 코드. 정하면 이 코드를 넣은 사람만 AI 분석 가능
    REQAI_LIMIT_PER_IP_HOUR   한 사람(IP)이 1시간에 부를 수 있는 AI 호출 수(기본 40, 분석 1회 = 2호출)
    REQAI_LIMIT_PER_DAY       하루 전체 AI 호출 수(기본 400)
    GEMINI_API_KEY            (선택) Claude 크레딧이 부족할 때 대신 쓸 Gemini API 키
    REQAI_FALLBACK_MODEL      대체 모델(기본 gemini-2.5-flash-lite)

AI 연결 설정은 settings.json에서 합니다(사용자 매뉴얼 4장).
- provider "openai"   : 사내 LLM(OpenAI 호환 API). 표준 라이브러리만 씀
- provider "anthropic": Claude API. anthropic 패키지 필요(pip install anthropic), 키는 settings.json 또는 환경변수 ANTHROPIC_API_KEY
OpenAI 호환 API가 아닌 사내 LLM이면 아래 call_llm() 함수 하나만 고치면 됩니다.

보안 메모
- API 키는 이 서버에만 있고 브라우저로 보내지 않습니다.
- 자료 본문과 AI 응답은 화면에 찍거나 파일로 남기지 않습니다(크기와 소요 시간만 표시).
- 기본값으로 이 PC(127.0.0.1)에서만 접속됩니다.
"""
import argparse
import hmac
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
        # Claude API(provider "anthropic")에서만 씀
        "effort": "high",
        "effort_precise": "xhigh",
        "refusal_fallback": True,
    },
    "assets": {"offline": False},
    # Claude API 크레딧이 부족할 때 대신 쓰는 모델(Gemini API). 키가 있을 때만 동작합니다.
    "fallback": {
        "model": "gemini-2.5-flash-lite",
        "api_key": "",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "max_tokens": 32768,
    },
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
        if not os.environ.get("REQAI_LLM_PROVIDER"):
            log("settings.json이 없어 settings.example.json으로 실행합니다. AI를 연결하려면 복사해서 settings.json을 만드세요.")
    raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    cfg = json.loads(json.dumps(DEFAULTS))
    for sec, vals in raw.items():
        if sec.startswith("_") or not isinstance(vals, dict):
            continue
        cfg.setdefault(sec, {}).update({k: v for k, v in vals.items() if not k.startswith("_")})
    llm = cfg["llm"]
    # 환경변수가 있으면 파일보다 우선합니다(키를 파일에 두지 않을 때).
    for env, key in [("REQAI_LLM_PROVIDER", "provider"), ("REQAI_LLM_API_KEY", "api_key"), ("REQAI_LLM_BASE_URL", "base_url"), ("REQAI_LLM_MODEL", "model")]:
        if os.environ.get(env):
            llm[key] = os.environ[env]
    llm["base_url"] = str(llm["base_url"]).rstrip("/")
    # 웹 호스팅: 호스팅이 준 포트로 모든 주소에서 받고, 브라우저는 열지 않습니다.
    if os.environ.get("PORT"):
        cfg["server"].update(host="0.0.0.0", port=int(os.environ["PORT"]), open_browser=False)
    fb = cfg["fallback"]
    for env, key in [("GEMINI_API_KEY", "api_key"), ("GOOGLE_API_KEY", "api_key"), ("REQAI_FALLBACK_MODEL", "model"), ("REQAI_GEMINI_BASE_URL", "base_url")]:
        if os.environ.get(env) and not (key == "api_key" and fb["api_key"] and env == "GOOGLE_API_KEY"):
            fb[key] = os.environ[env]
    fb["base_url"] = str(fb["base_url"]).rstrip("/")
    cfg["guard"] = {
        "access_code": os.environ.get("REQAI_ACCESS_CODE", ""),
        "per_ip_hour": int(os.environ.get("REQAI_LIMIT_PER_IP_HOUR", "40")),
        "per_day": int(os.environ.get("REQAI_LIMIT_PER_DAY", "400")),
    }
    if llm["provider"] == "anthropic":
        # Claude API 기본값: 모델 Claude Opus 5.5, 긴 응답(전체 요구사항 JSON)을 위해 넉넉한 출력·입력 한도
        dflt = DEFAULTS["llm"]
        llm["model"] = llm["model"] or "claude-sonnet-5-5"
        if llm["max_tokens"] == dflt["max_tokens"]:
            llm["max_tokens"] = 64000
        if llm["max_prompt_bytes"] == dflt["max_prompt_bytes"]:
            llm["max_prompt_bytes"] = 1500000
    return cfg


def llm_enabled(cfg):
    p = cfg["llm"]["provider"]
    return p == "anthropic" or (p != "none" and bool(cfg["llm"]["base_url"]))


def llm_label(cfg):
    return "Claude API" if cfg["llm"]["provider"] == "anthropic" else "사내 LLM"


class LLMError(Exception):
    """화면에 보여 줄 HTTP 상태와 문장을 담은 오류"""

    def __init__(self, status, message, kind=""):
        super().__init__(message)
        self.status, self.message, self.kind = status, message, kind


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


# ───────── Claude 크레딧 부족 시 Gemini로 대신 처리 ─────────
_credit_out = {"until": 0.0}   # 크레딧 부족을 확인한 뒤 이 시각까지는 Claude를 건너뜀
CREDIT_RETRY_SEC = 600


def fallback_ready(cfg):
    return cfg["llm"]["provider"] == "anthropic" and bool(cfg["fallback"]["api_key"])


def fallback_label(cfg):
    m = cfg["fallback"]["model"]
    return "Gemini 2.5 Flash-Lite" if m == "gemini-2.5-flash-lite" else m


def call_gemini(cfg, prompt):
    """Gemini API generateContent. JSON 응답 모드로 받습니다."""
    fb = cfg["fallback"]
    url = f"{fb['base_url']}/models/{fb['model']}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2, "maxOutputTokens": int(fb["max_tokens"])},
    }
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": fb["api_key"]}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=float(cfg["llm"]["timeout_sec"])) as res:
            out = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        msg = {400: "Gemini가 요청을 거절했습니다", 401: "Gemini API 키가 맞지 않습니다", 403: "Gemini API 키가 맞지 않거나 권한이 없습니다",
               404: "Gemini 모델 이름이 맞지 않습니다", 429: "Gemini 사용 한도에 걸렸습니다"}.get(e.code, f"Gemini 오류(HTTP {e.code})")
        if "api key not valid" in detail.lower() or "api_key_invalid" in detail.lower():
            msg, detail = "Gemini API 키가 맞지 않습니다(GEMINI_API_KEY 확인)", ""
        raise LLMError(429 if e.code == 429 else 502, f"Claude 크레딧이 부족해 Gemini로 대신 처리하려 했지만 실패했습니다: {msg}. {detail}".strip())
    except Exception as e:
        raise LLMError(502, f"Claude 크레딧이 부족해 Gemini로 대신 처리하려 했지만 연결하지 못했습니다: {reason(e)}")
    cand = (out.get("candidates") or [{}])[0]
    if cand.get("finishReason") == "MAX_TOKENS":
        raise LLMError(502, "Gemini 응답이 길어 중간에 끊겼습니다.")
    text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) if not p.get("thought"))
    if not text.strip():
        raise LLMError(502, f"Gemini가 빈 답을 보냈습니다({cand.get('finishReason') or '이유 불명'}).")
    u = out.get("usageMetadata") or {}
    log(f"  Gemini 사용량: 입력 {u.get('promptTokenCount', 0):,} · 출력 {u.get('candidatesTokenCount', 0):,} 토큰")
    return text, out.get("modelVersion") or fb["model"]


def ask(cfg, prompt, tier="default", want_json=True):
    """(답 글자, 모델 이름, 대체 안내) — 대체 안내는 Gemini로 대신 처리했을 때만 채웁니다."""
    if cfg["llm"]["provider"] != "anthropic":
        return (*call_llm(cfg, prompt, tier, want_json), "")
    note = f"Claude 크레딧이 부족해 {fallback_label(cfg)}로 대신 처리했습니다."
    if fallback_ready(cfg) and time.time() < _credit_out["until"]:
        return (*call_gemini(cfg, prompt), note)
    try:
        return (*call_claude(cfg, prompt, tier), "")
    except LLMError as e:
        if e.kind != "credit" or not fallback_ready(cfg):
            raise
        _credit_out["until"] = time.time() + CREDIT_RETRY_SEC
        log(f"  Claude 크레딧 부족 → {CREDIT_RETRY_SEC // 60}분 동안 {fallback_label(cfg)}로 대신 처리")
        return (*call_gemini(cfg, prompt), note)


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


# ───────── Claude API ─────────
def claude_client(cfg):
    try:
        import anthropic
    except ImportError:
        raise LLMError(503, "Claude API를 쓰려면 anthropic 패키지가 필요합니다. 명령 창에서 pip install anthropic 을 실행하세요.")
    llm = cfg["llm"]
    # api_key가 비어 있으면 SDK가 환경변수 ANTHROPIC_API_KEY를 읽습니다.
    return anthropic, anthropic.Anthropic(api_key=llm["api_key"] or None, timeout=float(llm["timeout_sec"]), max_retries=2)


def claude_error(anthropic, e):
    """SDK 오류를 화면용 상태·문장으로 바꿉니다(구체적인 것부터)."""
    if isinstance(e, anthropic.APIStatusError) and (e.status_code == 402 or "credit balance" in str(e).lower() or "billing" in str(e).lower()):
        err = LLMError(402, "Claude API 크레딧이 부족합니다. Anthropic Console에서 크레딧을 충전하세요.")
        err.kind = "credit"
        return err
    if isinstance(e, anthropic.AuthenticationError):
        return LLMError(401, "Claude API 키가 맞지 않습니다. settings.json의 api_key나 환경변수 ANTHROPIC_API_KEY를 확인하세요.")
    if isinstance(e, anthropic.PermissionDeniedError):
        return LLMError(403, "이 API 키로는 해당 모델을 쓸 수 없습니다.")
    if isinstance(e, anthropic.NotFoundError):
        return LLMError(404, "모델 이름이 맞지 않습니다. settings.json의 model을 확인하세요.")
    if isinstance(e, anthropic.RateLimitError):
        return LLMError(429, "Claude API 사용 한도에 걸렸습니다. 잠시 후 다시 시도하세요.")
    if isinstance(e, anthropic.BadRequestError):
        return LLMError(400, f"Claude API가 요청을 거절했습니다: {getattr(e, 'message', str(e))[:300]}")
    if isinstance(e, anthropic.APITimeoutError):
        return LLMError(504, "Claude API 응답 시간 초과. timeout_sec를 늘리세요.")
    if isinstance(e, anthropic.APIStatusError):
        return LLMError(502, f"Claude API 오류(HTTP {e.status_code}). 잠시 후 다시 시도하세요.")
    if isinstance(e, anthropic.APIConnectionError):
        return LLMError(502, "Claude API에 연결하지 못했습니다. 인터넷 연결과 프록시를 확인하세요.")
    return LLMError(502, str(e)[:300])


def call_claude(cfg, prompt, tier="default"):
    """Claude Messages API. 긴 응답이 끊기지 않게 스트리밍으로 받아 완성된 메시지를 씁니다."""
    llm = cfg["llm"]
    anthropic, client = claude_client(cfg)
    precise = tier == "precise"
    model = llm["model_precise"] if precise and llm["model_precise"] else llm["model"]
    extra = {"output_config": {"effort": llm["effort_precise"] if precise else llm["effort"]}}
    betas = []
    if llm["refusal_fallback"]:
        # 안전 분류기가 거절하면 서버가 다른 모델로 이어서 처리합니다.
        betas.append("server-side-fallback-2026-07-01")
        extra["fallbacks"] = "default"
    try:
        with client.beta.messages.stream(
            model=model,
            max_tokens=int(llm["max_tokens"]),
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            betas=betas,
            extra_body=extra,
        ) as stream:
            msg = stream.get_final_message()
    except anthropic.APIError as e:
        raise claude_error(anthropic, e)
    if msg.stop_reason == "refusal":
        raise LLMError(422, "Claude가 이 자료를 처리하지 않았습니다. 자료 내용을 확인해 주세요.")
    if msg.stop_reason == "max_tokens":
        raise LLMError(502, "응답이 길어 중간에 끊겼습니다. settings.json의 max_tokens를 늘리세요.")
    text = "".join(b.text for b in msg.content if b.type == "text")
    u = msg.usage
    log(f"  Claude 사용량: 입력 {u.input_tokens:,} · 출력 {u.output_tokens:,} 토큰")
    return text, msg.model


_health_cache = {"t": 0.0, "v": None}


def health(cfg):
    if _health_cache["v"] and _health_cache["v"]["ok"] and time.time() - _health_cache["t"] < 300:
        return _health_cache["v"]
    v = _health(cfg)
    _health_cache.update(t=time.time(), v=v)
    return v


def _health(cfg):
    if not llm_enabled(cfg):
        return {"ok": False, "error": "settings.json에서 AI 연결이 꺼져 있습니다(provider: none)."}
    llm = cfg["llm"]
    if llm["provider"] == "anthropic":
        # 키와 모델 이름이 맞는지 모델 정보 조회로 확인합니다(토큰을 쓰지 않음).
        try:
            anthropic, client = claude_client(cfg)
            client.models.retrieve(llm["model"])
            return {"ok": True, "model": llm["model"]}
        except LLMError as e:
            return {"ok": False, "error": e.message}
        except Exception as e:
            return {"ok": False, "error": claude_error(anthropic, e).message}
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


# ───────── 사용 한도(웹 호스팅에서 API 비용 보호) ─────────
_guard_lock = threading.Lock()
_ip_calls = {}            # IP → 최근 1시간 호출 시각
_day = {"date": "", "n": 0}


def guard_check(cfg, ip):
    """호출을 허용하면 None, 막으면 (상태, 문장)."""
    g = cfg["guard"]
    now = time.time()
    today = time.strftime("%Y-%m-%d")
    with _guard_lock:
        if _day["date"] != today:
            _day.update(date=today, n=0)
        if _day["n"] >= g["per_day"]:
            return 429, "오늘 사용할 수 있는 AI 분석 횟수를 모두 썼습니다. 내일 다시 시도하거나 예시 결과로 체험해 주세요."
        recent = [t for t in _ip_calls.get(ip, []) if now - t < 3600]
        if len(recent) >= g["per_ip_hour"]:
            return 429, "AI 분석을 너무 자주 요청했습니다. 잠시 후(최대 1시간) 다시 시도해 주세요."
        recent.append(now)
        _ip_calls[ip] = recent
        _day["n"] += 1
    return None


# ───────── 웹 서버 ─────────
JSON = "application/json; charset=utf-8"
TEXT = "text/plain; charset=utf-8"


def route(cfg, method, path, header, read_body, client_ip):
    """요청 하나를 처리해 (상태, 본문, 형식)을 돌려줍니다.
    PC·Render의 내장 서버(Handler)와 Vercel의 WSGI 앱(app.py)이 함께 씁니다.
    header(이름) → 값, read_body(크기) → bytes."""
    path = path.split("?")[0]
    if method == "GET":
        # Vercel이 저장소의 index.html → dist/standalone.html을 정적 파일로 먼저 내줄 때도 같은 화면·설정이 나가게 합니다.
        if path in ("/", "/index.html", "/dist/standalone.html"):
            if not DIST.exists():
                return 500, "dist/standalone.html이 없습니다. python build.py를 먼저 실행하세요.", TEXT
            html = DIST.read_text(encoding="utf-8")
            if cfg["assets"]["offline"]:  # 폐쇄망: 외부 글꼴 요청이 화면을 붙잡지 않도록 뺍니다.
                html = re.sub(r'<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*', "", html)
            return 200, html, "text/html; charset=utf-8"
        if path in ("/config.js", "/dist/config.js"):
            llm = cfg["llm"]
            conf = {
                "llm": {"endpoint": "/api/llm", "health": "/api/health", "label": llm_label(cfg), "needCode": bool(cfg["guard"]["access_code"]), "model": llm["model"], "effort": llm["effort"] if llm["provider"] == "anthropic" else "", "effortPrecise": llm["effort_precise"] if llm["provider"] == "anthropic" else "", "modelPrecise": llm["model_precise"], "maxPromptBytes": llm["max_prompt_bytes"]} if llm_enabled(cfg) else None,
                "libBase": "/vendor/" if cfg["assets"]["offline"] else "",
            }
            return 200, "window.REQAI_CONFIG = " + json.dumps(conf, ensure_ascii=False) + ";\n", "text/javascript; charset=utf-8"
        if path.startswith("/vendor/"):
            name = path[len("/vendor/"):]
            if name in VENDOR_FILES and (VENDOR / name).exists():
                return 200, (VENDOR / name).read_bytes(), "text/javascript; charset=utf-8"
            return 404, "vendor 파일이 없습니다. python fetch_vendor.py 참고", TEXT
        if path == "/api/health":
            return 200, health(cfg), JSON
        return 404, "없는 주소입니다.", TEXT
    if method != "POST" or path != "/api/llm":
        return 404, {"error": "없는 주소입니다."}, JSON
    if not llm_enabled(cfg):
        return 503, {"error": "AI 연결이 꺼져 있습니다(settings.json의 provider)."}, JSON
    code = cfg["guard"]["access_code"]
    if code and not hmac.compare_digest((header("X-Access-Code") or "").encode(), code.encode()):
        return 401, {"error": "접속 코드가 맞지 않습니다. 안내받은 코드를 AI 분석 화면에 입력하세요.", "code": "access_code"}, JSON
    size = int(header("Content-Length") or 0)
    if size > cfg["llm"]["max_prompt_bytes"] * 2 + 10000:
        return 413, {"error": "자료가 너무 깁니다."}, JSON
    try:
        req = json.loads(read_body(size).decode("utf-8"))
        prompt = str(req.get("prompt") or "")
    except Exception:
        return 400, {"error": "요청 형식이 잘못됐습니다."}, JSON
    nbytes = len(prompt.encode("utf-8"))
    if nbytes > cfg["llm"]["max_prompt_bytes"]:
        return 413, {"error": f"자료가 너무 깁니다({nbytes:,}B > {cfg['llm']['max_prompt_bytes']:,}B)."}, JSON
    if not prompt.strip():
        return 400, {"error": "보낼 내용이 없습니다."}, JSON
    # 실제로 AI를 부르는 요청만 한도에 셉니다(호스팅 앞단 프록시가 붙인 원래 IP 기준).
    ip = (header("X-Forwarded-For") or client_ip or "").split(",")[0].strip()
    blocked = guard_check(cfg, ip)
    if blocked:
        return blocked[0], {"error": blocked[1]}, JSON
    t0 = time.time()
    try:
        text, model, fallback = ask(cfg, prompt, req.get("tier", "default"), bool(req.get("json", True)))
    except LLMError as e:
        log(f"LLM 오류 {e.status}: {e.message} ({time.time() - t0:.1f}초)")
        return e.status, {"error": e.message}, JSON
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        log(f"LLM 오류 HTTP {e.code} ({time.time() - t0:.1f}초)")
        return (429 if e.code == 429 else 502), {"error": f"HTTP {e.code} {detail}".strip()}, JSON
    except Exception as e:
        r = reason(e)
        log(f"LLM 호출 실패: {r} ({time.time() - t0:.1f}초)")
        return (504 if "시간 초과" in r else 502), {"error": r}, JSON
    log(f"LLM 호출 {nbytes:,}B 보냄 → {len(text):,}자 받음, {time.time() - t0:.1f}초, 모델 {model}")
    return 200, {"text": text, "model": model, "fallback": fallback}, JSON


def encode_body(body):
    if isinstance(body, bytes):
        return body
    return (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode("utf-8")


SECURITY_HEADERS = [("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")]


class Handler(BaseHTTPRequestHandler):
    cfg = None
    server_version = "reqai"

    def log_message(self, fmt, *args):  # 기본 접속 로그는 끕니다(필요한 것만 직접 찍음).
        pass

    def respond(self, method):
        code, body, ctype = route(self.cfg, method, self.path, self.headers.get, self.rfile.read, self.client_address[0])
        data = encode_body(body)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in SECURITY_HEADERS:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.respond("GET")

    def do_POST(self):
        self.respond("POST")


def check(cfg):
    llm = cfg["llm"]
    print(f"{llm_label(cfg)} 연결 시험")
    print(f"  provider : {llm['provider']}")
    if llm["provider"] != "anthropic":
        print(f"  base_url : {llm['base_url'] or '(비어 있음)'}")
    print(f"  model    : {llm['model'] or '(비어 있음)'}")
    print(f"  api_key  : {'설정됨' if llm['api_key'] else ('환경변수 ANTHROPIC_API_KEY' if llm['provider'] == 'anthropic' and os.environ.get('ANTHROPIC_API_KEY') else '없음')}")
    if not llm_enabled(cfg):
        print("→ provider가 none이거나 base_url이 비어 있습니다. settings.json을 고치세요.")
        return 1
    h = health(cfg)
    print(f"1) 서버 응답: {'성공' if h['ok'] else '실패 - ' + h['error']}")
    if not h["ok"]:
        return 1
    t0 = time.time()
    try:
        text, model, fallback = ask(cfg, '다음 JSON을 그대로 답하세요: {"ok": true, "msg": "연결 성공"}')
        if fallback:
            print(f"   ※ {fallback}")
    except LLMError as e:
        print(f"2) 시험 호출: 실패 - {e.message}")
        return 1
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
    if host not in ("127.0.0.1", "localhost") and not os.environ.get("PORT"):
        log(f"주의: {host}로 열면 같은 망의 다른 PC도 이 서버와 사내 LLM을 쓸 수 있습니다. 공용 운영 전에는 정보보호 검토를 받으세요.")
    Handler.cfg = cfg
    httpd = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '') else host}:{port}"
    log(f"실행 중: {url}  (끝내려면 Ctrl+C)")
    g = cfg["guard"]
    log(f"사용 한도: IP당 1시간 {g['per_ip_hour']}회, 하루 {g['per_day']}회 / 접속 코드 {'사용' if g['access_code'] else '없음'}")
    log(f"AI: {llm_label(cfg) + ' ' + cfg['llm']['model'] + ('' if cfg['llm']['provider'] == 'anthropic' else ' @ ' + cfg['llm']['base_url']) if llm_enabled(cfg) else '꺼짐 (예시 모드)'} / 라이브러리: {'vendor 폴더' if cfg['assets']['offline'] else 'CDN(인터넷)'}")
    if llm_enabled(cfg):
        h = health(cfg)
        log(f"{llm_label(cfg)} 응답 확인" if h["ok"] else "경고: " + h["error"])
        if cfg["llm"]["provider"] == "anthropic":
            log(f"크레딧 부족 시 대체: {fallback_label(cfg) + ' (GEMINI_API_KEY 설정됨)' if fallback_ready(cfg) else '없음 (GEMINI_API_KEY 없음)'}")
    if cfg["server"]["open_browser"] and not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("종료합니다.")


if __name__ == "__main__":
    main()
