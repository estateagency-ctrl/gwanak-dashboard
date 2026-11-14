// 관악구 일대 주변시설(지하철·버스·학교·마트·카페·관공서·병원) 전체를 한 번에 받아 data/poi.json 으로 저장
// 실행: node poi_snapshot.js   (화면은 이 파일을 읽어 즉시 입지분석을 표시합니다)
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'data', 'poi.json');
const BB = '37.425,126.875,37.515,127.005'; // 남,서,북,동 (관악구 + 약 2.5km 여유)
const Q = `[out:json][timeout:180];(
nwr(${BB})["railway"~"station|halt"]["name"];
nwr(${BB})["highway"="bus_stop"]["name"];
nwr(${BB})["amenity"="school"]["name"];
nwr(${BB})["shop"~"supermarket|department_store|mall"]["name"];
nwr(${BB})["amenity"="cafe"]["name"];
nwr(${BB})["amenity"~"townhall|police|post_office|fire_station|hospital"]["name"];
);out center tags;`;
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let round = 1; round <= 8; round++) {
    for (const m of MIRRORS) {
      try {
        console.log(`시도 ${round} ${m}`);
        const r = await fetch(m, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gwanak-realestate-dashboard/1.0' }, body: 'data=' + encodeURIComponent(Q), signal: AbortSignal.timeout(200000) });
        if (!r.ok) { console.log(' →', r.status); continue; }
        const j = await r.json();
        const items = j.elements.map((e) => {
          const t = e.tags || {};
          const la = e.lat ?? (e.center && e.center.lat), lo = e.lon ?? (e.center && e.center.lon);
          let cat = null;
          if (t.railway) cat = 'station'; else if (t.highway === 'bus_stop') cat = 'bus';
          else if (t.amenity === 'school') cat = 'school'; else if (t.shop) cat = 'shop';
          else if (t.amenity === 'cafe') cat = 'cafe'; else if (t.amenity === 'hospital') cat = 'hospital'; else if (t.amenity) cat = 'gov';
          return cat && la ? { c: cat, n: t.name, a: +la.toFixed(5), o: +lo.toFixed(5), s: t.shop || '' } : null;
        }).filter(Boolean);
        fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), items }));
        const cnt = {}; items.forEach((i) => { cnt[i.c] = (cnt[i.c] || 0) + 1; });
        console.log('저장 완료', items.length, cnt);
        return;
      } catch (e) { console.log(' →', e.message); }
    }
    await sleep(15000 * round);
  }
  console.error('모든 서버 실패 - 잠시 후 다시 실행하세요'); process.exit(1);
})();
