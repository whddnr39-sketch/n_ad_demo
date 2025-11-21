# Naver Ads Bulk Control Tool

## 1. 개요
네이버 검색광고 소재 단위로
- 기간별 성과 조회 (StatReport + MasterReport + 주 전환 데이터)
- 조건 기반 필터링 (광고비/ROAS/주 전환 등)
- 입찰가 일괄 조정 (금액/%) 및 소재 ON/OFF
- k/t 기반 시뮬레이션
- 실제 Naver API 호출 + 결과 로그 CSV 다운로드

까지 한 번에 할 수 있는 내부 툴입니다.

## 2. 기술 스택
- Next.js (App Router)
- Node.js runtime
- API Routes: `/api/naver/*`
- Naver Searchad API 연동

## 3. 주요 파일
- `app/page.js`
  - 탭 구조
  - BulkControlTab 컴포넌트 (Step1~3 UI + 로직)
- `app/api/naver/ad-summary/route.js`
  - StatReport + MasterReport 조회 및 파싱
  - mainConvMap merge
- `app/api/naver/ad-bulk-action/route.js`
  - 다수 adId 대상으로 bid / userLock(ON/OFF) 일괄 업데이트

## 4. 환경 변수
`.env.local` 예시:

- `API_KEY` / `SECRET_KEY` / `CUSTOMER_ID` (Naver Searchad API)
- KEY 값은 노션문서 참고

## 5. 로컬 실행
```bash
npm install
npm run dev
# http://localhost:3000 접속
