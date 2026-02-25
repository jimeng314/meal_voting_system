/****************************************************
 * 운영_점심투표 (Final + Bootstrap 포함) - 2026-02 통합본
 *
 * ✅ 적용 반영 (요청 2건)
 * 1) sendSlackMenuResult(): "로그_메뉴취합"이 아니라
 *    운영_점심투표(H~J) 현재값으로 직접 집계
 * 2) 메뉴명/가격(H~J) 시간에 따른 입력 잠금 해제
 *    - Protection(보호) 걸지 않음
 *    - onEdit에서 11:00/11:20 시간 차단 로직 제거
 *
 * ✅ 운영 시트 통합: 운영_점심투표
 * - 열 순서(고정):
 *   A 이름,
 *   B 대수식당, C 160도, D 한옥집김치찜, E 천궁, F 두리순대국,
 *   G 식사X,
 *   H 메뉴명, I 가격, J 비고
 *
 * ✅ 단계/시간(표시용)
 * - 식당 투표: 10:00 ~ 11:00 (B~G)
 * - 메뉴 입력: 11:00 ~ 11:20 (H~J)  ← "표시"는 유지하지만 입력 제한은 제거됨
 *
 * ✅ 규칙
 * - 식사X 체크 시: (같은 행) 식당 투표(B~F) 모두 해제 + 메뉴(H~J) 입력 차단(토스트)
 * - 식당(또는 두리순대국) 체크 시: (같은 행) 식사X 자동 해제
 * - 1인당 식당 선택 최대 3개 (식사X는 제외)
 *
 * ✅ 잠금
 * - 11:01 투표영역(B~G) 잠금(Protection)
 * - 메뉴영역(H~J) 잠금은 사용하지 않음(항상 열어둠)
 *
 * ✅ 리셋(00:05)
 * - B~G 체크 FALSE
 * - H~J 내용 삭제
 *
 * ✅ 색상 자동 전환(연한 회색)
 * - 진행 가능 영역: 연한 회색
 * - 대기: 흰색
 * - 마감/잠금: 더 진한 회색
 *
 * ✅ Slack
 * - 한국 평일(월~금) + 국정공휴일 제외
 * - 식당 메뉴/메뉴판 정보는 마스터_식당 시트에 있음을 안내
 ****************************************************/

/***********************
 * Sheet Names
 ************************/
const SHEET_PEOPLE       = '마스터_이름';     // A:이름, B:활성(Y/N), C:slack_user_id(optional)
const SHEET_REST_MST     = '마스터_식당';     // 메뉴/메뉴판 링크 정보가 있는 시트(안내용)
const SHEET_LUNCH_TODAY  = '운영_점심투표';

const SHEET_VOTE_HIST    = '로그_식당투표';
const SHEET_MENU_HIST    = '로그_메뉴취합';

const SHEET_VIEW_VOTE_LOG = '뷰_로그_식당투표';
const SHEET_VIEW_MENU_LOG = '뷰_로그_메뉴취합';

/***********************
 * Fixed restaurants (order fixed)
 * - 식사X는 별도 체크박스 열
 ************************/
const FIXED_RESTAURANTS = ['대수식당', '160도', '한옥집김치찜', '천궁', '두리순대국'];
const MAX_VOTE_PER_PERSON = 3; // 식당 선택 최대 3개(식사X 제외)
const OPT_OUT_LABEL = '식사X';

/***********************
 * Time
 ************************/
const TZ = 'Asia/Seoul';
const VOTE_START_HOUR = 10;
const VOTE_START_MIN  = 0;

const VOTE_CUTOFF_HOUR = 11;
const VOTE_CUTOFF_MIN  = 0;

const MENU_CUTOFF_HOUR = 11;
const MENU_CUTOFF_MIN  = 20;

// Google public holiday calendar for South Korea
const KR_HOLIDAY_CAL_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';

/***********************
 * Layout
 ************************/
const VOTE_COUNT_ROW   = 2;
const VOTE_RANK_ROW    = 3;
const HEADER_ROW       = 4;
const FIRST_PERSON_ROW = 5;

// Columns (1-based)
const COL_NAME        = 1; // A
const COL_REST_START  = 2; // B
const COL_REST_END    = COL_REST_START + FIXED_RESTAURANTS.length - 1; // F
const COL_OPT_OUT     = COL_REST_END + 1; // G (식사X)
const COL_MENU_NAME   = COL_OPT_OUT + 1;  // H
const COL_MENU_PRICE  = COL_OPT_OUT + 2;  // I
const COL_MENU_NOTE   = COL_OPT_OUT + 3;  // J

/***********************
 * Colors (요청: 연한 회색 적용)
 ************************/
const COLOR_ACTIVE = '#F2F2F2'; // 진행 가능(활성): 연한 회색
const COLOR_IDLE   = '#FFFFFF'; // 대기: 흰색
const COLOR_LOCKED = '#E0E0E0'; // 마감/잠금: 더 진한 회색

/***********************
 * Log Schemas
 ************************/
const VOTE_LOG_HEADERS = [
  'txn_id', 'person_name', 'restaurant_name', 'closed_flag', 'event_ts',
  'note', 'event_date', 'action', 'cutoff_ts', 'source_sheet'
];
const MENU_LOG_HEADERS = [
  'txn_id', 'person_name', 'restaurant_name', 'menu_name', 'price_amount',
  'closed_flag', 'event_ts', 'note', 'event_date', 'cutoff_ts', 'source_sheet'
];

// Column positions (1-based)
const VOTE_LOG_COL_CLOSED = 4;
const VOTE_LOG_COL_TS     = 5;

const MENU_LOG_COL_CLOSED = 6;
const MENU_LOG_COL_TS     = 7;

/***********************
 * Slack (ONE webhook)
 ************************/
const SLACK_ENABLED_DEFAULT = true;
const PROP_SLACK_ENABLED = 'SLACK_ENABLED';
const PROP_SLACK_WEBHOOK_URL = 'SLACK_WEBHOOK_URL';

