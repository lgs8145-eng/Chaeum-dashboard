/**
 * 채움 대시보드 — 인증 모듈 (클라이언트)
 *
 * 비밀번호 검증·세션 관리는 서버(/api/auth)에서 수행.
 * 인증 결과는 HttpOnly 쿠키로 전달 → JS에서 직접 읽기 불가(XSS 방어).
 * authGetSession()은 Promise를 캐시하여 페이지 당 네트워크 요청 1회로 제한.
 */

let _sessionPromise = null; // 서버 검증 Promise (캐시)
let _sessionRole    = null; // 해결된 역할값 (동기 접근용)

// 세션 검증 — 캐시된 Promise를 재사용하여 중복 요청 방지
function authGetSession() {
  if (!_sessionPromise) {
    _sessionPromise = fetch('/api/auth?action=verify', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .catch(() => null)
      .then(data => {
        _sessionRole = data ? (data.role || null) : null;
        return data;
      });
  }
  return _sessionPromise;
}

// authGetSession() 이후 동기적으로 역할 확인
function authIsAdmin() {
  return _sessionRole === 'admin';
}

// 로그인 — 서버에 자격증명 전달, 성공 시 쿠키 자동 설정
// 반환값: 'admin' | 'viewer' | null(인증실패) | 'server_error' | 'network_error'
async function authLogin(id, pw) {
  try {
    const res = await fetch('/api/auth?action=login', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ id, pw }),
    });
    if (res.status === 401 || res.status === 400) return null; // 인증 실패
    if (!res.ok) return 'server_error';                        // 5xx 등 서버 오류
    const data   = await res.json();
    _sessionRole    = data.role || null;
    _sessionPromise = Promise.resolve(data);
    return data.role || null;
  } catch (e) { return 'network_error'; }
}

// 비밀번호 변경 — 서버에서 KV 업데이트 (전 기기 즉시 반영)
async function authChangePasswords({ currentAdminPw, newAdminPw, newViewerPw }) {
  try {
    const res = await fetch('/api/auth?action=change-pw', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ currentPw: currentAdminPw, newAdminPw, newViewerPw }),
    });
    const data = await res.json();
    if (!res.ok) return data.reason || 'error';
    return 'ok';
  } catch (e) { return 'error'; }
}

// 로그아웃 — 서버에서 세션 토큰 삭제 후 로그인 페이지로 이동
function authLogout() {
  _sessionRole    = null;
  _sessionPromise = null;
  fetch('/api/auth?action=logout', { method: 'POST', credentials: 'include' })
    .finally(() => window.location.replace('login.html'));
}
