/**
 * 채움 대시보드 — Excel(xlsx) 파서
 * 파일 형식: HT_구내식당(채움)_YY년M월정산_vX.X.xlsx
 *
 * SheetJS(XLSX) 라이브러리가 먼저 로드되어야 합니다.
 */

/* ── 내부 유틸 ─────────────────────────────────────────── */

function _sheet(wb, keyword) {
  const name = wb.SheetNames.find(n => n.includes(keyword));
  return name ? wb.Sheets[name] : null;
}

function _cv(sheet, addr) {
  if (!sheet) return null;
  const c = sheet[addr];
  return c != null ? c.v : null;
}

function _cn(sheet, addr) {
  const v = _cv(sheet, addr);
  return typeof v === 'number' ? v : null;
}

function _cs(sheet, addr) {
  const v = _cv(sheet, addr);
  return v != null ? String(v).trim() : null;
}

// Excel 날짜 시리얼 → "M/D(요일)" 형식
function _serialToKoreanDate(serial) {
  if (!serial || typeof serial !== 'number') return '';
  try {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (!parsed || !parsed.y) return '';
    const date = new Date(parsed.y, parsed.m - 1, parsed.d);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${parsed.m}/${parsed.d}(${days[date.getDay()]})`;
  } catch (e) { return ''; }
}

// Excel 날짜 시리얼 → { year, month, day }
function _serialToYMD(serial) {
  if (!serial || typeof serial !== 'number') return null;
  try {
    const p = XLSX.SSF.parse_date_code(serial);
    return (p && p.y) ? { year: p.y, month: p.m, day: p.d } : null;
  } catch (e) { return null; }
}

// 셀 값(숫자 시리얼 · JS Date · 텍스트) → { year, month, day }
function _cellToYMD(sheet, addr) {
  const c = sheet[addr];
  if (!c) return null;
  if (c.t === 'd') {
    const d = c.v;
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  if (typeof c.v === 'number') return _serialToYMD(c.v);
  if (c.t === 's') {
    const m = String(c.v).trim().match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  }
  return null;
}

// { year, month, day } → "M/D(요일)"
function _ymdToKorean(ymd) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${ymd.month}/${ymd.day}(${days[new Date(ymd.year, ymd.month - 1, ymd.day).getDay()]})`;
}

/* ── 메인 파서 ─────────────────────────────────────────── */

/**
 * @param {ArrayBuffer} arrayBuffer  xlsx 파일 ArrayBuffer
 * @returns {{ monthKey: string, record: object }}
 * @throws {Error} 파싱 실패 시
 */
function parseChaeumExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  /* 시트 참조 */
  const sh정산   = _sheet(wb, '법인별정산');
  const sh인원   = _sheet(wb, '법인별 인원');
  const sh식재료 = _sheet(wb, '식재료비');
  const sh식수   = _sheet(wb, '별첨3');
  const sh라면   = _sheet(wb, '별첨)라면');

  if (!sh정산) throw new Error("'법인별정산_헥토' 시트를 찾을 수 없습니다. 파일 형식을 확인하세요.");
  if (!sh식수)  throw new Error("'별첨3)식사인원' 시트를 찾을 수 없습니다. 파일 형식을 확인하세요.");

  /* ── 1. 원가 구성 ──────────────────────────────────── */
  const food         = Math.round(_cn(sh정산, 'F23') || 0);
  const labor        = Math.round(_cn(sh정산, 'F24') || 0);
  const opex         = Math.round(_cn(sh정산, 'F25') || 0);
  const mgmt         = Math.round(_cn(sh정산, 'F26') || 0);
  const supplyTotal  = Math.round(_cn(sh정산, 'F27') || (food + labor + opex + mgmt));
  const vatTotal     = Math.round(_cn(sh정산, 'I18') || Math.round(supplyTotal * 0.1));
  const billingTotal = Math.round(_cn(sh정산, 'F28') || (supplyTotal + vatTotal));

  /* ── 2. 정산 인원 ──────────────────────────────────── */
  const headcount = Math.round(_cn(sh정산, 'D18') || 0);

  /* ── 3. 법인별 인원 현황 ───────────────────────────── */
  let onsite = 0, leave = 0, offsite = 0, applied = 0;
  if (sh인원) {
    onsite  = Math.round(_cn(sh인원, 'C15') || 0);
    leave   = Math.round(_cn(sh인원, 'D15') || 0);
    offsite = Math.round(_cn(sh인원, 'E15') || 0);
    applied = Math.round(_cn(sh인원, 'F15') || 0);
  }

  /* ── 4. 회사별 정산 (행 7–17) ─────────────────────── */
  const companies = [];
  for (let row = 7; row <= 17; row++) {
    const name = _cs(sh정산, `B${row}`);
    if (!name || name === '합계') continue;
    const hc     = Math.round(_cn(sh정산, `D${row}`) || 0);
    const ratio  = _cn(sh정산, `E${row}`) || 0;
    const supply = Math.round(_cn(sh정산, `F${row}`) || 0);
    const vat    = Math.round(_cn(sh정산, `I${row}`) || 0);
    const total  = Math.round(_cn(sh정산, `J${row}`) || 0);
    if (hc > 0 || supply > 0) {
      companies.push({ name, headcount: hc, ratio: Math.round(ratio * 10000) / 10000, supply, vat, total });
    }
  }

  /* ── 5. 일별 식수 (별첨3)식사인원) ────────────────── */
  // 집계 행: 26번 행
  const mPrepared   = Math.round(_cn(sh식수, 'D26') || 0); // 조식 준비
  const mActual     = Math.round(_cn(sh식수, 'E26') || 0); // 조식 실제
  const mSnack1     = Math.round(_cn(sh식수, 'F26') || 0); // 간편식1
  const mSnack2     = Math.round(_cn(sh식수, 'G26') || 0); // 간편식2
  const mRamen      = Math.round(_cn(sh식수, 'H26') || 0); // 조식 라면
  const laAPrepared = Math.round(_cn(sh식수, 'J26') || 0); // 중식A 준비
  const laAActual   = Math.round(_cn(sh식수, 'K26') || 0); // 중식A 실제
  const laBPrepared = Math.round(_cn(sh식수, 'L26') || 0); // 중식B 준비
  const laBActual   = Math.round(_cn(sh식수, 'M26') || 0); // 중식B 실제
  const lRamen      = Math.round(_cn(sh식수, 'N26') || 0); // 중식 라면
  const lSalad      = Math.round(_cn(sh식수, 'O26') || 0); // 중식 샐러드
  const dPrepared   = Math.round(_cn(sh식수, 'Q26') || 0); // 석식 준비
  const dActual     = Math.round(_cn(sh식수, 'R26') || 0); // 석식 실제
  const dRamen      = Math.round(_cn(sh식수, 'S26') || 0); // 석식 라면
  const dHotpot     = Math.round(_cn(sh식수, 'T26') || 0); // 즉석전골
  const totalPrepared = Math.round(_cn(sh식수, 'V26') || 0);
  const totalActual   = Math.round(_cn(sh식수, 'W26') || 0);

  // 일별 데이터 (행 4부터 연속)
  const daily = [];
  let businessDays = 0;
  let settlementYear = null, settlementMonth = null;

  for (let row = 4; row <= 60; row++) {
    const ymd       = _cellToYMD(sh식수, `B${row}`);
    const vPrepared = _cn(sh식수, `V${row}`);
    if (!ymd || vPrepared == null) break;

    businessDays++;
    const dateStr = _ymdToKorean(ymd);
    if (!settlementYear) {
      settlementYear  = ymd.year;
      settlementMonth = ymd.month;
    }
    daily.push([dateStr, Math.round(vPrepared), Math.round(_cn(sh식수, `W${row}`) || 0)]);
  }

  if (!settlementYear) throw new Error('정산 월을 식수 시트에서 읽을 수 없습니다. 날짜 셀을 확인하세요.');

  const monthKey = `${settlementYear}-${String(settlementMonth).padStart(2, '0')}`;
  const label    = `${settlementYear}년 ${settlementMonth}월`;

  /* ── 6. 식사 유형별 집계 ───────────────────────────── */
  const miscPrepared = Math.max(0, totalPrepared - mPrepared - laAPrepared - laBPrepared - dPrepared);
  const miscActual   = Math.max(0, totalActual   - mActual   - laAActual   - laBActual   - dActual);

  const mealBreakdown = [
    { label: '조식 (M)',          prepared: mPrepared,   actual: mActual   },
    { label: '중식 A (L-A)',      prepared: laAPrepared, actual: laAActual },
    { label: '중식 B (L-B)',      prepared: laBPrepared, actual: laBActual },
    { label: '석식 (D)',          prepared: dPrepared,   actual: dActual   },
    { label: '간편식·라면·기타',  prepared: miscPrepared, actual: miscActual }
  ];

  const mealMix = {
    labels: ['조식', '중식 A', '중식 B', '석식', '간편식', '라면', '샐러드/기타'],
    values: [
      mActual,
      laAActual,
      laBActual,
      dActual,
      mSnack1 + mSnack2,
      mRamen + lRamen + dRamen,
      lSalad + dHotpot
    ]
  };

  /* ── 7. 공급처 현황 ────────────────────────────────── */
  const suppliers = [];
  if (sh식재료 && food > 0) {
    // 합계 행 탐색: F 열 값이 식재료비 합계와 거의 일치하는 행
    let sumRow = 29;
    for (let r = 27; r <= 40; r++) {
      const v = _cn(sh식재료, `F${r}`);
      if (v && Math.abs(v - food) / food < 0.02) { sumRow = r; break; }
    }

    const supMap = [
      { name: '동원홈푸드',                       col: 'F' },
      { name: '아워홈',                           col: 'I' },
      { name: '푸드머스',                         col: 'L' },
      { name: '외부구매 (육류 등)',               col: 'M' },
      { name: '경비처리 (소액·소모성)',           col: 'N' },
      { name: '미청구 차감 (브랜드데이/특식)',    col: 'O' }
    ];

    for (const sup of supMap) {
      const amt = _cn(sh식재료, `${sup.col}${sumRow}`);
      if (amt == null) continue;
      suppliers.push({
        name:   sup.name,
        amount: Math.round(amt),
        ratio:  Math.round((amt / food) * 1000) / 1000
      });
    }
  }

  /* ── 8. 라면 코너 ──────────────────────────────────── */
  const ramenMealCount = mRamen + lRamen + dRamen;
  let ramenTotalCost = 0;
  const ramenItems   = [];

  if (sh라면) {
    for (let row = 3; row <= 120; row++) {
      const item   = _cs(sh라면, `C${row}`);
      const amount = _cn(sh라면, `G${row}`);
      if (!item && !amount) break;
      if (!item || !amount || amount <= 0) continue;

      const dateYmd = _cellToYMD(sh라면, `B${row}`);
      const dateStr = dateYmd ? _ymdToKorean(dateYmd) : '';
      ramenItems.push({ date: dateStr, item, amount: Math.round(amount) });
      ramenTotalCost += amount;
    }
    ramenTotalCost = Math.round(ramenTotalCost);
  }

  /* ── 9. 식사 유형별 1식 단가 ───────────────────────── */
  const convCount   = mSnack1 + mSnack2 + lSalad;
  const mainCount   = Math.max(0, totalActual - ramenMealCount - convCount);

  // 비용 배분: 라면 직접매입분은 ramenTotalCost, 간편식은 비례 배분
  const nonRamenFood  = food - ramenTotalCost;
  const convFoodCost  = convCount > 0 && totalActual > ramenMealCount
    ? Math.round(nonRamenFood * (convCount / Math.max(1, totalActual - ramenMealCount)))
    : 0;
  const mainFoodCost  = Math.max(0, nonRamenFood - convFoodCost);

  const perMealCategory = [
    { label: '일반식 (주식)',
      mealCount: mainCount,  foodCost: mainFoodCost,
      perMeal: mainCount > 0 ? Math.round(mainFoodCost / mainCount) : 0 },
    { label: '간편식·샐러드',
      mealCount: convCount,  foodCost: convFoodCost,
      perMeal: convCount > 0 ? Math.round(convFoodCost / convCount) : 0 },
    { label: '라면 코너 (직접매입분)',
      mealCount: ramenMealCount, foodCost: ramenTotalCost,
      perMeal: ramenMealCount > 0 ? Math.round(ramenTotalCost / ramenMealCount) : 0 }
  ];

  /* ── 결과 반환 ─────────────────────────────────────── */
  return {
    monthKey,
    record: {
      label,
      businessDays,
      headcount,
      note: '',
      cost:   { food, labor, opex, mgmt, total: supplyTotal },
      billing:{ supply: supplyTotal, vat: vatTotal, total: billingTotal },
      meals:  { prepared: totalPrepared, actual: totalActual },
      mealBreakdown,
      mealMix,
      daily,
      suppliers,
      ramen:  { totalCost: ramenTotalCost, mealCount: ramenMealCount, items: ramenItems },
      perMealCategory,
      companies,
      headcountDetail: { onsite, leave, offsite, applied }
    }
  };
}
