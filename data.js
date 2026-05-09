/**
 * 채움 구내식당 운영 대시보드 — 기본(Base) 데이터 파일
 * 새 월 데이터는 대시보드 [📤 데이터 업로드] 버튼으로 추가하세요.
 * 이 파일은 수정하지 않아도 됩니다.
 */

const CHAEUM_DATA = {

  // ✅ 데이터가 있는 월 목록 (시간순 오름차순으로 관리)
  months: ["2026-04"],

  records: {

    /* ══════════════════════════════════════════════════
       2026년 4월 정산
    ══════════════════════════════════════════════════ */
    "2026-04": {
      label:        "2026년 4월",
      businessDays: 22,
      headcount:    895,
      note:         "특식 2회(브랜드데이), 셰프 섭외, 영업일수 22일 — 경비 전월 대비 2배 상승",

      cost: {
        food:  139028086,   // 식재료비
        labor:  43025026,   // 인건비
        opex:   11022821,   // 경비
        mgmt:    2123835,   // 운영관리비
        total: 195199768    // 공급가액 합계
      },

      billing: {
        supply: 195199768,
        vat:     19519973,
        total:  214719741
      },

      meals: {
        prepared: 20988,
        actual:   20462
      },

      mealBreakdown: [
        { label: "조식 (M)",         prepared: 1620, actual: 1578 },
        { label: "중식 A (L-A)",     prepared: 7170, actual: 6844 },
        { label: "중식 B (L-B)",     prepared: 5020, actual: 5005 },
        { label: "석식 (D)",         prepared: 2740, actual: 2597 },
        { label: "간편식·라면·기타", prepared: 4438, actual: 4438 }
      ],

      mealMix: {
        labels: ["조식", "중식 A", "중식 B", "석식", "간편식", "라면", "샐러드/기타"],
        values: [1578, 6844, 5005, 2597, 2640, 1214, 584]
      },

      daily: [
        ["4/1(수)",  981, 1012], ["4/2(목)",  973,  990], ["4/3(금)",  839,  843],
        ["4/6(월)", 1009,  990], ["4/7(화)", 1016, 1004], ["4/8(수)", 1041, 1046],
        ["4/9(목)",  969,  942], ["4/10(금)", 974,  895], ["4/13(월)",1034, 1031],
        ["4/14(화)", 994,  926], ["4/15(수)", 980,  958], ["4/16(목)",1049,  933],
        ["4/17(금)", 857,  769], ["4/20(월)",1072, 1081], ["4/21(화)", 969,  913],
        ["4/22(수)", 917,  928], ["4/23(목)", 915,  891], ["4/24(금)", 801,  749],
        ["4/27(월)", 970,  930], ["4/28(화)", 910,  852], ["4/29(수)", 895,  946],
        ["4/30(목)", 823,  833]
      ],

      suppliers: [
        { name: "동원홈푸드",             amount:  66111630, ratio:  0.476 },
        { name: "아워홈",                 amount:  52154825, ratio:  0.375 },
        { name: "푸드머스",               amount:  13048870, ratio:  0.094 },
        { name: "외부구매 (육류 등)",     amount:  11144660, ratio:  0.080 },
        { name: "경비처리 (소액·소모성)", amount:   1383541, ratio:  0.010 },
        { name: "미청구 차감 (브랜드데이/특식)", amount: -4815440, ratio: -0.035 }
      ],

      ramen: {
        totalCost: 645869,
        mealCount: 1214,
        items: [
          { date: "4/3",  item: "불닭볶음탕면, 달래",           amount:  30253 },
          { date: "4/7",  item: "라면기계용 생수",               amount: 138000 },
          { date: "4/7",  item: "똠냠 크리미 라면 외",           amount:  73163 },
          { date: "4/13", item: "톰냠 크리미 라면 외",           amount: 304590 },
          { date: "4/16", item: "하오하오 핑크 라면",            amount:   9082 },
          { date: "4/21", item: "마라탕면, 삿포로라멘, 고수라면", amount:  90781 }
        ]
      },

      perMealCategory: [
        { label: "일반식 (주식)",          mealCount: 16240, foodCost: 124595675, perMeal: 7672 },
        { label: "간편식·샐러드",          mealCount:  3008, foodCost:  13786542, perMeal: 4583 },
        { label: "라면 코너 (직접매입분)", mealCount:  1214, foodCost:    645869, perMeal:  532 }
      ],

      companies: [
        { name: "헥토이노베이션", headcount: 239, ratio: 0.2670, supply: 52118338, vat: 5211834, total: 57330172 },
        { name: "헥토파이낸셜",   headcount: 222, ratio: 0.2480, supply: 48409542, vat: 4840954, total: 53250496 },
        { name: "헥토헬스케어",   headcount: 120, ratio: 0.1341, supply: 26176289, vat: 2617629, total: 28793918 },
        { name: "헥토",           headcount:  88, ratio: 0.0984, supply: 19207659, vat: 1920761, total: 21128420 },
        { name: "헥토큐앤엠",     headcount:  87, ratio: 0.0972, supply: 18973417, vat: 1897342, total: 20870759 },
        { name: "헥토데이터",     headcount:  51, ratio: 0.0570, supply: 11126387, vat: 1112639, total: 12239026 },
        { name: "드림베이",       headcount:  35, ratio: 0.0391, supply:  7632311, vat:  763231, total:  8395542 },
        { name: "헥토미디어",     headcount:  34, ratio: 0.0380, supply:  7417591, vat:  741759, total:  8159350 },
        { name: "헥토월렛원",     headcount:  14, ratio: 0.0156, supply:  3045116, vat:  304512, total:  3349628 },
        { name: "바이오트웰브",   headcount:   3, ratio: 0.0034, supply:   663679, vat:   66368, total:   730047 },
        { name: "HTA",            headcount:   2, ratio: 0.0022, supply:   429439, vat:   42944, total:   472383 }
      ],

      headcountDetail: { onsite: 942, leave: 21, offsite: 26, applied: 895 }
    }

  }
};
