/**
 * 채움 대시보드 — 인증 서버리스 함수 (Vercel Redis)
 *
 * POST /api/auth?action=login       로그인 → HttpOnly 쿠키 발급
 * GET  /api/auth?action=verify      쿠키 토큰 검증
 * POST /api/auth?action=change-pw   비밀번호 변경 (어드민 전용)
 * POST /api/auth?action=logout      세션 토큰 무효화
 */

const { createClient } = require('redis');
const crypto = require('crypto');

const TOKEN_TTL_SEC = 8 * 3600; // 8시간

// HMAC 서명 시크릿 — 환경변수 없으면 하드코딩 기본값 사용 (보안 강화 시 AUTH_SECRET 설정)
const AUTH_SECRET = process.env.AUTH_SECRET || 'chaeum-tok-secret-v1-2026';

// 쿠키값 생성: "{token}.{role}.{hmac32}" — 서버리스 재시작 후에도 자체 검증 가능
function makeCookieValue(token, role) {
  const sig = crypto.createHmac('sha256', AUTH_SECRET)
    .update(`${token}|${role}`)
    .digest('hex')
    .slice(0, 32);
  return `${token}.${role}.${sig}`;
}

// 쿠키값 파싱 + HMAC 검증 → { token, role } 또는 null
function parseCookieValue(value) {
  const parts = (value || '').split('.');
  if (parts.length !== 3) return null;
  const [token, role, sig] = parts;
  if (!['admin', 'viewer'].includes(role)) return null;
  const expected = crypto.createHmac('sha256', AUTH_SECRET)
    .update(`${token}|${role}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return null;
  return { token, role };
}

// 쿠키에서 역할 추출 (HMAC 우선, 레거시 Redis/mem 폴백)
async function getRoleFromCookie(cookieHeader) {
  const raw = parseCookie(cookieHeader)['chaeum_tok'] || '';
  const parsed = parseCookieValue(raw);
  if (parsed) return { role: parsed.role, token: parsed.token };
  // 레거시 plain-hex 토큰 (HMAC 적용 전 로그인 세션 대응)
  if (raw) {
    let role = null;
    try { role = await rGet(`session:${raw}`); } catch {}
    if (!role) role = memGet(raw);
    if (role) return { role, token: raw };
  }
  return { role: null, token: null };
}

// 버전을 올리면 Redis 저장값을 무시하고 DEFAULT_HASHES로 강제 초기화
const PW_VERSION = 2;

// 기본 로그인 정보 — admin: hecto2026!@  /  viewer: hecto2026#$
const DEFAULT_HASHES = {
  v:          PW_VERSION,
  adminHash:  'b6af9b5f7472db26402d990986e2a728bd8ebc61ecce1437dbfbec5f65c973ea',
  viewerHash: 'b2da987f752314f2a1e430f154a33cfc1c8a75f3d3df512dc194b9fb43d09b9d',
};

// Redis 불가 시 인메모리 세션 fallback (콜드 스타트 시 초기화되나 저트래픽 환경에서 허용)
const _memSessions = new Map();

function memSet(token, role) {
  if (_memSessions.size > 200) {
    const now = Date.now();
    for (const [k, v] of _memSessions) { if (v.exp < now) _memSessions.delete(k); }
  }
  _memSessions.set(token, { role, exp: Date.now() + TOKEN_TTL_SEC * 1000 });
}

function memGet(token) {
  const s = _memSessions.get(token);
  if (!s || s.exp < Date.now()) { _memSessions.delete(token); return null; }
  return s.role;
}

// 서버리스 환경: 웜 실행 시 연결 재사용, 끊김 시 자동 재연결
let _client = null;

async function getRedis() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL not set');
  if (_client && _client.isOpen) return _client;
  const c = createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: 3000,   // 3초 내 연결 안 되면 에러
      reconnectStrategy: false, // 서버리스에서 무한 재연결 방지
    },
  });
  c.on('error', () => { if (_client === c) _client = null; });
  await c.connect();
  _client = c;
  return _client;
}

// Redis는 문자열만 저장 → JSON 직렬화/역직렬화 래퍼
async function rGet(key) {
  const r = await getRedis();
  const val = await r.get(key);
  if (val === null) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function rSet(key, value, exSec) {
  const r = await getRedis();
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  await r.set(key, str, exSec ? { EX: exSec } : {});
}

async function rDel(key) {
  const r = await getRedis();
  await r.del(key);
}

// ── 공통 유틸 ────────────────────────────────────────────────
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookie(str = '') {
  const out = {};
  str.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie',
    `chaeum_tok=${value}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Path=/`);
}

async function getHashes() {
  try {
    const stored = await rGet('chaeum_pw');
    if (!stored || stored.v !== PW_VERSION) {
      // 버전 불일치 → DEFAULT_HASHES 덮어쓰기 (실패해도 무시)
      rSet('chaeum_pw', DEFAULT_HASHES).catch(() => {});
      return DEFAULT_HASHES;
    }
    return stored;
  } catch {
    return DEFAULT_HASHES;
  }
}

// ── 핸들러 ───────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';
  try {

  // ── 로그인 ──────────────────────────────────────────────────
  if (action === 'login' && req.method === 'POST') {
    const { id = '', pw = '' } = req.body || {};
    if (!pw) return res.status(400).json({ ok: false });

    const hashes = await getHashes();
    const hash   = sha256(pw);

    let role = null;
    if (id === 'admin' && hash === hashes.adminHash)  role = 'admin';
    else if (hash === hashes.viewerHash)               role = 'viewer';

    if (!role) return res.status(401).json({ ok: false });

    const token = makeToken();
    try { await rSet(`session:${token}`, role, TOKEN_TTL_SEC); } catch { memSet(token, role); }

    setCookie(res, makeCookieValue(token, role), TOKEN_TTL_SEC);
    return res.status(200).json({ ok: true, role });
  }

  // ── 세션 검증 ────────────────────────────────────────────────
  if (action === 'verify' && req.method === 'GET') {
    const { role } = await getRoleFromCookie(req.headers.cookie);
    if (!role) return res.status(401).json({ ok: false });
    return res.status(200).json({ ok: true, role });
  }

  // ── 비밀번호 변경 ────────────────────────────────────────────
  if (action === 'change-pw' && req.method === 'POST') {
    const { role } = await getRoleFromCookie(req.headers.cookie);
    if (role !== 'admin') return res.status(403).json({ ok: false });

    const { currentPw = '', newAdminPw = '', newViewerPw = '' } = req.body || {};
    const hashes = await getHashes();

    if (sha256(currentPw) !== hashes.adminHash)
      return res.status(400).json({ ok: false, reason: 'wrong_current' });

    await rSet('chaeum_pw', {
      v:          PW_VERSION,
      adminHash:  newAdminPw  ? sha256(newAdminPw)  : hashes.adminHash,
      viewerHash: newViewerPw ? sha256(newViewerPw) : hashes.viewerHash,
    });
    return res.status(200).json({ ok: true });
  }

  // ── 로그아웃 ─────────────────────────────────────────────────
  if (action === 'logout' && req.method === 'POST') {
    const { token } = await getRoleFromCookie(req.headers.cookie);
    if (token) {
      try { await rDel(`session:${token}`); } catch {}
      _memSessions.delete(token);
    }
    setCookie(res, '', 0);
    return res.status(200).json({ ok: true });
  }

      return res.status(404).json({ ok: false, error: 'unknown action' });
  } catch (err) {
    console.error('[api/auth]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

// Vercel: JSON body 자동 파싱 명시
module.exports.config = { api: { bodyParser: true } };
