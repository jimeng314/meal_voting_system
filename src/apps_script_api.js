/****************************************************
 * apps_script_api.js
 *
 * Google Apps Script Web App 엔드포인트
 * - GitHub Pages에서 호출하는 REST API 역할
 * - 이 파일을 meal_vote_controler.js 와 같은
 *   Apps Script 프로젝트에 추가하세요
 *
 * 배포 방법:
 *   Apps Script 편집기 → 배포 → 새 배포
 *   유형: 웹 앱
 *   실행 계정: 나
 *   액세스 권한: 모든 사람 (또는 조직 내)
 *
 * API 엔드포인트 (모두 GET):
 *   ?action=state              → 현재 투표 전체 현황
 *   ?action=vote&...           → 식당 투표 처리
 *   ?action=opt_out&...        → 식사X 처리
 *   ?action=menu&...           → 메뉴 입력 처리
 *   ?action=people             → 활성 인원 목록만 조회
 ****************************************************/

/***********************
 * API 키 (선택사항)
 * - PropertiesService에 WEB_API_KEY 를 설정해 두면 검증함
 * - 설정 안 하면 검증 없이 누구나 호출 가능
 ************************/
const PROP_WEB_API_KEY = 'WEB_API_KEY';

function getWebApiKey_() {
  return PropertiesService.getDocumentProperties().getProperty(PROP_WEB_API_KEY) || '';
}

/** Apps Script 편집기에서 한 번 실행해 API 키 등록 */
function setWebApiKey(key) {
  PropertiesService.getDocumentProperties().setProperty(PROP_WEB_API_KEY, String(key || ''));
  SpreadsheetApp.getActive().toast('API 키 저장 완료: ' + key, 'API 설정', 4);
}

function validateApiKey_(params) {
  const storedKey = getWebApiKey_();
  if (!storedKey) return true; // 키 미설정 시 전체 허용
  return String(params.key || '') === storedKey;
}

/***********************
 * CORS 헤더 포함 응답 생성
 ************************/
function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(msg, code) {
  return jsonResponse_({ ok: false, error: msg, code: code || 400 });
}

/***********************
 * doGet: 모든 API 요청 처리
 ************************/
function doGet(e) {
  try {
    const p = e.parameter || {};

    if (!validateApiKey_(p)) {
      return errorResponse_('Unauthorized', 401);
    }

    const action = String(p.action || 'state').toLowerCase();

    switch (action) {
      case 'state':   return handleGetState_();
      case 'people':  return handleGetPeople_();
      case 'vote':    return handleVote_(p);
      case 'opt_out': return handleOptOut_(p);
      case 'menu':    return handleMenu_(p);
      default:        return errorResponse_('Unknown action: ' + action);
    }
  } catch (err) {
    console.error('doGet error:', err);
    return errorResponse_('Internal error: ' + err.message, 500);
  }
}

/***********************
 * action=state: 전체 투표 현황
 ************************/
function handleGetState_() {
  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const phase    = getCurrentPhase_(now, todayStr);

  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const peopleLast = findLastNonEmptyInCol_(sh, COL_NAME, FIRST_PERSON_ROW);

  // 식당별 득표수/순위
  const restaurants = [];
  if (peopleLast >= FIRST_PERSON_ROW) {
    const counts = sh
      .getRange(VOTE_COUNT_ROW, COL_REST_START, 1, FIXED_RESTAURANTS.length)
      .getValues()[0].map(x => Number(x || 0));
    const ranks = sh
      .getRange(VOTE_RANK_ROW, COL_REST_START, 1, FIXED_RESTAURANTS.length)
      .getValues()[0].map(x => Number(x || 0));

    for (let i = 0; i < FIXED_RESTAURANTS.length; i++) {
      restaurants.push({
        name:  FIXED_RESTAURANTS[i],
        count: counts[i] || 0,
        rank:  ranks[i]  || 0
      });
    }
  } else {
    FIXED_RESTAURANTS.forEach(n => restaurants.push({ name: n, count: 0, rank: 0 }));
  }

  // 사람별 상태
  const people = [];
  if (peopleLast >= FIRST_PERSON_ROW) {
    const numRows = peopleLast - FIRST_PERSON_ROW + 1;

    const names     = sh.getRange(FIRST_PERSON_ROW, COL_NAME,      numRows, 1).getValues().flat();
    const voteGrid  = sh.getRange(FIRST_PERSON_ROW, COL_REST_START,numRows, FIXED_RESTAURANTS.length).getValues();
    const optOuts   = sh.getRange(FIRST_PERSON_ROW, COL_OPT_OUT,   numRows, 1).getValues().flat();
    const menuNames = sh.getRange(FIRST_PERSON_ROW, COL_MENU_NAME, numRows, 1).getValues().flat();
    const prices    = sh.getRange(FIRST_PERSON_ROW, COL_MENU_PRICE,numRows, 1).getValues().flat();
    const notes     = sh.getRange(FIRST_PERSON_ROW, COL_MENU_NOTE, numRows, 1).getValues().flat();

    for (let i = 0; i < numRows; i++) {
      const name = String(names[i] || '').trim();
      if (!name) continue;

      const votes = [];
      for (let j = 0; j < FIXED_RESTAURANTS.length; j++) {
        if (voteGrid[i][j] === true) votes.push(FIXED_RESTAURANTS[j]);
      }

      const optOut  = (optOuts[i] === true);
      const hasVoted = votes.length > 0 || optOut;
      const price   = prices[i];

      people.push({
        name,
        votes,
        optOut,
        hasVoted,
        menu: {
          name:  String(menuNames[i] || '').trim(),
          price: (price !== '' && price !== null && price !== undefined) ? Number(price) : null,
          note:  String(notes[i]    || '').trim()
        }
      });
    }
  }

  const totalPeople = people.length;
  const votedCount  = people.filter(p => p.hasVoted).length;
  const nonVoters   = people.filter(p => !p.hasVoted).map(p => p.name);

  return jsonResponse_({
    ok: true,
    date: todayStr,
    phase,               // before_start | vote_active | menu_active | all_locked
    phaseLabel: phaseLabel_(phase),
    restaurants,
    people,
    totalPeople,
    votedCount,
    nonVoters,
    config: {
      fixedRestaurants: FIXED_RESTAURANTS,
      maxVotePerPerson: MAX_VOTE_PER_PERSON,
      optOutLabel:      OPT_OUT_LABEL,
      voteStartHour:    VOTE_START_HOUR,
      voteStartMin:     VOTE_START_MIN,
      voteCutoffHour:   VOTE_CUTOFF_HOUR,
      voteCutoffMin:    VOTE_CUTOFF_MIN,
      menuCutoffHour:   MENU_CUTOFF_HOUR,
      menuCutoffMin:    MENU_CUTOFF_MIN
    },
    fetchedAt: now.toISOString()
  });
}

