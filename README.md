# 모두의 요구사항 한 번에!

**말한 건 다 담고, 빠진 건 먼저 묻는 AI**

고객 요청 메일, 회의록, 참고 문서를 넣으면 민감정보를 먼저 가린 뒤 AI가 요구사항을 뽑아 출처를 달고, 빠진 것·서로 다른 의견·모호한 표현을 찾아 확인 질문 메일까지 만듭니다. 회신을 넣으면 바뀐 요구사항만 고치고 이력을 남기며, 부서 양식에 맞춘 요구사항 정의서를 Word·Excel·Markdown으로 내보냅니다.

| 단계 | 하는 일 |
|---|---|
| 1. 자료 입력 | 붙여 넣기, 파일 올리기, **폴더째 끌어다 놓기**(하위 폴더까지, 이름으로 자동 분류). PDF·Word·Excel·PPT·HWPX·TXT·EML |
| 2. 민감정보 가리기 | 이름·연락처·이메일·계좌·카드·주민·사업자번호·IP를 브라우저 안에서 `[이름-1]` 같은 토큰으로 바꿈. AI에는 토큰만 전송 |
| 3. AI 분석 | 요구사항 추출·분류, 출처, 수용 여부, AS-IS/TO-BE, 결정·미결·후속 조치, 누락·충돌·모호 점검 |
| 4. 검토·점검 | 근거 문장과 **AI 판단 근거(왜 뽑았나·왜 그렇게 판단했나·확신도)** 확인, 수정·확정, 확인 질문 메일, 회신 반영과 변경 이력 |
| 5. 문서 만들기 | 양식 편집(목차·열), Word·Excel(추적표 포함)·Markdown 내보내기, **품의문(한글 .hwpx, 사내 문서 작성 표준)**, **요구사항명세서(사내 Excel 양식)**, **AI 판단 기록(.md)** |

## 빠른 시작

| 방법 | 필요한 것 | AI |
|---|---|---|
| A. 브라우저로 바로 열기 | 브라우저만 | 예시 모드(미리 분석한 가상 사례로 전 기능 체험) |
| B. 실행 서버로 열기 | Python 3.8 이상 | 사내 LLM(OpenAI 호환 API) 또는 **Claude API**(`pip install anthropic`, 키는 `settings.json`의 `llm.api_key` 또는 환경변수 `ANTHROPIC_API_KEY`) |
| C. claude.ai 아티팩트 | Claude 계정 | 보는 사람의 Claude 계정 |

```bash
# A. 설치 없이: dist/standalone.html 을 더블클릭
#    (GitHub Pages를 켜면 저장소 Pages 주소에서 바로 열림)

# B. 사내 LLM과 함께
cp settings.example.json settings.json   # Windows: copy settings.example.json settings.json
#    settings.json 의 llm.provider, base_url, model 을 고치고
python serve.py --check                  # 연결 시험
python serve.py                          # http://127.0.0.1:8080 이 열림 (Windows는 start.bat 더블클릭도 가능)
```

사내 LLM만 쓰면 추가 패키지 설치는 필요 없습니다(파이썬 표준 라이브러리만 사용). Claude API는 `pip install anthropic`이 필요합니다.

**웹에 올려 URL로 쓰기**: 저장소의 `render.yaml`로 Render에 올리면 URL만으로 Claude API 분석까지 쓸 수 있습니다. API 키는 Render 환경변수에만 넣습니다(매뉴얼 4.9). 폐쇄망 설치, 사내 LLM 연결 방법, 문제 해결은 **[사용자 매뉴얼](docs/사용자매뉴얼.md)** 에 있습니다.

## 폴더 구조

```
├─ dist/standalone.html     실행 파일(빌드 결과). 이 파일 하나로 동작
├─ dist/requirements.html   claude.ai 아티팩트용 본문
├─ src/                     원본(shell.html, sample.js, engine.js, forms.js, app.js)
├─ build.py                 src → dist 빌드
├─ serve.py                 실행 서버 + 사내 LLM 중계
├─ settings.example.json    설정 예시(복사해서 settings.json으로)
├─ fetch_vendor.py          폐쇄망 반입용 라이브러리 내려받기
├─ start.bat                Windows 실행
├─ render.yaml              웹 호스팅(Render) 설정
├─ requirements.txt         Claude API용 패키지(anthropic)
└─ docs/사용자매뉴얼.md
```

## 보안

- 개발·시연에는 직접 만든 가상 자료만 썼습니다. 예시 속 기관·인물·번호는 모두 가상입니다.
- 민감정보 가리기는 브라우저 안에서 일어나고, 원래 값은 AI로 보내지 않습니다. 단, 자동 탐지는 규칙 기반이라 모든 민감정보를 찾는다고 보장하지 않습니다. 보내기 전 미리보기에서 꼭 확인하세요.
- 입력 자료는 서버나 브라우저 저장소에 남기지 않습니다(양식·작성자 정보만 브라우저에 저장).
- 이 저장소는 **프로토타입**입니다. 실제 업무 자료에 쓰거나 조직 내 운영 서비스로 배포하기 전에는 소속 기관의 정보보호 검토를 받으세요.

## 라이선스

<!-- 공개 전에 라이선스를 정해 LICENSE 파일을 추가하세요. -->
미정. 함께 쓰는 라이브러리: pdf.js(Apache-2.0), mammoth(BSD-2-Clause), JSZip(MIT/GPLv3 이중), SheetJS CE(Apache-2.0).
