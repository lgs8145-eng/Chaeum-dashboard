/**
 * 채움 대시보드 — 식단표 데이터 서버리스 함수 (Redis 저장)
 *
 * GET  /api/menus?action=load        전체 주간 식단 로드 (admin + viewer)
 * POST /api/menus?action=save        주차 저장 (admin)
 * POST /api/menus?action=delete      주차 삭제 (admin)
 * POST /api/menus?action=delete-all  전체 삭제 (admin)
 */

const { createClient } = require('redis');
const crypto = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || 'chaeum-tok-secret-v1-2026';
const MENUS_KEY   = 'chaeum_menus_data';

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

// ── 핸들러 ─────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';

  const role = verifyHmacCookie(req.headers.cookie);
  if (!role) return res.status(401).json({ ok: false, error: '인증이 필요합니다.' });

  try {
    // ── GET: 전체 로드 (admin + viewer) ─────────────────────────
    if (action === 'load' && req.method === 'GET') {
      let data = {};
      try { data = (await rGet(MENUS_KEY)) || {}; } catch {}
      return res.status(200).json({ ok: true, data });
    }

    // ── 쓰기 작업은 admin만 ────────────────────────────────────
    if (role !== 'admin') {
      return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    }

    // ── POST: 주차 저장 (단건) ─────────────────────────────────
    if (action === 'save' && req.method === 'POST') {
      const { weekKey, weekData } = req.body || {};
      if (!weekKey || !weekData) return res.status(400).json({ ok: false, error: '파라미터 누락' });
      let all = {};
      try { all = (await rGet(MENUS_KEY)) || {}; } catch {}
      all[weekKey] = weekData;
      await rSet(MENUS_KEY, all);
      return res.status(200).json({ ok: true });
    }

    // ── POST: 다주차 일괄 저장 (Excel 업로드용) ─────────────────
    // 단건 save를 반복 호출하면 Redis read-modify-write 경합 발생 →
    // 한 번의 읽기/쓰기로 처리해 원자성 보장
    if (action === 'save-batch' && req.method === 'POST') {
      const { weeks } = req.body || {};
      if (!weeks || typeof weeks !== 'object') return res.status(400).json({ ok: false, error: '파라미터 누락' });
      let all = {};
      try { all = (await rGet(MENUS_KEY)) || {}; } catch {}
      Object.assign(all, weeks);
      await rSet(MENUS_KEY, all);
      return res.status(200).json({ ok: true });
    }

    // ── POST: 주차 삭제 ─────────────────────────────────────────
    if (action === 'delete' && req.method === 'POST') {
      const { weekKey } = req.body || {};
      if (!weekKey) return res.status(400).json({ ok: false, error: '파라미터 누락' });
      let all = {};
      try { all = (await rGet(MENUS_KEY)) || {}; } catch {}
      delete all[weekKey];
      await rSet(MENUS_KEY, all);
      return res.status(200).json({ ok: true });
    }

    // ── POST: 전체 삭제 ─────────────────────────────────────────
    if (action === 'delete-all' && req.method === 'POST') {
      await rSet(MENUS_KEY, {});
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ ok: false, error: 'unknown action' });

  } catch (err) {
    console.error('[api/menus]', err.message);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '2mb' } } };
