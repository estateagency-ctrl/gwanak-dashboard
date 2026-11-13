// 관악구 부동산 대시보드 - 로컬 프록시 서버 (의존성 없음, Node 18+)
// 실행: node server.js  →  http://localhost:8787
// API 키는 서버에서만 사용되며 브라우저로 노출되지 않습니다. (환경변수로도 지정 가능)
const http = require('http');
const fs = require('fs');
const path = require('path');

try { // .env 파일(깃에 올라가지 않음)에서 API 키 로드
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach((l) => { const m = l.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; });
} catch (e) { /* no .env */ }
const DATA_KEY = process.env.DATA_GO_KR_KEY;
const REB_KEY = process.env.REB_KEY;
const VWORLD_KEY = process.env.VWORLD_KEY;
if (!DATA_KEY || !REB_KEY) { console.error('.env 파일에 DATA_GO_KR_KEY, REB_KEY 를 설정하세요 (.env.example 참고)'); process.exit(1); }
const PORT = process.env.PORT || 8787;
const LAWD = '11620'; // 서울 관악구
const GEO_FILE = path.join(__dirname, 'geocache.json');

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getText(url, opt, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), ...opt });
      if (r.ok) return await r.text();
    } catch (e) { /* retry */ }
    await sleep(500 * (i + 1));
  }
  throw new Error('upstream failed: ' + url.split('?')[0]);
}

// ---------- 국토교통부 실거래가 (공공데이터포털) ----------
function parseItems(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const o = {};
    m[1].replace(/<(\w+)>([^<]*)<\/\1>/g, (_, k, v) => { o[k] = v.trim(); return ''; });
    out.push(o);
  }
  return out;
}
const num = (s) => Number(String(s || '0').replace(/,/g, '')) || 0;

