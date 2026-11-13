// 데이터 스냅샷 생성: 로컬 서버(node server.js)가 켜져 있는 상태에서 실행
//   node snapshot.js        → data/ 폴더 갱신 (GitHub Pages 가 읽는 정적 데이터)
const fs = require('fs'), path = require('path');
const BASE = 'http://localhost:8787', OUT = path.join(__dirname, 'data');
fs.mkdirSync(OUT, { recursive: true });
const get = async (u) => { const r = await fetch(BASE + u, { signal: AbortSignal.timeout(180000) }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
(async () => {
  const now = new Date(); const ms = [];
  for (let i = 0; i < 13; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); ms.push(d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0')); }
  const recent = [];
  for (const ym of ms.reverse()) {
    const j = await get(`/api/deals?from=${ym}&to=${ym}`);
    fs.writeFileSync(path.join(OUT, `deals-${ym}.json`), JSON.stringify(j.deals));
    console.log(ym, j.deals.length);
    if (ms.indexOf(ym) >= ms.length - 4) recent.push(...j.deals);
  }
  fs.writeFileSync(path.join(OUT, 'rone.json'), JSON.stringify(await get('/api/rone')));
  // 지도 좌표 미리 조회 (최근 4개월 거래 2건 이상 단지)
  const cnt = {};
  recent.filter((d) => d.area >= 20).forEach((d) => { const k = d.apt + '|' + d.dong; cnt[k] = (cnt[k] || 0) + 1; });
  const jb = {}; recent.forEach((d) => { jb[d.apt + '|' + d.dong] = d.jibun; });
  const keys = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  console.log('geocoding', keys.length);
  const geo = {};
  try { Object.assign(geo, JSON.parse(fs.readFileSync(path.join(OUT, 'geo.json'), 'utf8'))); } catch (e) {}
  for (const k of keys) {
    if (geo[k] && geo[k].src === 'vw') continue;
    const [name, dong] = k.split('|');
    try { const g = await get(`/api/geo?name=${encodeURIComponent(name)}&dong=${encodeURIComponent(dong)}&jibun=${encodeURIComponent(jb[k] || '')}`); if (g.exact) geo[k] = g; } catch (e) {}
    fs.writeFileSync(path.join(OUT, 'geo.json'), JSON.stringify(geo));
  }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ updated: new Date().toISOString().slice(0, 10) }));
  console.log('완료. geo', Object.keys(geo).length);
})().catch((e) => { console.error(e); process.exit(1); });