function setSlackEnabled(enabled) {
  PropertiesService.getDocumentProperties().setProperty(PROP_SLACK_ENABLED, String(!!enabled));
}
function setSlackWebhookUrl(url) {
  PropertiesService.getDocumentProperties().setProperty(PROP_SLACK_WEBHOOK_URL, String(url || ''));
}
function isSlackEnabled_() {
  const v = PropertiesService.getDocumentProperties().getProperty(PROP_SLACK_ENABLED);
  if (v === null) return SLACK_ENABLED_DEFAULT;
  return String(v).toLowerCase() === 'true';
}
function getSlackWebhookUrl_() {
  return PropertiesService.getDocumentProperties().getProperty(PROP_SLACK_WEBHOOK_URL) || '';
}

/***********************
 * ✅ Bootstrap (한번에 적용)
 * - 아래 BOOTSTRAP_SLACK_WEBHOOK_URL에 URL 넣고 bootstrap() 실행
 ************************/
const BOOTSTRAP_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/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';

function bootstrap() {
  const ss = SpreadsheetApp.getActive();

  // Slack 설정
  setSlackEnabled(true);
  if (String(BOOTSTRAP_SLACK_WEBHOOK_URL || '').trim()) {
    setSlackWebhookUrl(String(BOOTSTRAP_SLACK_WEBHOOK_URL).trim());
  }

  // 시트/로그/뷰 준비
  ensureSheetsExist_(ss);
  syncStructure();       // 운영_점심투표 구성 + 포맷 + 초기 UI 반영
  ensureLogViews();      // 로그 VIEW 생성/갱신

  // 트리거 설치
  installTriggers();

  // 즉시 UI 정합 (색/잠금)
  applyPhaseUiNow();

  // 안내
  const webhookSet = !!getSlackWebhookUrl_();
  SpreadsheetApp.getActive().toast(
    `부트스트랩 완료 (Slack webhook: ${webhookSet ? 'SET' : 'NOT SET'})`,
    'bootstrap',
    5
  );
}

/***********************
 * Triggers
 ************************/
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncStructure')
    .timeBased().everyDays(1).atHour(0).nearMinute(2).create();

  ScriptApp.newTrigger('dailyReset')
    .timeBased().everyDays(1).atHour(0).nearMinute(5).create();

  // phase color refresh
  ScriptApp.newTrigger('applyPhaseUiNow')
    .timeBased().everyDays(1).atHour(VOTE_START_HOUR).nearMinute(VOTE_START_MIN).create(); // 10:00
  ScriptApp.newTrigger('applyPhaseUiNow')
    .timeBased().everyDays(1).atHour(VOTE_CUTOFF_HOUR).nearMinute(VOTE_CUTOFF_MIN).create(); // 11:00
  ScriptApp.newTrigger('applyPhaseUiNow')
    .timeBased().everyDays(1).atHour(MENU_CUTOFF_HOUR).nearMinute(MENU_CUTOFF_MIN).create(); // 11:20

  // Slack
  ScriptApp.newTrigger('sendSlackDailyNudge')
    .timeBased().everyDays(1).atHour(10).nearMinute(0).create();

  ScriptApp.newTrigger('sendSlackNonVotersReminder')
    .timeBased().everyDays(1).atHour(10).nearMinute(30).create();

  ScriptApp.newTrigger('sendSlackVoteResult')
    .timeBased().everyDays(1).atHour(VOTE_CUTOFF_HOUR).nearMinute(VOTE_CUTOFF_MIN).create(); // 11:00

  ScriptApp.newTrigger('sendSlackMenuResult')
    .timeBased().everyDays(1).atHour(MENU_CUTOFF_HOUR).nearMinute(MENU_CUTOFF_MIN).create(); // 11:20

  // Close (lock)
  ScriptApp.newTrigger('closeVote')
    .timeBased().everyDays(1).atHour(VOTE_CUTOFF_HOUR).nearMinute(VOTE_CUTOFF_MIN + 1).create(); // 11:01

  // ✅ 메뉴는 잠금 해제 정책이므로 closeMenu는 "로그 닫기"만 수행 (보호 없음)
  ScriptApp.newTrigger('closeMenu')
    .timeBased().everyDays(1).atHour(MENU_CUTOFF_HOUR).nearMinute(MENU_CUTOFF_MIN + 1).create(); // 11:21
}

/***********************
 * onOpen menu
 ************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('점심투표(운영)')
    .addItem('✅ 부트스트랩(최초 1회)', 'bootstrap')
    .addSeparator()
    .addItem('구조 동기화', 'syncStructure')
    .addItem('현재 시간대 UI 적용(색/잠금)', 'applyPhaseUiNow')
    .addItem('오늘 리셋(테스트)', 'dailyReset')
    .addSeparator()
    .addItem('트리거 재설치', 'installTriggers')
    .addSeparator()
    .addItem('현재 저장된 Slack 웹훅 확인', 'showCurrentSlackWebhookUrl')
    .addToUi();
}

/***********************
 * ✅ 저장된 웹훅 확인
 ************************/
function showCurrentSlackWebhookUrl() {
  const url = PropertiesService.getDocumentProperties().getProperty(PROP_SLACK_WEBHOOK_URL);
  if (!url) {
    SpreadsheetApp.getUi().alert('Slack 웹훅 URL이 아직 설정되어 있지 않습니다.');
    return;
  }
  SpreadsheetApp.getUi().alert('현재 저장된 Slack 웹훅 URL:\n\n' + url);
}

/***********************
 * apply phase now
 ************************/
function applyPhaseUiNow() {
  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);
  applyPhaseUi_(ss);
}

/***********************
 * Core: sync
 ************************/