async function fetchMonth(kind, ym) {
  const svc = kind === 'trade' ? 'RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade' : 'RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
  const ttl = ym >= new Date().toISOString().slice(0, 7).replace('-', '') ? 30 * 60e3 : 24 * 3600e3;
  return cached(`${kind}:${ym}`, ttl, async () => {
    let page = 1, all = [];
    for (;;) {
      const url = `https://apis.data.go.kr/1613000/${svc}?serviceKey=${DATA_KEY}&LAWD_CD=${LAWD}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
      const xml = await getText(url);
      const code = (xml.match(/<resultCode>(\w+)<\/resultCode>/) || [])[1];
      if (code && code !== '000' && code !== '00') throw new Error('API ' + code + ' ' + (xml.match(/<resultMsg>([^<]*)/) || [])[1]);
      const items = parseItems(xml);
      all = all.concat(items);
      const total = num((xml.match(/<totalCount>(\d+)<\/totalCount>/) || [])[1]);
      if (all.length >= total || items.length === 0) break;
      page++;
    }
    return all.map((o) => {
      const d = `${o.dealYear}-${String(o.dealMonth).padStart(2, '0')}-${String(o.dealDay).padStart(2, '0')}`;
      if (kind === 'trade') {
        if (o.cdealType && o.cdealType.trim()) return null; // 해제 건 제외
        return { k: 'T', apt: o.aptNm, dong: o.umdNm, jibun: o.jibun, area: Number(o.excluUseAr), floor: Number(o.floor), date: d, price: num(o.dealAmount), by: Number(o.buildYear) };
      }
      const mr = num(o.monthlyRent);
      return { k: mr > 0 ? 'M' : 'J', apt: o.aptNm, dong: o.umdNm, jibun: o.jibun, road: o.roadnm || '', area: Number(o.excluUseAr), floor: Number(o.floor), date: d, deposit: num(o.deposit), rent: mr, by: Number(o.buildYear) };
    }).filter(Boolean);
  });
}
function months(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(4);
  const ey = +to.slice(0, 4), em = +to.slice(4);
  while ((y < ey || (y === ey && m <= em)) && out.length < 36) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

// ---------- 한국부동산원 R-ONE ----------
const RONE = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
async function rone(params) {
  const q = new URLSearchParams({ KEY: REB_KEY, Type: 'json', ...params }).toString();
  const txt = await getText(`${RONE}?${q}`);
  const j = JSON.parse(txt);
  return (j.SttsApiTblData && j.SttsApiTblData[1] && j.SttsApiTblData[1].row) || [];
}
const T_SALE_W = 'T244183132827305', T_JEON_W = 'T247713133046872';
const T_VOL = 'A_2024_00554', T_UNSOLD = 'T237973129847263';
const CLS_GWANAK = 50066, CLS_SEOUL = 50008;

async function weekly(tbl, cls) {
  return cached(`w:${tbl}:${cls}`, 6 * 3600e3, async () => {
    const rows = await rone({ STATBL_ID: tbl, DTACYCLE_CD: 'WK', CLS_ID: cls, pIndex: 1, pSize: 1000 });
    return rows.map((r) => ({ d: r.WRTTIME_DESC, v: +r.DTA_VAL })).filter((r) => r.d >= '2019-01-01');
  });
}
function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out.reverse();
}
async function monthlySeries(tbl, filter, n = 30) {
  const res = await pool(lastMonths(n), 6, async (ym) => {
    try {
      const rows = await cached(`m:${tbl}:${ym}`, 12 * 3600e3, () => rone({ STATBL_ID: tbl, DTACYCLE_CD: 'MM', WRTTIME_IDTFR_ID: ym, pIndex: 1, pSize: 1000 }));
      const r = rows.find(filter);
      return r ? { ym, v: +r.DTA_VAL } : null;
    } catch (e) { return null; }
  });
  return res.filter(Boolean);
}
async function roneAll() {
  return cached('rone', 3 * 3600e3, async () => {
    const [saleG, saleS, jeonG, jeonS, vol, unsold, unsoldSeoul] = await Promise.all([
      weekly(T_SALE_W, CLS_GWANAK), weekly(T_SALE_W, CLS_SEOUL),
      weekly(T_JEON_W, CLS_GWANAK), weekly(T_JEON_W, CLS_SEOUL),
      monthlySeries(T_VOL, (r) => r.CLS_FULLNM === '서울>관악구' && /동\(호\)수/.test(r.ITM_NM)),
      monthlySeries(T_UNSOLD, (r) => r.CLS_FULLNM === '서울>관악구'),
      monthlySeries(T_UNSOLD, (r) => r.CLS_FULLNM === '서울>계'),
    ]);
    return { saleG, saleS, jeonG, jeonS, vol, unsold, unsoldSeoul };
  });
}

// ---------- 지오코딩 (OpenStreetMap Nominatim, 파일 캐시) ----------
let geo = {};
try { geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8')); } catch (e) { /* none */ }
let geoQueue = Promise.resolve();
const geoMiss = new Set();
async function vworldGeo(dong, jibun) {
  if (!VWORLD_KEY || !jibun) return null;
  const u = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&type=parcel&format=json&key=${VWORLD_KEY}&address=${encodeURIComponent(`서울특별시 관악구 ${dong} ${jibun}`)}`;
  try {
    const j = JSON.parse(await getText(u, { headers: { Referer: 'http://localhost:8787/' } }, 2));
    const r = j.response;
    if (r && r.status === 'OK' && r.result && r.result.point) {
      return { lat: +r.result.point.y, lng: +r.result.point.x, exact: true, src: 'vw', hdong: (r.refined && r.refined.structure && r.refined.structure.level4A) || '' };
    }
  } catch (e) { /* fall through */ }
  return null;
}
function geocode(name, dong, jibun) {
  const key = `${name}|${dong}`;
  if (geo[key] && (geo[key].src === 'vw' || !jibun)) return Promise.resolve(geo[key]);
  if (jibun) {
    const p = vworldGeo(dong, jibun).then((g) => {
      if (g) { geo[key] = g; try { fs.writeFileSync(GEO_FILE, JSON.stringify(geo)); } catch (e) { /* ignore */ } return g; }
      return geo[key] ? geo[key] : geocodeOsm(name, dong, key);
    });
    return p;
  }
  return geocodeOsm(name, dong, key);
}
function geocodeOsm(name, dong, key) {
  if (geo[key]) return Promise.resolve(geo[key]);
  if (geoMiss.has(key)) return Promise.resolve({ lat: null, lng: null, exact: false });
  const job = geoQueue.then(async () => {
    if (geo[key]) return geo[key];
    const vb = '126.89,37.50,126.99,37.44';
    const base = name.replace(/\(.*?\)/g, '').trim();
    const tries = [...new Set([`${base}아파트 ${dong}`, `${base} ${dong}`, base])];
    let found = null;
    for (const q of tries) {
      try {
        const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&viewbox=${vb}&bounded=1&q=${encodeURIComponent(q + ' 관악구')}`;
        const t = await getText(u, { headers: { 'User-Agent': 'gwanak-realestate-dashboard/1.0' } }, 1);
        const j = JSON.parse(t);
        if (j[0]) { found = { lat: +j[0].lat, lng: +j[0].lon, exact: true }; break; }
      } catch (e) { /* next */ }
      await sleep(1100);
    }
    if (!found) { found = { lat: null, lng: null, exact: false }; geoMiss.add(key); }
    if (found.exact) { geo[key] = found; try { fs.writeFileSync(GEO_FILE, JSON.stringify(geo)); } catch (e) { /* ignore */ } }
    await sleep(1100);
    return found;
  });
  geoQueue = job.catch(() => {});
  return job;
}


// ---------- 주변 입지 (OpenStreetMap Overpass, 미러 순회 + 캐시) ----------
const POI_FILE = path.join(__dirname, 'poicache.json');
let poiCache = {};
try { poiCache = JSON.parse(fs.readFileSync(POI_FILE, 'utf8')); } catch (e) { /* none */ }
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function poi(lat, lng) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  if (poiCache[key]) return poiCache[key];
  const q = `[out:json][timeout:25];(
nwr(around:1500,${lat},${lng})["railway"~"station|halt"]["name"];
nwr(around:500,${lat},${lng})["highway"="bus_stop"]["name"];
nwr(around:1500,${lat},${lng})["amenity"="school"]["name"];
nwr(around:1800,${lat},${lng})["shop"~"supermarket|department_store|mall"]["name"];
nwr(around:1000,${lat},${lng})["amenity"="cafe"]["name"];
nwr(around:2500,${lat},${lng})["amenity"~"townhall|police|post_office|fire_station"]["name"];
nwr(around:2500,${lat},${lng})["amenity"~"hospital"]["name"];
);out center tags 500;`;
  for (let round = 0; round < 1; round++) {
    for (const m of MIRRORS) {
      try {
        const r = await fetch(m, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gwanak-realestate-dashboard/1.0' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(14000) });
        if (!r.ok) continue;
        const j = await r.json();
        const out = j.elements.map((e) => {
          const t = e.tags || {};
          const la = e.lat ?? (e.center && e.center.lat), lo = e.lon ?? (e.center && e.center.lon);
          let cat = null;
          if (t.railway) cat = 'station'; else if (t.highway === 'bus_stop') cat = 'bus';
          else if (t.amenity === 'school') cat = 'school'; else if (t.shop) cat = 'shop';
          else if (t.amenity === 'cafe') cat = 'cafe'; else if (t.amenity === 'hospital') cat = 'hospital';
          else if (t.amenity) cat = 'gov';
          return cat && la ? { cat, name: t.name, lat: la, lng: lo, brand: t.brand || '', shop: t.shop || '', sub: t.subway || t.station || '', line: t.line || t.network || '', op: t.operator || '', ref: t.ref || '' } : null;
        }).filter(Boolean);
        poiCache[key] = out;
        try { fs.writeFileSync(POI_FILE, JSON.stringify(poiCache)); } catch (e) { /* ignore */ }
        return out;
      } catch (e) { /* next mirror */ }
    }
    await sleep(1500);
  }
  return null;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/deals') {
      const now = new Date().toISOString().slice(0, 7).replace('-', '');
      let from = u.searchParams.get('from') || now, to = u.searchParams.get('to') || now;
      if (!/^\d{6}$/.test(from) || !/^\d{6}$/.test(to)) return send(res, 400, { error: 'bad range' });
      const ms = months(from, to);
      const parts = await pool(ms, 4, async (ym) => {
        const [t, r] = await Promise.all([fetchMonth('trade', ym), fetchMonth('rent', ym)]);
        return t.concat(r);
      });
      return send(res, 200, { deals: parts.flat(), months: ms });
    }
    if (u.pathname === '/api/rone') return send(res, 200, await roneAll());
    if (u.pathname === '/api/geo') {
      const g = await geocode(u.searchParams.get('name') || '', u.searchParams.get('dong') || '', u.searchParams.get('jibun') || '');
      return send(res, 200, g);
    }
    if (u.pathname === '/api/poi') {
      const lat = +u.searchParams.get('lat'), lng = +u.searchParams.get('lng');
      if (!(lat > 37.3 && lat < 37.7 && lng > 126.7 && lng < 127.2)) return send(res, 400, { error: 'bad coords' });
      const r = await poi(lat, lng);
      return send(res, 200, { ok: !!r, items: r || [] });
    }
    let p = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
    const fp = path.join(__dirname, path.normalize(p));
    if (!fp.startsWith(__dirname) || !/\.(html|js|css|svg|json)$/.test(fp) || /server\.js|geocache|poicache/.test(fp)) return send(res, 404, 'Not found', 'text/plain');
    fs.readFile(fp, (e, b) => e ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, b, MIME[path.extname(fp)] || 'application/octet-stream'));
  } catch (e) {
    send(res, 502, { error: String(e.message || e) });
  }
});
srv.keepAliveTimeout = 65000;
srv.requestTimeout = 0;
srv.listen(PORT, () => console.log(`관악구 대시보드: http://localhost:${PORT}`));
process.on('uncaughtException', (e) => console.error('uncaught', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled', e && e.message));
