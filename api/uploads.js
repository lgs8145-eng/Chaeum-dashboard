/**
 * 채움 대시보드 — 월별 정산 데이터 서버리스 함수 (Redis 저장)
 *
 * GET  /api/uploads?action=load          전체 월 데이터 로드 (admin + viewer)
 * POST /api/uploads?action=save          월 단위 저장 (admin)
 * POST /api/uploads?action=save-batch    다월 일괄 저장 — 마이그레이션용 (admin)
 * POST /api/uploads?action=delete        월 단위 삭제 (admin)
 *
 * 식단표 API(api/menus.js)와 동일한 인증·Redis 연결 패턴을 사용한다.
 * Redis 불가 시 load는 빈 객체를 반환하고, 쓰기는 500을 반환한다.
 * → 클라이언트는 localStorage 캐시로 화면을 유지한다(uploads-store.js).
 */

const { createClient } = require('redis');
const crypto = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || 'chaeum-tok-secret-v1-2026';
const UPLOADS_KEY = 'chaeum_uploads_data';

// ── 인증 ───────────────────────────────────────────────────────
function parseCookieHeader(str = '') {
  const out = {};
  str.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

function verifyHmacCookie(cookieHeader) {
  const raw = parseCookieHeader(cookieHeader || '')['chaeum_tok'] || '';
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [token, role, sig] = parts;
  if (!['admin', 'viewer'].includes(role)) return null;
  const expected = crypto.createHmac('sha256', AUTH_SECRET)
    .update(`${token}|${role}`)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expected) return null;
  return role;
}

// ── Redis ───────────────────────────────────────────────────────
let _client = null;

async function getRedis() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL not set');
  if (_client && _client.isOpen) return _client;
  const c = createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });
  c.on('error', () => { if (_client === c) _client = null; });
  await c.connect();
  _client = c;
  return _client;
}

async function rGet(key) {
  const r = await getRedis();
  const val = await r.get(key);
  if (val === null) return null;
  try { return JSON.parse(val); } catch { return val; }
}

async function rSet(key, value) {
  const r = await getRedis();
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  await r.set(key, str);
}

// ── 월 키 형식 검증 (예: "2026-04") ─────────────────────────────
function isMonthKey(k) {
  return typeof k === 'string' && /^\d{4}-\d{2}$/.test(k);
}

// ── 핸들러 ─────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';

  const role = verifyHmacCookie(req.headers.cookie);
  if (!role) return res.status(401).json({ ok: false, error: '인증이 필요합니다.' });

  try {
    // ── GET: 전체 로드 (admin + viewer) ─────────────────────────
    if (action === 'load' && req.method === 'GET') {
      let data = {};
      try { data = (await rGet(UPLOADS_KEY)) || {}; } catch {}
      return res.status(200).json({ ok: true, data });
    }

    // ── 쓰기 작업은 admin만 ────────────────────────────────────
    if (role !== 'admin') {
      return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    }

    // ── POST: 월 저장 (단건) ───────────────────────────────────
    if (action === 'save' && req.method === 'POST') {
      const { monthKey, record } = req.body || {};
      if (!isMonthKey(monthKey) || !record || typeof record !== 'object')
        return res.status(400).json({ ok: false, error: '파라미터 누락 또는 형식 오류' });
      let all = {};
      try { all = (await rGet(UPLOADS_KEY)) || {}; } catch {}
      all[monthKey] = record;
      await rSet(UPLOADS_KEY, all);
      return res.status(200).json({ ok: true });
    }

    // ── POST: 다월 일괄 저장 (마이그레이션용) ───────────────────
    // 단건 save 반복 호출 시 Redis read-modify-write 경합 발생 →
    // 한 번의 읽기/쓰기로 처리해 원자성 보장
    if (action === 'save-batch' && req.method === 'POST') {
      const { months } = req.body || {};
      if (!months || typeof months !== 'object')
        return res.status(400).json({ ok: false, error: '파라미터 누락' });
      for (const k of Object.keys(months)) {
        if (!isMonthKey(k)) return res.status(400).json({ ok: false, error: `월 키 형식 오류: ${k}` });
      }
      let all = {};
      try { all = (await rGet(UPLOADS_KEY)) || {}; } catch {}
      Object.assign(all, months);
      await rSet(UPLOADS_KEY, all);
      return res.status(200).json({ ok: true });
    }

    // ── POST: 월 삭제 ──────────────────────────────────────────
    if (action === 'delete' && req.method === 'POST') {
      const { monthKey } = req.body || {};
      if (!isMonthKey(monthKey)) return res.status(400).json({ ok: false, error: '파라미터 누락' });
      let all = {};
      try { all = (await rGet(UPLOADS_KEY)) || {}; } catch {}
      delete all[monthKey];
      await rSet(UPLOADS_KEY, all);
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ ok: false, error: 'unknown action' });

  } catch (err) {
    console.error('[api/uploads]', err.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