function syncStructure() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30 * 1000);
  try {
    const ss = SpreadsheetApp.getActive();
    ensureSheetsExist_(ss);

    const people = getActivePeople_(ss);
    buildLunchSheet_(ss, people);

    applyMobileFriendlyFormatting_(ss);
    refreshVoteSummaryAndHighlight_(ss);

    applyPhaseUi_(ss);
    ensureLogViews();
  } finally {
    lock.releaseLock();
  }
}

/***********************
 * Phase UI (colors + protections)
 * ✅ 메뉴 입력은 시간과 무관하게 항상 열어둠 (Protection 미사용)
 ************************/
function applyPhaseUi_(ss) {
  // ✅ 혹시 과거에 메뉴 보호가 걸려있다면 항상 해제
  unprotectMenuInputs_(ss);

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');

  const voteStart  = cutoffDateTime_(todayStr, VOTE_START_HOUR,  VOTE_START_MIN, 0);
  const voteCutoff = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);
  const menuCutoff = cutoffDateTime_(todayStr, MENU_CUTOFF_HOUR, MENU_CUTOFF_MIN, 0);

  if (now.getTime() < voteStart.getTime()) {
    unprotectVoteGrid_(ss);      // B~G 잠금 해제
    setPhaseColors_(ss, 'BEFORE_START');
    return;
  }

  if (now.getTime() < voteCutoff.getTime()) {
    unprotectVoteGrid_(ss);
    setPhaseColors_(ss, 'VOTE_ACTIVE');
    return;
  }

  if (now.getTime() < menuCutoff.getTime()) {
    protectVoteGrid_(ss);        // 11:00 이후 투표 잠금
    setPhaseColors_(ss, 'MENU_ACTIVE');
    return;
  }

  protectVoteGrid_(ss);
  setPhaseColors_(ss, 'ALL_LOCKED');
}

function setPhaseColors_(ss, phase) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const peopleLast = findLastNonEmptyInCol_(sh, COL_NAME, FIRST_PERSON_ROW);
  if (peopleLast < FIRST_PERSON_ROW) return;

  const nRows = peopleLast - FIRST_PERSON_ROW + 1;

  // 투표영역 = B~G (식당 + 식사X)
  const voteCols = (COL_OPT_OUT - COL_REST_START + 1);
  const voteRange = sh.getRange(FIRST_PERSON_ROW, COL_REST_START, nRows, voteCols);

  // 메뉴영역 = H~J
  const menuRange = sh.getRange(FIRST_PERSON_ROW, COL_MENU_NAME, nRows, 3);

  if (phase === 'VOTE_ACTIVE') {
    voteRange.setBackground(COLOR_ACTIVE);
    menuRange.setBackground(COLOR_IDLE);
  } else if (phase === 'MENU_ACTIVE') {
    voteRange.setBackground(COLOR_LOCKED);
    menuRange.setBackground(COLOR_ACTIVE);
  } else if (phase === 'ALL_LOCKED') {
    voteRange.setBackground(COLOR_LOCKED);
    // ✅ 메뉴는 "색상 표시"만 종료 느낌으로 주되, 실제 입력은 막지 않음
    menuRange.setBackground(COLOR_LOCKED);
  } else {
    voteRange.setBackground(COLOR_IDLE);
    menuRange.setBackground(COLOR_IDLE);
  }
}

/***********************
 * Build unified sheet
 ************************/
function buildLunchSheet_(ss, people) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  sh.clear();

  sh.getRange('A1').setValue('오늘 날짜');
  sh.getRange('B1').setFormula('=TODAY()');

  sh.getRange(VOTE_COUNT_ROW, COL_NAME).setValue('득표수');
  sh.getRange(VOTE_RANK_ROW,  COL_NAME).setValue('등수');

  const header = [
    '이름',
    ...FIXED_RESTAURANTS,    // B~F
    OPT_OUT_LABEL,           // G
    '메뉴명', '가격', '비고' // H~J
  ];
  sh.getRange(HEADER_ROW, COL_NAME, 1, header.length).setValues([header]);

  if (people.length > 0) {
    sh.getRange(FIRST_PERSON_ROW, COL_NAME, people.length, 1).setValues(people.map(p => [p]));

    // Vote checkboxes: 식당(B~F)
    const restVoteRange = sh.getRange(FIRST_PERSON_ROW, COL_REST_START, people.length, FIXED_RESTAURANTS.length);
    restVoteRange.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    restVoteRange.setValue(false);

    // Opt-out checkbox: 식사X (G)
    const optOutRange = sh.getRange(FIRST_PERSON_ROW, COL_OPT_OUT, people.length, 1);
    optOutRange.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    optOutRange.setValue(false);

    // Price format
    sh.getRange(FIRST_PERSON_ROW, COL_MENU_PRICE, people.length, 1).setNumberFormat('#,##0');
  }

  // Count formulas row2 (B~F) — 식사X는 집계 제외
  const endRow = Math.max(FIRST_PERSON_ROW, FIRST_PERSON_ROW + people.length - 1);
  for (let j = 0; j < FIXED_RESTAURANTS.length; j++) {
    const col = COL_REST_START + j;
    const a1 = `${toA1_(col)}${FIRST_PERSON_ROW}:${toA1_(col)}${endRow}`;
    sh.getRange(VOTE_COUNT_ROW, col).setFormula(`=COUNTIF(${a1},TRUE)`);
  }

  // Rank formulas row3 (B~F)
  const firstColA1 = toA1_(COL_REST_START);
  const lastColA1  = toA1_(COL_REST_END);
  const countRangeA1 = `$${firstColA1}$${VOTE_COUNT_ROW}:$${lastColA1}$${VOTE_COUNT_ROW}`;

  for (let j = 0; j < FIXED_RESTAURANTS.length; j++) {
    const col = COL_REST_START + j;
    const colA1 = toA1_(col);
    sh.getRange(VOTE_RANK_ROW, col).setFormula(
      `=IF(${colA1}$${VOTE_COUNT_ROW}="","",RANK.EQ(${colA1}$${VOTE_COUNT_ROW},${countRangeA1},0))`
    );
  }

  sh.setFrozenRows(HEADER_ROW);
  sh.setFrozenColumns(1);
}

