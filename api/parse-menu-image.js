/**
 * 채움 대시보드 — 식단표 이미지 분석 (Anthropic Vision)
 *
 * POST /api/parse-menu-image
 * Body: { imageBase64: string, mediaType: string }
 * Returns: { ok: true, data: { weekStart, days[] } }
 */

const Anthropic = require('@anthropic-ai/sdk');

const PROMPT = `이 이미지는 한국 구내식당의 주간 식단표입니다.
이미지에서 날짜별 식사 메뉴를 읽어 아래 JSON 형식으로만 반환하세요. 설명이나 코드블록 없이 순수 JSON만 출력하세요.

식사 구분 매핑:
- breakfast: 조식 / 아침
- lunchA: 중식A / A코스 / 점심A / L-A
- lunchB: 중식B / B코스 / 점심B / L-B (없으면 빈 배열)
- dinner: 석식 / 저녁 (없으면 빈 배열)

메뉴 분리 규칙:
- 쉼표, 슬래시, 줄바꿈으로 구분된 항목을 각각 별도 문자열로 분리
- 예) "된장찌개/제육볶음/밥/김치" → ["된장찌개","제육볶음","밥","김치"]
- 공백만 있는 항목 제외

날짜 처리:
- 연도가 없으면 2026년으로 간주
- YYYY-MM-DD 형식으로 반환, 파악 불가시 null

출력 형식:
{"weekStart":"YYYY-MM-DD","days":[{"date":"YYYY-MM-DD","dayLabel":"M/D(요일)","breakfast":[],"lunchA":[],"lunchB":[],"dinner":[]}]}`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { imageBase64, mediaType = 'image/jpeg' } = req.body || {};

  if (!imageBase64) {
    return res.status(400).json({ ok: false, error: 'imageBase64 필드가 필요합니다.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    });

    const raw = (response.content[0]?.text || '').trim();

    // JSON만 추출 (앞뒤 마크다운 코드블록 제거)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('이미지에서 식단 정보를 인식하지 못했습니다.');

    const data = JSON.parse(jsonMatch[0]);

    if (!data.days || !Array.isArray(data.days)) {
      throw new Error('식단 구조를 파악하지 못했습니다. 더 선명한 이미지를 사용해주세요.');
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('[api/parse-menu-image]', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'server_error' });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
