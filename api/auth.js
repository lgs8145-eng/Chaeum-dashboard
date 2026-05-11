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

// Redis 연결 미설정 시 fallback — Chaeum@2026! / viewer2026
const DEFAULT_HASHES = {
  adminHash:  '70ecabc98a0b43d617b2d9bf0669318ab144f72d7fe8a40df83f59df2bf6f893',
  viewerHash: '35cbe0aaf4e558ac53847cf7b057f4a3a86a427e08935bffdf81d7b4ed7cd9f3',
};

// 서버리스 환경: 웜 실행 시 연결 재사용, 끊김 시 자동 재연결
let _client = null;

async function getRedis() {
  if (!_client || !_client.isOpen) {
    _client = createClient({ url: process.env.REDIS_URL });
    _client.on('error', () => { _client = null; });
    await _client.connect();
  }
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
  const stored = await rGet('chaeum_pw');
  return stored || DEFAULT_HASHES;
}

// ── 핸들러 ───────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';

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
    await rSet(`session:${token}`, role, TOKEN_TTL_SEC);

    setCookie(res, token, TOKEN_TTL_SEC);
    return res.status(200).json({ ok: true, role });
  }

  // ── 세션 검증 ────────────────────────────────────────────────
  if (action === 'verify' && req.method === 'GET') {
    const { chaeum_tok: token } = parseCookie(req.headers.cookie);
    if (!token) return res.status(401).json({ ok: false });

    const role = await rGet(`session:${token}`);
    if (!role) return res.status(401).json({ ok: false });

    return res.status(200).json({ ok: true, role });
  }

  // ── 비밀번호 변경 ────────────────────────────────────────────
  if (action === 'change-pw' && req.method === 'POST') {
    const { chaeum_tok: token } = parseCookie(req.headers.cookie);
    const role = token ? await rGet(`session:${token}`) : null;
    if (role !== 'admin') return res.status(403).json({ ok: false });

    const { currentPw = '', newAdminPw = '', newViewerPw = '' } = req.body || {};
    const hashes = await getHashes();

    if (sha256(currentPw) !== hashes.adminHash)
      return res.status(400).json({ ok: false, reason: 'wrong_current' });

    await rSet('chaeum_pw', {
      adminHash:  newAdminPw  ? sha256(newAdminPw)  : hashes.adminHash,
      viewerHash: newViewerPw ? sha256(newViewerPw) : hashes.viewerHash,
    });
    return res.status(200).json({ ok: true });
  }

  // ── 로그아웃 ─────────────────────────────────────────────────
  if (action === 'logout' && req.method === 'POST') {
    const { chaeum_tok: token } = parseCookie(req.headers.cookie);
    if (token) await rDel(`session:${token}`);
    setCookie(res, '', 0);
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ ok: false, error: 'unknown action' });
};