/***********************
 * Daily reset
 ************************/
function dailyReset() {
  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);

  syncStructure();

  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);

  // Reset vote (B~G)
  const vr = getVoteDataRange_(sh);
  if (vr) sh.getRange(vr.r1, vr.c1, vr.numRows, vr.numCols).setValue(false);

  // Clear menu (H~J)
  const peopleLast = findLastNonEmptyInCol_(sh, COL_NAME, FIRST_PERSON_ROW);
  if (peopleLast >= FIRST_PERSON_ROW) {
    sh.getRange(FIRST_PERSON_ROW, COL_MENU_NAME, peopleLast - FIRST_PERSON_ROW + 1, 3).clearContent();
  }

  applyPhaseUi_(ss);
  refreshVoteSummaryAndHighlight_(ss);
}

/***********************
 * Close: vote/menu
 ************************/
function closeVote() {
  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);

  const todayStr = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  markVoteClosed_(ss, todayStr);

  refreshVoteSummaryAndHighlight_(ss);
  protectVoteGrid_(ss);
  setPhaseColors_(ss, 'MENU_ACTIVE');
}

function closeMenu() {
  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);

  // ✅ 메뉴는 입력 잠금 안 함. 로그 닫기만 수행(원하면 삭제 가능)
  const todayStr = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  markMenuClosed_(ss, todayStr);

  // 보호는 걸지 않음
  unprotectMenuInputs_(ss);
  setPhaseColors_(ss, 'ALL_LOCKED');
}

/***********************
 * onEdit
 ************************/
function onEdit(e) {
  try {
    if (!e || !e.range) return;

    const ss = e.source;
    const sh = e.range.getSheet();

    if (sh.getName() !== SHEET_LUNCH_TODAY) {
      if (sh.getName() === SHEET_PEOPLE || sh.getName() === SHEET_REST_MST) debouncedSync_();
      return;
    }

    // 투표/식사X 영역 (B~G)
    if (isInVoteCheckboxGrid_(sh, e.range)) {
      if (isAfterVoteCutoffNow_()) {
        const oldVal = (String(e.oldValue).toUpperCase() === 'TRUE');
        e.range.setValue(e.oldValue === undefined ? false : oldVal);
        SpreadsheetApp.getActive().toast('11:00 이후에는 투표/식사X 수정이 불가합니다.', '마감(투표)', 3);
        return;
      }

      const row = e.range.getRow();
      const col = e.range.getColumn();
      const isOptOutCol = (col === COL_OPT_OUT);

      // 1) 식사X가 TRUE가 되면: 식당(B~F) 해제 + 메뉴(H~J) 클리어 + 로그(식사X) 기록
      if (isOptOutCol && String(e.value) === 'TRUE') {
        sh.getRange(row, COL_REST_START, 1, FIXED_RESTAURANTS.length).setValue(false);
        sh.getRange(row, COL_MENU_NAME, 1, 3).clearContent();
        handleVoteEditAsLabel_(ss, sh, row, OPT_OUT_LABEL, true);
        return;
      }

      // 2) 식사X가 FALSE로 바뀌는 경우도 로그 남김
      if (isOptOutCol && String(e.value) !== 'TRUE') {
        handleVoteEditAsLabel_(ss, sh, row, OPT_OUT_LABEL, false);
        return;
      }

      // 3) 식당(B~F) 체크가 TRUE면 식사X 자동 해제
      if (!isOptOutCol && String(e.value) === 'TRUE') {
        const optOutCell = sh.getRange(row, COL_OPT_OUT);
        if (optOutCell.getValue() === true) optOutCell.setValue(false);
      }

      // 4) Max 3 TRUE per person (식당만 집계, 식사X 제외)
      if (!isOptOutCol && String(e.value) === 'TRUE') {
        const rowVals = sh.getRange(row, COL_REST_START, 1, FIXED_RESTAURANTS.length).getValues()[0];
        const trueCount = rowVals.filter(v => v === true).length;
        if (trueCount > MAX_VOTE_PER_PERSON) {
          e.range.setValue(false);
          SpreadsheetApp.getActive().toast(`식당은 중복 선택 가능하지만 1인당 최대 ${MAX_VOTE_PER_PERSON}개까지만 선택할 수 있습니다.`, '제한', 4);
          return;
        }
      }

      // 5) 식당 체크/해제 로그
      handleVoteEdit_(e, ss);
      return;
    }

    // ✅ Menu edit (H~J)
    // - 시간에 따른 입력 제한 해제
    // - 단, 식사X 선택자는 입력 차단 유지
    if (isInMenuInputRange_(e.range)) {
      const r = e.range.getRow();
      if (r < FIRST_PERSON_ROW) return;

      const optOut = (sh.getRange(r, COL_OPT_OUT).getValue() === true);
      if (optOut) {
        const old = (e.oldValue === undefined) ? '' : e.oldValue;
        e.range.setValue(old);
        SpreadsheetApp.getActive().toast('식사X 선택자는 메뉴 입력을 하지 않습니다.', '차단(식사X)', 3);
        return;
      }

      // ✅ 로그 기록은 유지(원치 않으면 handleMenuEdit_ 호출 자체를 제거하면 됨)
      handleMenuEdit_(e, ss);
      return;
    }

  } catch (err) {
    console.error(err);
  }
}

function debouncedSync_() {
  const props = PropertiesService.getDocumentProperties();
  const now = Date.now();
  const last = Number(props.getProperty('LAST_SYNC_MS') || '0');
  if (now - last < 1500) return;
  props.setProperty('LAST_SYNC_MS', String(now));
  syncStructure();
}

/***********************
 * Vote edit -> log
 ************************/
