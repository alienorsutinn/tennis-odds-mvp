// odds_all.js — fetch odds for all active tennis tournaments (single region) and write a merged CSV+JSON
// keeps it free-tier friendly (default REGION from env or eu)
require('dotenv').config();
const fs = require('fs');

const API = 'https://api.the-odds-api.com/v4';
const API_KEY = process.env.ODDS_API_KEY;
const REGION = (process.env.REGION || 'eu').trim();

if (!API_KEY) {
  console.error('ERROR: Missing ODDS_API_KEY');
  process.exit(1);
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function normalizeDecimalOddsToProbs(decimalOdds) {
  const implied = decimalOdds.map(o => 1 / o);
  const sum = implied.reduce((a, b) => a + b, 0);
  return implied.map(p => p / sum);
}

async function getActiveTennisKeys() {
  const res = await fetch(`${API}/sports/?apiKey=${API_KEY}`);
  if (!res.ok) throw new Error(`sports failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data
    .filter(s =>
      (s.group || '').toLowerCase().includes('tennis') ||
      (s.details || '').toLowerCase().includes('tennis') ||
      (s.title || '').toLowerCase().includes('tennis')
    )
    .filter(s => s.active)
    .map(s => ({ key: s.key, title: s.title }));
}

async function fetchOddsForKey(sportKey) {
  const url = `${API}/sports/${sportKey}/odds?regions=${REGION}&markets=h2h&oddsFormat=decimal&apiKey=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const raw = await res.json();
  const rows = [];
  for (const ev of raw) {
    const bk = (ev.bookmakers || []).find(b => (b.markets || []).some(m => m.key === 'h2h'));
    const h2h = bk?.markets?.find(m => m.key === 'h2h');
    if (!h2h) continue;
    const names = h2h.outcomes.map(o => o.name);
    const odds = h2h.outcomes.map(o => o.price);
    if (odds.length < 2) continue;
    const probs = normalizeDecimalOddsToProbs(odds);
    rows.push({
      event_id: ev.id,
      start: ev.commence_time,
      player1: names[0] || '',
      player2: names[1] || '',
      odds1: odds[0],
      odds2: odds[1],
      prob1: Number.isFinite(probs[0]) ? probs[0].toFixed(4) : '',
      prob2: Number.isFinite(probs[1]) ? probs[1].toFixed(4) : '',
      bookmaker: bk?.title || bk?.key || '',
      sport_key: sportKey,
      region: REGION
    });
  }
  return rows;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

(async () => {
  try {
    const ts = new Date().toISOString();
    const keys = await getActiveTennisKeys();

    const all = [];
    for (const { key } of keys) {
      const rows = await fetchOddsForKey(key);
      all.push(...rows);
      await sleep(200); // be gentle with free tier
    }

    // write merged snapshot (overwrites "latest", plus timestamped archive)
    const outDir = 'data';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    const csv = toCsv(all);
    const stamp = ts.replace(/[-:]/g,'').slice(0,15);
    fs.writeFileSync(`${outDir}/odds_latest.csv`, csv);
    fs.writeFileSync(`${outDir}/odds_latest.json`, JSON.stringify({ fetchedAt: ts, region: REGION, count: all.length, events: all }, null, 2));
    fs.writeFileSync(`${outDir}/odds_${stamp}.csv`, csv); // archive (optional; comment if you don’t want growth)
    console.log(`Wrote ${all.length} rows to data/odds_latest.csv (region=${REGION})`);
  } catch (e) {
    console.error('ERROR:', e.message || e);
    process.exit(1);
  }
})();