/***********************
 * action=people: 활성 인원 목록
 ************************/
function handleGetPeople_() {
  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);
  const people = getActivePeople_(ss);
  return jsonResponse_({ ok: true, people });
}

/***********************
 * action=vote: 식당 투표
 * params: person, restaurant, checked (true/false)
 ************************/
function handleVote_(p) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15 * 1000);
  try {
    const ss = SpreadsheetApp.getActive();
    ensureSheetsExist_(ss);

    const person     = String(p.person     || '').trim();
    const restaurant = String(p.restaurant || '').trim();
    const checked    = String(p.checked || '').toLowerCase() === 'true';

    if (!person)     return errorResponse_('person 파라미터 필요');
    if (!restaurant) return errorResponse_('restaurant 파라미터 필요');
    if (!FIXED_RESTAURANTS.includes(restaurant)) {
      return errorResponse_('알 수 없는 식당: ' + restaurant);
    }

    const now = new Date();
    if (isAfterVoteCutoffNow_()) {
      return errorResponse_('투표 마감 시간(11:00)이 지났습니다.', 403);
    }

    const sh  = ss.getSheetByName(SHEET_LUNCH_TODAY);
    const row = findPersonRow_(sh, person);
    if (!row) return errorResponse_('사람을 찾을 수 없습니다: ' + person, 404);

    const restIdx = FIXED_RESTAURANTS.indexOf(restaurant);
    const col     = COL_REST_START + restIdx;

    // 체크 전: 최대 3개 검사
    if (checked) {
      const currentVotes = sh.getRange(row, COL_REST_START, 1, FIXED_RESTAURANTS.length).getValues()[0];
      const trueCount    = currentVotes.filter(v => v === true).length;
      if (trueCount >= MAX_VOTE_PER_PERSON) {
        return errorResponse_(`최대 ${MAX_VOTE_PER_PERSON}개까지만 선택 가능합니다.`, 400);
      }
      // 식사X 해제
      sh.getRange(row, COL_OPT_OUT).setValue(false);
    }

    sh.getRange(row, col).setValue(checked);

    // 로그
    const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const cutoff   = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);
    ss.getSheetByName(SHEET_VOTE_HIST).appendRow([
      Utilities.getUuid(), person, restaurant, 0, now, '',
      todayStr, checked ? 'CHECKED' : 'UNCHECKED', cutoff, 'web_vote'
    ]);

    refreshVoteSummaryAndHighlight_(ss);

    return jsonResponse_({ ok: true, person, restaurant, checked });
  } finally {
    lock.releaseLock();
  }
}

/***********************
 * action=opt_out: 식사X 처리
 * params: person, checked (true/false)
 ************************/
