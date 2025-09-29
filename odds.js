// odds.js — with --csv, --include, and --region
require('dotenv').config();
const fs = require('fs');

const API = 'https://api.the-odds-api.com/v4';
const API_KEY = process.env.ODDS_API_KEY;

if (!API_KEY) {
  console.error('ERROR: Missing ODDS_API_KEY in .env');
  process.exit(1);
}

function normalizeDecimalOddsToProbs(decimalOdds) {
  const implied = decimalOdds.map(o => 1 / o);
  const sum = implied.reduce((a, b) => a + b, 0);
  return implied.map(p => p / sum);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n');
}

async function listSports() {
  const url = `${API}/sports/?apiKey=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sports fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const tennis = data.filter(s =>
    (s.group || '').toLowerCase().includes('tennis') ||
    (s.details || '').toLowerCase().includes('tennis') ||
    (s.title || '').toLowerCase().includes('tennis')
  );
  console.log('Tennis sport keys:\n');
  tennis.forEach(s => console.log(`- ${s.key}  |  ${s.title}  |  active=${s.active}`));
}

function filterByNames(events, includePattern) {
  if (!includePattern) return events;
  const re = new RegExp(includePattern, 'i');
  return events.filter(e => re.test((e.players || []).join(' ')));
}

async function fetchOddsForKey(sportKey, { include, writeCsv, region }) {
  const regionToUse = region || process.env.REGION || 'eu';
  const url = `${API}/sports/${sportKey}/odds?regions=${regionToUse}&markets=h2h&oddsFormat=decimal&apiKey=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds fetch failed: ${res.status} ${res.statusText}`);
  const raw = await res.json();

  const mapped = raw.map(ev => {
    const bk = (ev.bookmakers || []).find(b => (b.markets || []).some(m => m.key === 'h2h'));
    const h2h = bk?.markets?.find(m => m.key === 'h2h');
    if (!h2h) return null;
    const names = h2h.outcomes.map(o => o.name);
    const odds = h2h.outcomes.map(o => o.price);
    if (odds.length < 2) return null;
    const probs = normalizeDecimalOddsToProbs(odds);
    return {
      id: ev.id,
      start: ev.commence_time,
      players: names,
      odds_decimal: odds,
      probs_normalized: probs,
      bookmaker: bk?.title || bk?.key,
    };
  }).filter(Boolean);

  const filtered = filterByNames(mapped, include);

  const out = {
    sportKey,
    region: regionToUse,
    filter: include || null,
    fetchedAt: new Date().toISOString(),
    events: filtered
  };
  const jsonName = `odds_${sportKey}.json`;
  fs.writeFileSync(jsonName, JSON.stringify(out, null, 2));
  console.log(`Saved ${filtered.length} events to ${jsonName} (region=${regionToUse})`);

  if (writeCsv) {
    const rows = filtered.map(e => ({
      id: e.id,
      start: e.start,
      player1: e.players[0] || '',
      player2: e.players[1] || '',
      odds1: e.odds_decimal[0] ?? '',
      odds2: e.odds_decimal[1] ?? '',
      prob1: e.probs_normalized[0]?.toFixed(4) ?? '',
      prob2: e.probs_normalized[1]?.toFixed(4) ?? '',
      bookmaker: e.bookmaker || '',
      region: regionToUse
    }));
    const csv = toCsv(rows);
    const csvName = `odds_${sportKey}.csv`;
    fs.writeFileSync(csvName, csv);
    console.log(`Saved CSV to ${csvName} (region=${regionToUse})`);
  }

  if (filtered[0]) console.log('Sample:', filtered[0]);
}

// ---- CLI ----
(async () => {
  const [, , cmd, arg, ...rest] = process.argv;
  const flags = { include: null, writeCsv: false, region: null };
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--include') { flags.include = rest[i + 1] || null; i++; }
    else if (t === '--csv') { flags.writeCsv = true; }
    else if (t === '--region') { flags.region = rest[i + 1] || null; i++; }
  }

  try {
    if (cmd === 'sports') {
      await listSports();
    } else if (cmd === 'fetch') {
      if (!arg) throw new Error('Usage: node odds.js fetch <sport_key> [--include "A|B"] [--csv] [--region eu|uk|us|au]');
      await fetchOddsForKey(arg, flags);
    } else {
      console.log('Commands:\n  node odds.js sports\n  node odds.js fetch <sport_key> [--include "A|B"] [--csv] [--region eu|uk|us|au]');
    }
  } catch (e) {
    console.error('ERROR:', e.message || e);
    process.exit(1);
  }
})();
