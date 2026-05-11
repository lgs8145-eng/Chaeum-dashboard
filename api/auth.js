/**
 * 채움 대시보드 — 인증 서버리스 함수 (Vercel KV)
 *
 * POST /api/auth?action=login       로그인 → HttpOnly 쿠키 발급
 * GET  /api/auth?action=verify      쿠키 토큰 검증
 * POST /api/auth?action=change-pw   비밀번호 변경 (어드민 전용)
 * POST /api/auth?action=logout      세션 토큰 무효화
 *
 * 비밀번호는 Vercel KV의 'chaeum_pw' 키에 { adminHash, viewerHash } JSON으로 저장.
 * KV 미설정 시 아래 DEFAULT_HASHES 로 fallback (최초 배포 한정).
 */

const { Redis } = require('@upstash/redis');
const crypto    = require('crypto');

const kv = Redis.fromEnv(); // REDIS_URL + REDIS_TOKEN 환경변수 자동 사용

const TOKEN_TTL_SEC = 8 * 3600; // 8시간

// KV 미설정 fallback — Chaeum@2026! / viewer2026
const DEFAULT_HASHES = {
  adminHash:  '70ecabc98a0b43d617b2d9bf0669318ab144f72d7fe8a40df83f59df2bf6f893',
  viewerHash: '35cbe0aaf4e558ac53847cf7b057f4a3a86a427e08935bffdf81d7b4ed7cd9f3',
};

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
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie',
    `chaeum_tok=${value}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Path=/`);
}

async function getHashes() {
  const stored = await kv.get('chaeum_pw');
  return stored || DEFAULT_HASHES;
}

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';

  // ── 로그인 ────────────────────────────────────────────────
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
    await kv.set(`session:${token}`, role, { ex: TOKEN_TTL_SEC });

    setCookie(res, token, TOKEN_TTL_SEC);
    return res.status(200).json({ ok: true, role });
  }

  // ── 세션 검증 ─────────────────────────────────────────────
  if (action === 'verify' && req.method === 'GET') {
    const { chaeum_tok: token } = parseCookie(req.headers.cookie);
    if (!token) return res.status(401).json({ ok: false });

    const role = await kv.get(`session:${token}`);
    if (!role) return res.status(401).json({ ok: false });

    return res.status(200).json({ ok: true, role });
  }

  // ── 비밀번호 변경 ──────────────────────────────────────────
  if (action === 'change-pw' && req.method === 'POST') {
    const { chaeum_tok: token } = parseCookie(req.headers.cookie);
    const role = token ? await kv.get(`session:${token}`) : null;
    if (role !== 'admin') return res.status(403).json({ ok: false });

    const { currentPw = '', newAdminPw = '', newViewerPw = '' } = req.body || {};
    const hashes = await getHashes();

    if (sha256(currentPw) !== hashes.adminHash)
      return res.status(400).json({ ok: false, reason: 'wrong_current' });

    await kv.set('chaeum_pw', {
      adminHash:  newAdminPw  ? sha256(newAdminPw)  : hashes.adminHash,
      viewerHash: newViewerPw ? sha256(newViewerPw) : hashes.viewerHash,
    });
    return res.status(200).json({ ok: true });
  }

  // ── 로그아웃 ───────────────────────────────────────────────
  if (action === 'logout' && req.method === 'POST') {
    const { chaeum_tok: token } = parseCookie(req.headers.cookie);
    if (token) await kv.del(`session:${token}`);
    setCookie(res, '', 0);
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ ok: false, error: 'unknown action' });
};
