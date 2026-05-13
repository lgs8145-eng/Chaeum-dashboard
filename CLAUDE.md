# CLAUDE.md

> 본 문서는 **채움 구내식당 운영 대시보드** 프로젝트의 개발·운영 필수 규칙입니다.
> Claude 및 모든 협업자는 코드 작성·검토·수정 시 이 기준을 반드시 준수해야 합니다.

---

## 1. 기술 스택

| 레이어 | 기술 | 비고 |
|--------|------|------|
| 호스팅 | Vercel (Static) | GitHub 자동 배포 |
| 서버리스 | Vercel Serverless Functions | `/api/*.js` (Node.js) |
| 세션 저장 | Vercel Redis (`REDIS_URL`) | 연결 실패 시 in-memory fallback |
| 클라이언트 데이터 | localStorage | 기기별 저장 (월 데이터, 식단표) |
| 인증 모델 | 공유 비밀번호 + HttpOnly 쿠키 | admin / viewer 2계층 |
| Excel 파싱 | SheetJS (xlsx) CDN | `cdn.jsdelivr.net` |
| 차트 | Chart.js CDN | `cdnjs.cloudflare.com` |

---

## 2. 디렉토리 구조

```
/                   ← HTML 페이지 (Vercel 정적 서빙 — 루트 필수)
  index.html        ← 메인 대시보드
  login.html        ← 로그인
  menu.html         ← 식단 분석
  auth.js           ← 클라이언트 인증 모듈 (authGetSession 등)
  data.js           ← 기본 월 데이터 (CHAEUM_DATA)
  excel-parser.js   ← Excel 파싱 유틸 (추후 /utils 이동 예정)
  vercel.json       ← Vercel 설정 (CSP, rewrites, headers)
  package.json      ← Node 의존성 (redis 패키지)

/api/               ← Vercel 서버리스 함수 (Node.js, 공개 URL /api/*)
  auth.js           ← 인증 API (login / verify / change-pw / logout)

/utils/             ← 공통 유틸 함수 (신규 JS 유틸은 여기에)
/config/            ← 상수·매핑 룰 (하드코딩 대신 여기에)
/data/              ← 샘플 데이터·스키마 정의
/docs/              ← 설계 문서
```

**HTML 파일 위치 예외**
`index.html`, `login.html`, `menu.html` 등 HTML 파일은 Vercel 정적 서빙 구조상
루트에 있어야 한다. 디렉토리 분리 대상이 아님.

---

## 3. Non-Negotiable Rules (절대 원칙)

| No. | 원칙 | 설명 |
|----|------|------|
| 1 | 추측 구현 금지 | 불확실하면 **구현 전에 질문 먼저**. 임의 판단으로 코드 작성 금지. |
| 2 | 하드코딩 최소화 | 설정값·상수·매핑 룰은 `/config`로 분리. 비밀번호 해시·URL은 환경변수 우선. |
| 3 | 중복 로직 금지 | 공통 로직은 `/utils` 또는 `auth.js`로 추출. HTML 내 인라인 중복 금지. |
| 4 | 예외처리 필수 | 외부 호출(fetch, Redis, Excel 파싱)·비동기 처리에는 반드시 `try/catch`. |
| 5 | Redis fallback 유지 | Redis 불가 시 in-memory fallback 패턴 유지. 연결 타임아웃 3초 준수. |
| 6 | 영향 범위 선설명 | 수정 전 영향 파일·기능·데이터를 먼저 설명 후 진행. |
| 7 | 기존 코드 삭제 전 검토 | 삭제·리팩터 전 의존성·참조 확인 필수. |
| 8 | 운영 관점 우선 | 개발 편의보다 운영·유지보수 관점이 우선. |
| 9 | 기존 파일 수정 우선 | 신규 파일 생성 전 **기존 파일 수정으로 해결 가능한지 검토**. |
| 10 | 문제 발견 시 선제안 | 구현 전 구조적 개선안을 먼저 제안. |

---

## 4. Vercel 서버리스 함수 규칙 (`/api/*.js`)

- **타임아웃 고려**: 함수 실행 시간 10초 이내로 유지. 외부 I/O(Redis)에 반드시 타임아웃 설정.
- **Redis 연결 패턴 준수**:
  ```js
  socket: { connectTimeout: 3000, reconnectStrategy: false }
  ```
- **연결 재사용**: `_client` 전역 변수로 웜 인스턴스 간 연결 재사용.
- **fallback 필수**: `try { Redis 작업 } catch { in-memory fallback }` 패턴 유지.
- **환경변수**: `process.env.REDIS_URL` 미설정 시 즉시 에러 → fallback 진입.
- **bodyParser**: `module.exports.config = { api: { bodyParser: true } }` 명시.
- **CORS·CSP**: `vercel.json`의 보안 헤더를 우회하는 코드 금지.

---

## 5. 인증 규칙

- **세션**: HttpOnly + Secure + SameSite=Strict 쿠키 (`chaeum_tok`).
- **비밀번호**: SHA-256 해시만 저장. 평문 절대 저장·로그 금지.
- **버전 관리**: `PW_VERSION` 상수로 Redis 저장 해시 강제 초기화 가능.
- **역할 구분**: `admin` (데이터 업로드·수정·비밀번호 변경) / `viewer` (조회·PDF).
- **클라이언트**: `authGetSession()` Promise 캐시로 페이지당 요청 1회 제한.

---

## 6. 클라이언트 데이터 규칙 (localStorage)

- 월 데이터 키: `chaeum_uploads_v1`
- 식단 데이터 키: `chaeum_menus_v1`
- **스키마 변경 시**: 키 버전(v1 → v2) 올리고 마이그레이션 코드 추가.
- **데이터 손실 주의**: localStorage는 기기·브라우저별 저장. 서버 저장이 필요한 데이터는 Redis API 경유.

---

## 7. 보안 규칙

- 민감 정보(비밀번호, REDIS_URL 등)는 절대 커밋 금지 → `.gitignore` + Vercel 환경변수.
- CSP(`vercel.json`) 허용 출처 외 외부 스크립트 추가 금지.
- `eval()`, `innerHTML` 직접 사용 금지 (XSS 방어).
- 사용자 입력은 서버에서 재검증. 클라이언트 검증만으로 신뢰 금지.

---

## 8. 작업 진행 표준 절차

1. 요청 내용 이해 → 불명확한 부분 **질문 우선**
2. 영향 범위·관련 파일·운영 리스크 **선설명**
3. 신규 파일 생성 전 **기존 파일 수정 가능성 검토**
4. 구조적 개선안 제안 (필요 시)
5. 합의 후 구현
6. 예외처리 및 Redis fallback 포함 확인
7. 변경 사항·테스트 방법 명시

---

## 9. 금지 사항

- 임시 파일 생성 (`tmp_`, `test_`, `backup_`, `copy_` 등 명명 포함)
- 민감 정보 코드 내 하드코딩
- 예외처리 누락
- Redis 호출에 타임아웃 미설정
- 영향 범위 검토 없는 코드 삭제·수정
- 추측 기반 구현
- CSP 허용 목록 외 CDN 추가

---

## 10. 커밋 규칙

- **언어**: 한국어
- **형식**: `[기능 요약] — [세부 내용]`
- **Co-author**: 반드시 포함
  ```
  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```
- **금지**: `node_modules/`, `.env`, `.env.local` 커밋

---

_본 문서는 프로젝트 운영 표준이며, 변경 시 사전 검토 및 합의가 필요합니다._