function handleVoteEdit_(e, ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const edited = e.range;

  const person = sh.getRange(edited.getRow(), COL_NAME).getValue();
  const restaurant = sh.getRange(HEADER_ROW, edited.getColumn()).getValue();
  if (!person || !restaurant) return;

  const checked = String(e.value) === 'TRUE';
  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const cutoff = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);

  ss.getSheetByName(SHEET_VOTE_HIST).appendRow([
    Utilities.getUuid(),
    person,
    restaurant,
    0,
    now,
    '',
    todayStr,
    checked ? 'CHECKED' : 'UNCHECKED',
    cutoff,
    'oper_lunch_vote'
  ]);

  refreshVoteSummaryAndHighlight_(ss);
}

// 식사X 전용 로그 기록(이벤트 객체 없이도 남김)
function handleVoteEditAsLabel_(ss, sh, row, label, checked) {
  const person = sh.getRange(row, COL_NAME).getValue();
  if (!person) return;

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const cutoff = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);

  ss.getSheetByName(SHEET_VOTE_HIST).appendRow([
    Utilities.getUuid(),
    person,
    label,
    0,
    now,
    '',
    todayStr,
    checked ? 'CHECKED' : 'UNCHECKED',
    cutoff,
    'oper_lunch_vote'
  ]);

  refreshVoteSummaryAndHighlight_(ss);
}

/***********************
 * Menu edit -> log (유지)
 * - NOTE: 복붙/멀티셀은 기존처럼 첫 행만 기록될 수 있음
 * - 하지만 Slack 메뉴 결과는 운영 시트 기준으로 집계하므로 결과 정확도는 보장됨
 ************************/
function handleMenuEdit_(e, ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const r = e.range.getRow();
  if (r < FIRST_PERSON_ROW) return;

  const person = String(sh.getRange(r, COL_NAME).getValue() || '').trim();
  if (!person) return;

  // checked restaurants (can be multiple) - B~F
  const voteRow = sh.getRange(r, COL_REST_START, 1, FIXED_RESTAURANTS.length).getValues()[0];
  const checkedRests = [];
  for (let i = 0; i < FIXED_RESTAURANTS.length; i++) {
    if (voteRow[i] === true) checkedRests.push(FIXED_RESTAURANTS[i]);
  }
  const rest = checkedRests.join(', ');

  const menuName = sh.getRange(r, COL_MENU_NAME).getValue();
  const price = sh.getRange(r, COL_MENU_PRICE).getValue();
  const note = sh.getRange(r, COL_MENU_NOTE).getValue();

  if (!rest && !menuName && !price && !note) return;

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const cutoff = cutoffDateTime_(todayStr, MENU_CUTOFF_HOUR, MENU_CUTOFF_MIN, 0);

  ss.getSheetByName(SHEET_MENU_HIST).appendRow([
    Utilities.getUuid(),
    person,
    rest,
    menuName,
    price,
    0,
    now,
    note || '',
    todayStr,
    cutoff,
    'oper_lunch_menu'
  ]);
}

/***********************
 * Protections
 ************************/
function protectVoteGrid_(ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const vr = getVoteDataRange_(sh);
  if (!vr) return;

  const protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  if (protections.some(p => p.getDescription() === 'VOTE_GRID_LOCK')) return;

  const range = sh.getRange(vr.r1, vr.c1, vr.numRows, vr.numCols); // B~G
  const p = range.protect();
  p.setDescription('VOTE_GRID_LOCK');
  p.setWarningOnly(false);

  const editors = p.getEditors();
  if (editors && editors.length) p.removeEditors(editors);
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

function unprotectVoteGrid_(ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => {
    if (p.getDescription() === 'VOTE_GRID_LOCK') p.remove();
  });
}

// ✅ 메뉴 보호는 정책상 사용하지 않지만, 과거 잔여 보호 제거를 위해 함수는 유지
function protectMenuInputs_(ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const peopleLast = findLastNonEmptyInCol_(sh, COL_NAME, FIRST_PERSON_ROW);
  if (peopleLast < FIRST_PERSON_ROW) return;

  const protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  if (protections.some(p => p.getDescription() === 'MENU_INPUT_LOCK')) return;

  const range = sh.getRange(FIRST_PERSON_ROW, COL_MENU_NAME, peopleLast - FIRST_PERSON_ROW + 1, 3); // H~J
  const p = range.protect();
  p.setDescription('MENU_INPUT_LOCK');
  p.setWarningOnly(false);

  const editors = p.getEditors();
  if (editors && editors.length) p.removeEditors(editors);
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

function unprotectMenuInputs_(ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => {
    if (p.getDescription() === 'MENU_INPUT_LOCK') p.remove();
  });
}

/***********************
 * Winner highlight (rank=1)
 ************************/
function refreshVoteSummaryAndHighlight_(ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  applyWinnerConditionalFormatting_(sh, FIXED_RESTAURANTS.length);
}

