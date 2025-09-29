// scan_log.js — append a one-line CSV summary per tournament & region
require('dotenv').config();
const fs = require('fs');

const API = 'https://api.the-odds-api.com/v4';
const API_KEY = process.env.ODDS_API_KEY;
const REGIONS = (process.env.REGIONS || 'eu') // default to EU only to save quota
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!API_KEY) {
  console.error('ERROR: Missing ODDS_API_KEY in .env');
  process.exit(1);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function getTennisSports() {
  const data = await fetchJSON(`${API}/sports/?apiKey=${API_KEY}`);
  return data
    .filter(s =>
      (s.group || '').toLowerCase().includes('tennis') ||
      (s.details || '').toLowerCase().includes('tennis') ||
      (s.title || '').toLowerCase().includes('tennis')
    )
    .map(s => ({ key: s.key, title: s.title, active: !!s.active }));
}

async function countEvents(sportKey, region) {
  try {
    const data = await fetchJSON(
      `${API}/sports/${sportKey}/odds?regions=${region}&markets=h2h&oddsFormat=decimal&apiKey=${API_KEY}`
    );
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return -1; // error marker
  }
}

(async () => {
  try {
    const ts = new Date().toISOString();
    const sports = (await getTennisSports()).filter(s => s.active);
    const rows = [];

    for (const s of sports) {
      for (const r of REGIONS) {
        const n = await countEvents(s.key, r);
        rows.push({ ts, key: s.key, title: s.title, region: r, count: n });
        await new Promise(res => setTimeout(res, 150)); // gentle on rate limits
      }
    }

    const header = 'timestamp,key,title,region,count\n';
    const line = (o) =>
      `${o.ts},${JSON.stringify(o.key)},${JSON.stringify(o.title)},${o.region},${o.count}\n`;

    const outPath = 'scan_history.csv';
    if (!fs.existsSync(outPath)) fs.writeFileSync(outPath, header);
    fs.appendFileSync(outPath, rows.map(line).join(''));
    console.log(`Appended ${rows.length} rows to ${outPath}`);
  } catch (e) {
    console.error('ERROR:', e.message || e);
    process.exit(1);
  }
})();
