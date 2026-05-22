/**
 * 채움 대시보드 — 월 업로드 데이터 저장소 (Redis API + localStorage 캐시)
 *
 * 월별 정산 데이터를 서버(Redis, /api/uploads)에 저장하고,
 * localStorage('chaeum_uploads_v1')는 오프라인·로딩 속도용 캐시로 유지한다.
 * Redis 불가 시 캐시로 화면을 유지하므로 데이터가 사라지지 않는다.
 *
 * 사용 페이지:
 *   - index.html : 읽기·쓰기·삭제·기존 로컬 데이터 마이그레이션
 *   - menu.html  : 읽기 동기화(중복 검토용 월 데이터 참조)
 *
 * 전역 객체 window.UploadsStore 로 노출된다.
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'chaeum_uploads_v1';

  // ── localStorage 캐시 ──────────────────────────────────────────
  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveCache(obj) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch (e) {
      throw new Error('브라우저 저장소 접근이 차단되었습니다. 추적 방지 설정을 확인하거나 서버를 통해 열어주세요.');
    }
  }

  // ── 서버 쓰기 (백그라운드 — UI 블로킹 없음) ─────────────────────
  function pushMonth(monthKey, record) {
    try {
      return fetch('/api/uploads?action=save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthKey: monthKey, record: record }),
      }).catch(function () { /* 서버 동기화 실패 — 캐시는 이미 저장됨 */ });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function deleteMonth(monthKey) {
    try {
      return fetch('/api/uploads?action=delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthKey: monthKey }),
      }).catch(function () { /* 서버 동기화 실패 — 캐시는 이미 반영됨 */ });
    } catch (e) {
      return Promise.resolve();
    }
  }

  // 다월 일괄 저장 (마이그레이션용) — 실패 시 예외 전파
  async function pushBatch(months) {
    var res = await fetch('/api/uploads?action=save-batch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ months: months }),
    });
    if (!res.ok) throw new Error('save-batch 실패: ' + res.status);
  }

  // ── 서버(Redis) 동기화 ─────────────────────────────────────────
  // 서버 우선 병합. 서버에 없는 로컬 키는 미동기화 데이터로 간주해 보존한다.
  // opts.pushLocalOnly=true(admin)면 로컬 전용 월을 서버로 자동 업로드한다
  // → 기존 localStorage 데이터(예: 4월)의 1회성 마이그레이션.
  // 반환: 병합된 월 데이터 객체. Redis 불가 시 로컬 캐시를 그대로 반환.
  async function syncFromServer(opts) {
    var pushLocalOnly = !!(opts && opts.pushLocalOnly);
    var local = loadCache();
    try {
      var res = await fetch('/api/uploads?action=load', { credentials: 'include' });
      if (!res.ok) return local;
      var json = await res.json();
      if (!json || !json.ok || !json.data || typeof json.data !== 'object') return local;
      var server = json.data;

      // 로컬에만 있는 월 → 서버로 마이그레이션 (admin 한정)
      if (pushLocalOnly) {
        var localOnly = {};
        Object.keys(local).forEach(function (k) {
          if (!(k in server)) localOnly[k] = local[k];
        });
        if (Object.keys(localOnly).length) {
          try {
            await pushBatch(localOnly);
            Object.assign(server, localOnly);
          } catch (e) {
            // 마이그레이션 실패 — 로컬 캐시는 유지되므로 다음 접속에 재시도
          }
        }
      }

      var merged = Object.assign({}, local, server); // 서버 우선
      try { saveCache(merged); } catch (e) { /* 캐시 차단 — 메모리상 병합본만 사용 */ }
      return merged;
    } catch (e) {
      return local; // Redis 불가 시 localStorage 캐시 사용
    }
  }

  global.UploadsStore = {
    CACHE_KEY: CACHE_KEY,
    loadCache: loadCache,
    saveCache: saveCache,
    pushMonth: pushMonth,
    deleteMonth: deleteMonth,
    syncFromServer: syncFromServer,
  };
})(window);