function handleOptOut_(p) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15 * 1000);
  try {
    const ss = SpreadsheetApp.getActive();
    ensureSheetsExist_(ss);

    const person  = String(p.person || '').trim();
    const checked = String(p.checked || '').toLowerCase() === 'true';

    if (!person) return errorResponse_('person 파라미터 필요');
    if (isAfterVoteCutoffNow_()) {
      return errorResponse_('투표 마감 시간(11:00)이 지났습니다.', 403);
    }

    const sh  = ss.getSheetByName(SHEET_LUNCH_TODAY);
    const row = findPersonRow_(sh, person);
    if (!row) return errorResponse_('사람을 찾을 수 없습니다: ' + person, 404);

    sh.getRange(row, COL_OPT_OUT).setValue(checked);

    if (checked) {
      // 식사X 선택 시 식당 투표 모두 해제 + 메뉴 삭제
      sh.getRange(row, COL_REST_START, 1, FIXED_RESTAURANTS.length).setValue(false);
      sh.getRange(row, COL_MENU_NAME, 1, 3).clearContent();
    }

    // 로그
    const now      = new Date();
    const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const cutoff   = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);
    ss.getSheetByName(SHEET_VOTE_HIST).appendRow([
      Utilities.getUuid(), person, OPT_OUT_LABEL, 0, now, '',
      todayStr, checked ? 'CHECKED' : 'UNCHECKED', cutoff, 'web_vote'
    ]);

    refreshVoteSummaryAndHighlight_(ss);

    return jsonResponse_({ ok: true, person, optOut: checked });
  } finally {
    lock.releaseLock();
  }
}

/***********************
 * action=menu: 메뉴 입력
 * params: person, menuName, price, note
 ************************/
function handleMenu_(p) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15 * 1000);
  try {
    const ss = SpreadsheetApp.getActive();
    ensureSheetsExist_(ss);

    const person   = String(p.person   || '').trim();
    const menuName = String(p.menuName || '').trim();
    const note     = String(p.note     || '').trim();
    const price    = p.price !== undefined && p.price !== '' ? Number(p.price) : '';

    if (!person) return errorResponse_('person 파라미터 필요');

    const sh  = ss.getSheetByName(SHEET_LUNCH_TODAY);
    const row = findPersonRow_(sh, person);
    if (!row) return errorResponse_('사람을 찾을 수 없습니다: ' + person, 404);

    // 식사X 선택자는 메뉴 입력 차단
    const isOptOut = sh.getRange(row, COL_OPT_OUT).getValue() === true;
    if (isOptOut) {
      return errorResponse_('식사X 선택자는 메뉴 입력을 할 수 없습니다.', 403);
    }

    sh.getRange(row, COL_MENU_NAME).setValue(menuName);
    sh.getRange(row, COL_MENU_PRICE).setValue(price);
    sh.getRange(row, COL_MENU_NOTE).setValue(note);

    // 로그
    const voteRow = sh.getRange(row, COL_REST_START, 1, FIXED_RESTAURANTS.length).getValues()[0];
    const checkedRests = FIXED_RESTAURANTS.filter((_, i) => voteRow[i] === true).join(', ');

    const now      = new Date();
    const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const cutoff   = cutoffDateTime_(todayStr, MENU_CUTOFF_HOUR, MENU_CUTOFF_MIN, 0);
    ss.getSheetByName(SHEET_MENU_HIST).appendRow([
      Utilities.getUuid(), person, checkedRests, menuName,
      price, 0, now, note, todayStr, cutoff, 'web_vote'
    ]);

    return jsonResponse_({ ok: true, person, menuName, price, note });
  } finally {
    lock.releaseLock();
  }
}

/***********************
 * 현재 Phase 계산
 ************************/
function getCurrentPhase_(now, todayStr) {
  const voteStart  = cutoffDateTime_(todayStr, VOTE_START_HOUR,  VOTE_START_MIN,  0);
  const voteCutoff = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);
  const menuCutoff = cutoffDateTime_(todayStr, MENU_CUTOFF_HOUR, MENU_CUTOFF_MIN, 0);

  if (now.getTime() < voteStart.getTime())  return 'before_start';
  if (now.getTime() < voteCutoff.getTime()) return 'vote_active';
  if (now.getTime() < menuCutoff.getTime()) return 'menu_active';
  return 'all_locked';
}

function phaseLabel_(phase) {
  switch (phase) {
    case 'before_start': return '투표 시작 전 (10:00 이후 투표 가능)';
    case 'vote_active':  return '식당 투표 진행 중 (~11:00)';
    case 'menu_active':  return '메뉴 입력 진행 중 (~11:20)';
    case 'all_locked':   return '오늘 투표 마감';
    default:             return phase;
  }
}

/***********************
 * 사람 행 찾기
 ************************/
function findPersonRow_(sh, name) {
  const last = findLastNonEmptyInCol_(sh, COL_NAME, FIRST_PERSON_ROW);
  if (last < FIRST_PERSON_ROW) return null;

  const vals = sh.getRange(FIRST_PERSON_ROW, COL_NAME, last - FIRST_PERSON_ROW + 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === name) return FIRST_PERSON_ROW + i;
  }
  return null;
}
