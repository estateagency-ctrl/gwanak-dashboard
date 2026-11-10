# 한걸음부동산 · 관악구 부동산 대시보드

국토교통부 아파트 실거래가(공공데이터포털)와 한국부동산원 R-ONE 통계를 이용한 관악구 부동산 브리핑 대시보드입니다.

## 공개 사이트 (GitHub Pages)
정적 데이터 스냅샷(`data/`)을 읽어 표시합니다. API 키는 저장소에 포함되지 않습니다.

## 로컬 실행 (실시간 조회)
1. `.env.example` 을 `.env` 로 복사하고 API 키 입력
2. `node server.js` → http://localhost:8787

## 데이터 갱신 후 배포
```bash
node server.js &      # 서버 실행
node snapshot.js      # data/ 갱신
git add -A && git commit -m "data update" && git push
```

자료: 국토교통부, 한국부동산원, © OpenStreetMap contributors. 참고용 자료이며 투자 판단의 근거가 될 수 없습니다.
