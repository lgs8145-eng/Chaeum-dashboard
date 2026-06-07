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

// 헤더 행을 읽어 { 헤더명: 열문자 } 맵 반환 — 월별 열 구조 차이 자동 대응
function _findCols(sheet, hdrRow) {
  const map = {};
  const r = hdrRow || 3;
  for (let ci = 0; ci < 26; ci++) {
    const col = String.fromCharCode(65 + ci);
    const c = sheet[col + r];
    if (c && c.v != null) map[String(c.v).trim()] = col;
  }
  return map;
}

// 지정 열(일자 열)에서 "계" 텍스트가 있는 집계 행 번호 탐색
function _findSumRow(sheet, dateCol) {
  const col = dateCol || 'B';
  for (let r = 5; r <= 60; r++) {
    const c = sheet[col + r];
    if (c && String(c.v).trim() === '계') return r;
  }
  return 26;
}

// 시트명에 keyword 들을 모두 포함하는 첫 시트 반환 (우선순위 매칭)
function _sheetPref(wb, ...keywords) {
  const name = wb.SheetNames.find(n => keywords.every(k => n.includes(k)));
  return name ? wb.Sheets[name] : null;
}

// 식수 시트의 헤더 행·일자 열을 "일자" 라벨로 동적 탐지
// (1월: 2행/A열, 2·3·5월: 3행/B열 등 월별 차이 대응)
function _findHeaderRowCol(sheet) {
  for (let r = 1; r <= 6; r++) {
    for (let ci = 0; ci < 26; ci++) {
      const col = String.fromCharCode(65 + ci);
      const c = sheet[col + r];
      if (c && typeof c.v === 'string' && c.v.trim().includes('일자')) {
        return { row: r, col };
      }
    }
  }
  return { row: 3, col: 'B' }; // 기존(4월) 기본값
}

/* ── 메인 파서 ─────────────────────────────────────────── */

/**
 * @param {ArrayBuffer} arrayBuffer  xlsx 파일 ArrayBuffer
 * @returns {{ monthKey: string, record: object }}
 * @throws {Error} 파싱 실패 시
 */
function parseChaeumExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  /* 시트 참조 — 월별 시트 명명 차이 대응 (우선순위·키워드 매칭) */
  // '법인별정산'은 _법인별·_헥토 둘 다 있을 수 있어 '헥토' 우선
  const sh정산   = _sheetPref(wb, '법인별정산', '헥토') || _sheet(wb, '법인별정산');
  const sh인원   = _sheet(wb, '법인별 인원');
  // '식재료비'는 별첨X_식재료비_* 와 충돌하므로 단독 시트 우선
  const sh식재료 = wb.SheetNames.includes('식재료비') ? wb.Sheets['식재료비'] : _sheet(wb, '식재료비');
  // 식수 시트는 '별첨3'이 '별첨3_식재료비_미청구'와 충돌(1월)하므로 '식사인원'으로 탐색
  const sh식수   = _sheet(wb, '식사인원');
  const sh라면   = _sheet(wb, '라면코너') || _sheet(wb, '라면');

  if (!sh정산) throw new Error("'법인별정산_헥토' 시트를 찾을 수 없습니다. 파일 형식을 확인하세요.");
  if (!sh식수)  throw new Error("'식사인원' 시트를 찾을 수 없습니다. 파일 형식을 확인하세요.");

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

  /* ── 5. 일별 식수 (식사인원 시트) ────────────────── */
  // 헤더 행·일자 열을 동적 탐지 후 그 행으로 열 위치 매핑 — 월별 구조 차이 자동 대응
  const hdr     = _findHeaderRowCol(sh식수);
  const dateCol = hdr.col;
  const cols    = _findCols(sh식수, hdr.row);
  const sumRow  = _findSumRow(sh식수, dateCol);

  const cMP  = cols['(M)준비']    || 'D';
  const cMA  = cols['(M)실제']    || 'E';
  const cMS1 = cols['(M)간편식1'] || 'F';
  const cMS2 = cols['(M)간편식2'] || 'G';
  const cMR  = cols['(M)라면']    || 'H';
  const cLAP = cols['(L)A준비']   || 'J';
  const cLAA = cols['(L)A실제']   || 'K';
  const cLBP = cols['(L)B준비']   || 'L';
  const cLBA = cols['(L)B실제']   || 'M';
  const cLR  = cols['(L)라면']    || 'N';
  const cLS  = cols['(L)샐러드']  || null; // 월별 선택 컬럼
  const cDP  = cols['(D)준비']    || 'Q';
  const cDA  = cols['(D)실제']    || 'R';
  const cDR  = cols['(D)라면']    || 'S';
  const cDH  = cols['즉석전골']   || null; // 월별 선택 컬럼
  const cTP  = cols['합계(준비)'] || 'V';
  const cTA  = cols['합계(실제)'] || 'W';

  const mPrepared   = Math.round(_cn(sh식수, cMP  + sumRow) || 0);
  const mActual     = Math.round(_cn(sh식수, cMA  + sumRow) || 0);
  const mSnack1     = Math.round(_cn(sh식수, cMS1 + sumRow) || 0);
  const mSnack2     = Math.round(_cn(sh식수, cMS2 + sumRow) || 0);
  const mRamen      = Math.round(_cn(sh식수, cMR  + sumRow) || 0);
  const laAPrepared = Math.round(_cn(sh식수, cLAP + sumRow) || 0);
  const laAActual   = Math.round(_cn(sh식수, cLAA + sumRow) || 0);
  const laBPrepared = Math.round(_cn(sh식수, cLBP + sumRow) || 0);
  const laBActual   = Math.round(_cn(sh식수, cLBA + sumRow) || 0);
  const lRamen      = Math.round(_cn(sh식수, cLR  + sumRow) || 0);
  const lSalad      = cLS ? Math.round(_cn(sh식수, cLS + sumRow) || 0) : 0;
  const dPrepared   = Math.round(_cn(sh식수, cDP  + sumRow) || 0);
  const dActual     = Math.round(_cn(sh식수, cDA  + sumRow) || 0);
  const dRamen      = Math.round(_cn(sh식수, cDR  + sumRow) || 0);
  const dHotpot     = cDH ? Math.round(_cn(sh식수, cDH + sumRow) || 0) : 0;
  const totalPrepared = Math.round(_cn(sh식수, cTP + sumRow) || 0);
  const totalActual   = Math.round(_cn(sh식수, cTA + sumRow) || 0);

  // 일별 데이터 (헤더 다음 행부터 연속)
  const daily = [];
  let businessDays = 0;
  let settlementYear = null, settlementMonth = null;

  for (let row = hdr.row + 1; row <= hdr.row + 60; row++) {
    const ymd       = _cellToYMD(sh식수, dateCol + row);
    const vPrepared = _cn(sh식수, cTP + row);
    if (!ymd || vPrepared == null) break;

    businessDays++;
    const dateStr = _ymdToKorean(ymd);
    if (!settlementYear) {
      settlementYear  = ymd.year;
      settlementMonth = ymd.month;
    }
    daily.push([dateStr, Math.round(vPrepared), Math.round(_cn(sh식수, cTA + row) || 0)]);
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
    // 합계 행 탐색: B열에 "합계" 텍스트가 있는 행 (월별 23/27/29행 등 가변)
    let sumRow = 0;
    for (let r = 5; r <= 60; r++) {
      const b = _cs(sh식재료, `B${r}`);
      if (b && b.includes('합계')) { sumRow = r; break; }
    }
    // 폴백: 총합계(P열)가 식재료비 총액(food)과 근접한 행
    if (!sumRow) {
      for (let r = 5; r <= 60; r++) {
        const p = _cn(sh식재료, `P${r}`);
        if (p && Math.abs(p - food) / food < 0.03) { sumRow = r; break; }
      }
    }
    if (!sumRow) sumRow = 29;

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
