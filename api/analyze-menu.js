/**
 * 채움 대시보드 — AI 식단 심층 분석 (Anthropic)
 *
 * POST /api/analyze-menu
 * Body: { menuText: string, period: string }
 * Returns: { ok: true, analysis: string }
 *
 * Auth: HMAC 쿠키 (admin 또는 viewer 허용)
 */

const Anthropic = require('@anthropic-ai/sdk');
const crypto    = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || 'chaeum-tok-secret-v1-2026';

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
  const raw = parseCookieHeader(cookieHeader)['chaeum_tok'] || '';
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

const SYSTEM_PROMPT = `당신은 구내식당 운영 전문 분석가입니다.
주간 식단 데이터를 분석하여 운영자에게 실질적인 인사이트를 제공하세요.

## 분석 3계층

### 1계층 — 반복 주기 분석
- 동일 메뉴(주요리 기준)의 주기 분포: 매주/2주/3주/4주 이상
- 과다 반복 메뉴(4주 내 3회 이상 등장): 목록화
- 반복 없이 1회만 등장한 다양성 메뉴: 비율

### 2계층 — 구성 적정성 평가
- 조식/중식A/중식B/석식 각각의 평균 메뉴 수
- 편중 패턴: 특정 요일·식사에 메뉴 수가 현저히 적은 경우
- 국/탕류·주식(밥/면)·반찬·김치 포함 여부 균형
- 개선 권고: 구체적인 메뉴 추가/교체 제안

### 3계층 — 운영 효율성 제안
- 식재료 재활용 관점: 동일 재료 활용 연속성(양파, 돼지고기 등)
- 계절성: 현재 시기에 맞는 제철 재료 활용 여부
- 워크로드 분산: 조리 난이도가 특정 요일에 집중되는지
- 1~2개 즉시 실행 가능한 개선 액션 제안

## 출력 형식
- 마크다운 사용 (### 헤더, **굵게**, 표, 체크리스트 항목은 - [ ] 형식)
- 숫자 근거 명시 (예: "제육볶음 4주 중 3회 등장")
- 운영자가 다음 주 식단 작성 시 즉시 활용 가능한 수준으로 구체적으로 작성
- 총 길이: 600~900 단어 내외`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const role = verifyHmacCookie(req.headers.cookie);
  if (!role) {
    return res.status(401).json({ ok: false, error: '인증이 필요합니다.' });
  }

  const { menuText = '', period = '' } = req.body || {};

  if (!menuText.trim()) {
    return res.status(400).json({ ok: false, error: 'menuText가 비어 있습니다.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userMessage = period
      ? `분석 기간: ${period}\n\n${menuText}`
      : menuText;

    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system:     SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const analysis = (response.content[0]?.text || '').trim();
    if (!analysis) throw new Error('분석 결과가 비어 있습니다.');

    return res.status(200).json({ ok: true, analysis });
  } catch (err) {
    console.error('[api/analyze-menu]', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'server_error' });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};
