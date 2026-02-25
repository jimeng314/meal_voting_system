# 🍱 점심 투표 시스템

Google Spreadsheet + Google Apps Script + GitHub Pages 기반 사내 점심 투표 시스템

## 구조

```
meal_voting_system/
├── index.html                  # GitHub Pages 투표 웹 화면
├── src/
│   ├── meal_vote_controler.js  # Apps Script 메인 로직 (스프레드시트 제어)
│   └── apps_script_api.js      # Apps Script Web App API (웹 화면 ↔ 시트 연동)
└── README.md
```

## 투표 타임라인

| 시간 | 내용 |
|------|------|
| 10:00 | 투표 시작 알림 (Slack) |
| 10:00 ~ 11:00 | **식당 투표** (최대 3개 선택, 식사X 가능) |
| 10:30 | 미투표자 리마인더 (Slack) |
| 11:00 | 투표 마감 + 결과 발표 (Slack) |
| 11:00 ~ 11:20 | **메뉴 입력** (메뉴명, 가격, 비고) |
| 11:20 | 메뉴 취합 결과 발표 (Slack) |

## 식당 목록

대수식당 / 160도 / 한옥집김치찜 / 천궁 / 두리순대국

---

## 배포 방법

### 1단계: Apps Script 설정

1. [Google Apps Script](https://script.google.com) 에서 스프레드시트와 연결된 프로젝트 열기
2. `apps_script_api.js` 파일 내용을 Apps Script 프로젝트에 새 파일로 추가
   - 기존 `meal_vote_controler.js` 와 **같은 프로젝트**에 추가 (함수 공유)
3. **배포 → 새 배포** 클릭
   - 유형: **웹 앱**
   - 실행 계정: **나 (Me)**
   - 액세스 권한: **모든 사람** (또는 조직 내 사용자)
4. 배포 후 나타나는 **웹 앱 URL** 복사 (`https://script.google.com/macros/s/.../exec`)

> **API 키 설정 (선택사항)**: Apps Script 편집기에서 `setWebApiKey('원하는키')` 함수를 한 번 실행하면
> 이후 웹 화면에서 API 키를 입력해야만 접근 가능합니다.

### 2단계: GitHub Pages 배포

1. 이 레포지토리를 GitHub에 push
2. 레포 Settings → Pages → Branch: `main`, 폴더: `/` (root) 선택 후 저장
3. 배포된 URL (예: `https://your-org.github.io/meal_voting_system/`) 접속

### 3단계: 웹 화면에서 URL 설정

1. 웹 화면 첫 접속 시 설정 모달이 자동으로 열림
2. **1단계**에서 복사한 Apps Script 웹 앱 URL 입력
3. API 키 설정한 경우 키도 입력
4. **저장 후 시작** 클릭

> 설정은 브라우저 `localStorage`에 저장되므로 한 번만 입력하면 됩니다.

---

## Apps Script 최초 설정 (bootstrap)

스프레드시트와 Apps Script가 처음이라면:

```javascript
// Apps Script 편집기에서 실행
bootstrap()  // 시트 생성 + 트리거 설치 + Slack 웹훅 설정
```

`meal_vote_controler.js` 상단의 `BOOTSTRAP_SLACK_WEBHOOK_URL` 에 Slack Incoming Webhook URL을 넣고 실행.

---

## 웹 화면 기능

- **실시간 득표 현황**: 식당별 득표수 바 차트, 1위 하이라이트
- **참여 현황**: 투표 완료 인원 / 전체 인원, 미투표자 표시
- **내 투표**: 이름 선택 → 식당 체크박스 선택 (최대 3개) / 식사X 선택
- **메뉴 입력**: 메뉴명, 가격, 비고 입력
- **전체 현황 테이블**: 모든 인원의 투표/메뉴 현황
- **자동 갱신**: 15초마다 최신 상태 반영
- **단계별 UI**: 시간에 따라 투표/메뉴입력/마감 단계 표시
