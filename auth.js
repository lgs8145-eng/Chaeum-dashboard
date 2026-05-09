/**
 * 채움 대시보드 — 인증 모듈
 *
 * ⚠️  비밀번호 변경 방법:
 *   브라우저 콘솔에서 실행 →
 *   crypto.subtle.digest('SHA-256', new TextEncoder().encode('새비밀번호'))
 *     .then(b => console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')))
 *   출력된 값을 _ADMIN_HASH / _VIEWER_HASH 에 교체하거나,
 *   대시보드 내 [비밀번호 변경] 기능을 사용하세요 (localStorage에 저장됨).
 */

// ── 기본 해시 (배포 전 변경 권장) ────────────────────────
const _ADMIN_ID    = 'admin';
const _ADMIN_HASH  = '70ecabc98a0b43d617b2d9bf0669318ab144f72d7fe8a40df83f59df2bf6f893'; // Chaeum@2026!
const _VIEWER_HASH = '35cbe0aaf4e558ac53847cf7b057f4a3a86a427e08935bffdf81d7b4ed7cd9f3'; // viewer2026
// ─────────────────────────────────────────────────────────

const _AUTH_KEY = 'chaeum_session_v1';
const _PW_KEY   = 'chaeum_pw_v1';       // 변경된 비밀번호 해시 저장
const _AUTH_TTL = 8 * 3600 * 1000;      // 세션 유효시간: 8시간

// ── 내부 유틸 ─────────────────────────────────────────────
async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _getHashes() {
  try {
    const stored = JSON.parse(localStorage.getItem(_PW_KEY));
    if (stored && stored.adminHash && stored.viewerHash) return stored;
  } catch (e) {}
  return { adminHash: _ADMIN_HASH, viewerHash: _VIEWER_HASH };
}

// ── 세션 관리 ─────────────────────────────────────────────
function authGetSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(_AUTH_KEY));
    if (!s || !s.role || !s.time) return null;
    if (Date.now() - s.time > _AUTH_TTL) { authClear(); return null; }
    return s;
  } catch (e) { return null; }
}

function authSetSession(role) {
  sessionStorage.setItem(_AUTH_KEY, JSON.stringify({ role, time: Date.now() }));
}

function authClear() {
  sessionStorage.removeItem(_AUTH_KEY);
}

function authIsAdmin() {
  const s = authGetSession();
  return !!(s && s.role === 'admin');
}

// ── 로그인 ────────────────────────────────────────────────
async function authLogin(id, pw) {
  const hash   = await _sha256(pw);
  const hashes = _getHashes();
  if (id === _ADMIN_ID && hash === hashes.adminHash) {
    authSetSession('admin');
    return 'admin';
  }
  if (hash === hashes.viewerHash) {
    authSetSession('viewer');
    return 'viewer';
  }
  return null;
}

// ── 비밀번호 변경 ──────────────────────────────────────────
// newAdminPw / newViewerPw: 빈 문자열이면 해당 비밀번호 유지
// 반환값: 'ok' | 'wrong_current' | 'error'
async function authChangePasswords({ currentAdminPw, newAdminPw, newViewerPw }) {
  if (!authIsAdmin()) return 'error';

  const currentHash = await _sha256(currentAdminPw);
  const hashes      = _getHashes();

  if (currentHash !== hashes.adminHash) return 'wrong_current';

  const updatedAdminHash  = newAdminPw  ? await _sha256(newAdminPw)  : hashes.adminHash;
  const updatedViewerHash = newViewerPw ? await _sha256(newViewerPw) : hashes.viewerHash;

  localStorage.setItem(_PW_KEY, JSON.stringify({
    adminHash:  updatedAdminHash,
    viewerHash: updatedViewerHash
  }));
  return 'ok';
}

// ── 로그아웃 ──────────────────────────────────────────────
function authLogout() {
  authClear();
  window.location.replace('login.html');
}