function applyWinnerConditionalFormatting_(sh, restCount) {
  const firstCol = COL_REST_START;
  const lastCol  = COL_REST_START + restCount - 1;
  const colStartA1 = toA1_(firstCol);
  const colEndA1   = toA1_(lastCol);

  const countRange = sh.getRange(`${colStartA1}${VOTE_COUNT_ROW}:${colEndA1}${VOTE_COUNT_ROW}`);
  const rankRange  = sh.getRange(`${colStartA1}${VOTE_RANK_ROW}:${colEndA1}${VOTE_RANK_ROW}`);
  const headRange  = sh.getRange(`${colStartA1}${HEADER_ROW}:${colEndA1}${HEADER_ROW}`);

  const rules = [];
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=${colStartA1}$${VOTE_RANK_ROW}=1`)
      .setRanges([countRange, rankRange, headRange])
      .setBold(true)
      .setBackground('#E6F4EA')
      .build()
  );
  sh.setConditionalFormatRules(rules);
}

/***********************
 * Slack: business day gate (Mon-Fri + not KR holiday)
 ************************/
function isKoreaBusinessDay_(dateObj) {
  const d = dateObj || new Date();
  const dow = Number(Utilities.formatDate(d, TZ, 'u')); // 1=Mon ... 7=Sun
  if (dow < 1 || dow > 5) return false;

  try {
    const cal = CalendarApp.getCalendarById(KR_HOLIDAY_CAL_ID);
    if (!cal) return true; // fallback to weekday-only
    const events = cal.getEvents(startOfDay_(d), endOfDay_(d));
    return events.length === 0;
  } catch (e) {
    return true; // fallback if calendar access fails
  }
}

/***********************
 * Slack: 10:00 Daily Nudge
 ************************/
function sendSlackDailyNudge() {
  if (!isSlackEnabled_()) return;
  if (!isKoreaBusinessDay_(new Date())) return;

  const url = getSlackWebhookUrl_();
  if (!url) return;

  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);
  applyPhaseUi_(ss);

  const sheetUrl = ss.getUrl();
  const now = new Date();
  const dateText = Utilities.formatDate(now, TZ, 'yyyy-MM-dd (E)');

  const restText = FIXED_RESTAURANTS.join(' / ');

  const text =
    `📣 [점심 투표 / 메뉴 입력 안내]\n` +
    `────────────────\n` +
    `🗓 ${dateText}\n\n` +
    `⏰ 진행 시간(표시)\n` +
    `- 식당 투표/식사X: 10:00 ~ 11:00 (연한 회색 영역: B~G)\n` +
    `- 메뉴 입력: 11:00 ~ 11:20 (연한 회색 영역: H~J)\n` +
    `  ※ 메뉴 입력 제한은 해제됨(시간과 무관하게 수정 가능)\n\n` +
    `📌 식당 메뉴/메뉴판 링크는 '${SHEET_REST_MST}' 시트에서 확인할 수 있습니다.\n\n` +
    `✅ 1단계: 식당 투표 (10:00~11:00)\n` +
    `- ${restText}\n` +
    `- 중복 선택 가능 (최대 ${MAX_VOTE_PER_PERSON}개)\n` +
    `- 미참여 시 '${OPT_OUT_LABEL}' 체크\n\n` +
    `🍽 2단계: 메뉴 입력 (H~J)\n` +
    `- 메뉴명(${toA1_(COL_MENU_NAME)}), 가격(${toA1_(COL_MENU_PRICE)}), 비고(${toA1_(COL_MENU_NOTE)})\n\n` +
    `🔗 시트 바로가기\n` +
    `${sheetUrl}`;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true
  });
}

/***********************
 * Slack: 10:30 Non-voters reminder
 * - "미투표자" 기준: 식당(B~F)도 식사X(G)도 아무것도 체크 안한 사람
 ************************/
function sendSlackNonVotersReminder() {
  if (!isSlackEnabled_()) return;
  if (!isKoreaBusinessDay_(new Date())) return;
  if (isAfterVoteCutoffNow_()) return;

  const url = getSlackWebhookUrl_();
  if (!url) return;

  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);

  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const vr = getVoteDataRange_(sh);
  if (!vr) return;

  const nonVoters = getNonVoters_(ss, sh, vr);
  if (nonVoters.length === 0) return;

  const now = new Date();
  const dateText = Utilities.formatDate(now, TZ, 'yyyy-MM-dd (E)');
  const sheetUrl = ss.getUrl();

  const mentionList = nonVoters.map(p => p.slackId ? `<@${p.slackId}>` : p.name);
  const mentionText = mentionList.join(' ');

  const text =
    `🚨 [미참여자 안내] 점심 투표/식사X\n` +
    `────────────────\n` +
    `🗓 ${dateText}\n\n` +
    `⏰ 투표 시간: 10:00 ~ 11:00\n` +
    `- 현재 연한 회색 영역(B~G)에서 진행 중\n\n` +
    `아직 식당 투표/식사X를 하지 않음:\n` +
    `${mentionText}\n\n` +
    `📌 식당 메뉴/메뉴판 링크는 '${SHEET_REST_MST}' 시트에서 확인 가능합니다.\n` +
    `🔗 ${sheetUrl}`;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true
  });
}

function getNonVoters_(ss, sh, vr) {
  const peopleSh = ss.getSheetByName(SHEET_PEOPLE);
  const pdata = peopleSh.getDataRange().getValues();

  const activeMap = new Map(); // name -> slackId
  for (let i = 1; i < pdata.length; i++) {
    const name = String(pdata[i][0] || '').trim();
    const active = String(pdata[i][1] || '').trim().toUpperCase();
    const slackId = String(pdata[i][2] || '').trim();
    if (name && active === 'Y') activeMap.set(name, slackId || '');
  }
  if (activeMap.size === 0) return [];

  const names = sh.getRange(vr.r1, COL_NAME, vr.numRows, 1).getValues().map(r => String(r[0] || '').trim());
  const grid  = sh.getRange(vr.r1, vr.c1, vr.numRows, vr.numCols).getValues(); // B~G

  const out = [];
  for (let i = 0; i < vr.numRows; i++) {
    const name = names[i];
    if (!name) continue;
    if (!activeMap.has(name)) continue;

    const hasTrue = grid[i].some(v => v === true); // 식당 또는 식사X 중 하나라도 true면 참여한 것
    if (!hasTrue) out.push({ name, slackId: activeMap.get(name) });
  }
  return out;
}

/***********************
 * Slack: 11:00 vote result
 * - 식사X는 결과 집계에서 제외
 ************************/
function sendSlackVoteResult() {
  if (!isSlackEnabled_()) return;
  if (!isKoreaBusinessDay_(new Date())) return;

  const url = getSlackWebhookUrl_();
  if (!url) return;

  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);
  applyPhaseUi_(ss);

  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const headers = sh.getRange(HEADER_ROW, COL_REST_START, 1, FIXED_RESTAURANTS.length).getValues()[0];
  const counts  = sh.getRange(VOTE_COUNT_ROW, COL_REST_START, 1, FIXED_RESTAURANTS.length).getValues()[0].map(x => Number(x || 0));

  const max = Math.max(...counts);
  const winners = [];
  const lines = [];

  for (let i = 0; i < FIXED_RESTAURANTS.length; i++) {
    const n = String(headers[i] || '').trim();
    const c = counts[i] || 0;
    lines.push(`- ${n}: ${c}`);
    if (c === max && max > 0) winners.push(n);
  }

  const now = new Date();
  const dateText = Utilities.formatDate(now, TZ, 'yyyy-MM-dd (E)');
  const sheetUrl = ss.getUrl();

  const text =
    `📌 [투표 결과] 점심 식당\n` +
    `────────────────\n` +
    `🗓 ${dateText}\n\n` +
    `⏰ 11:00 기준\n` +
    `- 식당투표/식사X(B~G): 회색(종료)\n` +
    `- 메뉴취합(H~J): 연한 회색(표시, 11:20까지)\n` +
    `  ※ 메뉴 입력 제한은 해제됨\n\n` +
    `🏆 1위: ${winners.length ? winners.join(', ') : '(없음)'}${max > 0 ? ` (${max}표)` : ''}\n\n` +
    `📊 득표 현황\n` +
    `${lines.join('\n')}\n\n` +
    `📌 식당 메뉴/메뉴판 링크는 '${SHEET_REST_MST}' 시트에서 확인 후,\n` +
    `메뉴를 입력해 주세요.\n\n` +
    `🔗 시트 바로가기\n` +
    `${sheetUrl}`;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true
  });
}

/***********************
 * Slack: 11:20 menu result
 * ✅ 운영_점심투표(H~J) 현재값 기준으로 집계 (로그 무시)
 ************************/
function sendSlackMenuResult() {
  if (!isSlackEnabled_()) return;
  if (!isKoreaBusinessDay_(new Date())) return;

  const url = getSlackWebhookUrl_();
  if (!url) return;

  const ss = SpreadsheetApp.getActive();
  ensureSheetsExist_(ss);

  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);
  const sheetUrl = ss.getUrl();

  const now = new Date();
  const dateText = Utilities.formatDate(now, TZ, 'yyyy-MM-dd (E)');

  const peopleLast = findLastNonEmptyInCol_(sh, COL_NAME, FIRST_PERSON_ROW);
  const lines = [];

  if (peopleLast >= FIRST_PERSON_ROW) {
    const numRows = peopleLast - FIRST_PERSON_ROW + 1;

    const names = sh.getRange(FIRST_PERSON_ROW, COL_NAME, numRows, 1).getValues().flat();
    const menuNames = sh.getRange(FIRST_PERSON_ROW, COL_MENU_NAME, numRows, 1).getValues().flat();
    const prices = sh.getRange(FIRST_PERSON_ROW, COL_MENU_PRICE, numRows, 1).getValues().flat();
    const notes = sh.getRange(FIRST_PERSON_ROW, COL_MENU_NOTE, numRows, 1).getValues().flat();

    for (let i = 0; i < numRows; i++) {
      const person = String(names[i] || '').trim();
      if (!person) continue;

      const menu = String(menuNames[i] || '').trim();
      const price = prices[i];
      const note = String(notes[i] || '').trim();

      const hasMenuOrNote = !!menu || !!note;
      const hasPrice = !(price === '' || price === null || price === undefined);
      if (!hasMenuOrNote && !hasPrice) continue;

      const priceText = hasPrice ? ` (${Number(price).toLocaleString('ko-KR')}원)` : '';
      const noteText  = note ? ` · ${note}` : '';
      lines.push(`- ${person}: ${menu}${priceText}${noteText}`);
    }
  }

  const text =
    `📌 [메뉴 취합 결과]\n` +
    `────────────────\n` +
    `🗓 ${dateText}\n\n` +
    `⏰ 11:20 기준\n` +
    `- 메뉴취합(H~J): 회색(종료)\n` +
    `  ※ 실제 입력 제한은 해제됨(결과는 현재값 기준)\n\n` +
    `${lines.length ? `🍽 오늘 주문 내역\n${lines.join('\n')}` : '⚠️ 입력된 메뉴가 없습니다.'}\n\n` +
    `🔗 시트 바로가기\n` +
    `${sheetUrl}`;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true
  });
}

/***********************
 * Mark "closed_flag=1"
 ************************/
function markVoteClosed_(ss, todayStr) {
  const sh = ss.getSheetByName(SHEET_VOTE_HIST);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return;

  const cutoff = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);
  const best = new Map(); // date||person||restaurant -> {row, ts}

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const ts = r[VOTE_LOG_COL_TS - 1];
    if (!(ts instanceof Date)) continue;

    const rowDate = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    if (rowDate !== todayStr) continue;
    if (ts.getTime() > cutoff.getTime()) continue;

    sh.getRange(i + 1, VOTE_LOG_COL_CLOSED).setValue(0);

    const key = `${todayStr}||${r[1]}||${r[2]}`;
    const prev = best.get(key);
    if (!prev || ts.getTime() > prev.ts) best.set(key, { row: i + 1, ts: ts.getTime() });
  }

  best.forEach(v => sh.getRange(v.row, VOTE_LOG_COL_CLOSED).setValue(1));
}

function markMenuClosed_(ss, todayStr) {
  const sh = ss.getSheetByName(SHEET_MENU_HIST);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return;

  const cutoff = cutoffDateTime_(todayStr, MENU_CUTOFF_HOUR, MENU_CUTOFF_MIN, 0);
  const best = new Map(); // date||person -> {row, ts}

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const ts = r[MENU_LOG_COL_TS - 1];
    if (!(ts instanceof Date)) continue;

    const rowDate = Utilities.formatDate(ts, TZ, 'yyyy-MM-dd');
    if (rowDate !== todayStr) continue;
    if (ts.getTime() > cutoff.getTime()) continue;

    sh.getRange(i + 1, MENU_LOG_COL_CLOSED).setValue(0);

    const key = `${todayStr}||${r[1]}`;
    const prev = best.get(key);
    if (!prev || ts.getTime() > prev.ts) best.set(key, { row: i + 1, ts: ts.getTime() });
  }

  best.forEach(v => sh.getRange(v.row, MENU_LOG_COL_CLOSED).setValue(1));
}

/***********************
 * Log Views
 ************************/
function ensureLogViews() {
  const ss = SpreadsheetApp.getActive();

  let v = ss.getSheetByName(SHEET_VIEW_VOTE_LOG);
  if (!v) v = ss.insertSheet(SHEET_VIEW_VOTE_LOG);
  v.clear();
  v.getRange('A1').setFormula(`=SORT(${SHEET_VOTE_HIST}!A:J, ${VOTE_LOG_COL_TS}, FALSE)`);

  let m = ss.getSheetByName(SHEET_VIEW_MENU_LOG);
  if (!m) m = ss.insertSheet(SHEET_VIEW_MENU_LOG);
  m.clear();
  m.getRange('A1').setFormula(`=SORT(${SHEET_MENU_HIST}!A:K, ${MENU_LOG_COL_TS}, FALSE)`);
}

/***********************
 * Formatting
 ************************/
function applyMobileFriendlyFormatting_(ss) {
  const sh = ss.getSheetByName(SHEET_LUNCH_TODAY);

  sh.setRowHeight(VOTE_COUNT_ROW, 28);
  sh.setRowHeight(VOTE_RANK_ROW, 28);
  sh.setRowHeight(HEADER_ROW, 32);
  for (let r = FIRST_PERSON_ROW; r < FIRST_PERSON_ROW + 80; r++) sh.setRowHeight(r, 38);

  sh.setColumnWidth(COL_NAME, 110);

  // B~G 투표영역
  for (let c = COL_REST_START; c <= COL_OPT_OUT; c++) sh.setColumnWidth(c, 90);

  // H~J 메뉴영역
  sh.setColumnWidth(COL_MENU_NAME, 160);
  sh.setColumnWidth(COL_MENU_PRICE, 90);
  sh.setColumnWidth(COL_MENU_NOTE, 160);
}

/***********************
 * Ensure sheets + headers
 ************************/
function ensureSheetsExist_(ss) {
  const required = [
    SHEET_PEOPLE, SHEET_REST_MST,
    SHEET_LUNCH_TODAY,
    SHEET_VOTE_HIST, SHEET_MENU_HIST
  ];
  required.forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  ensureLogHeaders_(ss.getSheetByName(SHEET_VOTE_HIST), VOTE_LOG_HEADERS);
  ensureLogHeaders_(ss.getSheetByName(SHEET_MENU_HIST), MENU_LOG_HEADERS);
}

function ensureLogHeaders_(sheet, headers) {
  const lr = sheet.getLastRow();
  if (lr === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const isAllBlank = firstRow.every(v => String(v || '').trim() === '');
  if (isAllBlank) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

/***********************
 * Masters: active people
 ************************/
function getActivePeople_(ss) {
  const sh = ss.getSheetByName(SHEET_PEOPLE);
  const data = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const active = String(data[i][1] || '').trim().toUpperCase();
    if (name && active === 'Y') out.push(name);
  }
  return out;
}

/***********************
 * Range helpers
 ************************/
// 투표영역: B~G (식당 5개 + 식사X 1개)
function getVoteDataRange_(sheet) {
  const peopleLast = findLastNonEmptyInCol_(sheet, COL_NAME, FIRST_PERSON_ROW);
  if (peopleLast < FIRST_PERSON_ROW) return null;
  return {
    r1: FIRST_PERSON_ROW,
    c1: COL_REST_START,
    numRows: peopleLast - FIRST_PERSON_ROW + 1,
    numCols: (COL_OPT_OUT - COL_REST_START + 1)
  };
}

function isInVoteCheckboxGrid_(sheet, range) {
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return false;
  const vr = getVoteDataRange_(sheet);
  if (!vr) return false;
  const r = range.getRow(), c = range.getColumn();
  return (r >= vr.r1 && r <= vr.r1 + vr.numRows - 1 && c >= vr.c1 && c <= vr.c1 + vr.numCols - 1);
}

// 메뉴영역: H~J
function isInMenuInputRange_(range) {
  const r = range.getRow();
  const c = range.getColumn();
  return (r >= FIRST_PERSON_ROW && c >= COL_MENU_NAME && c <= COL_MENU_NOTE);
}

/***********************
 * Time helpers
 ************************/
function isAfterVoteCutoffNow_() {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const cutoff = cutoffDateTime_(todayStr, VOTE_CUTOFF_HOUR, VOTE_CUTOFF_MIN, 0);
  return now.getTime() >= cutoff.getTime();
}

function cutoffDateTime_(yyyyMMdd, h, m, s) {
  const parts = yyyyMMdd.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], h, m, s);
}

function startOfDay_(d) {
  const ds = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const [y, mo, da] = ds.split('-').map(Number);
  return new Date(y, mo - 1, da, 0, 0, 0);
}
function endOfDay_(d) {
  const ds = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const [y, mo, da] = ds.split('-').map(Number);
  return new Date(y, mo - 1, da, 23, 59, 59);
}

/***********************
 * Scan helpers
 ************************/
function findLastNonEmptyInCol_(sh, col, startRow) {
  const last = sh.getLastRow();
  if (last < startRow) return startRow - 1;
  const vals = sh.getRange(startRow, col, last - startRow + 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0] || '').trim() !== '') return startRow + i;
  }
  return startRow - 1;
}

function toA1_(col) {
  let n = col, s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
