// One-off: fill public/data/predictions.json for days before the nightly job started recording.
//  - live:   what the site actually published, read back from git history (from Nov 17, 2026).
//  - replay: earlier days, recomputed with the current model from games played before that day.
// Run after `npm run fetch` (needs .raw/ game logs): npx tsx scripts/backfill-predictions.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProSchedule, spToDate } from '../src/lib/espn.ts';
import { MODEL, chooseFpg, gameCv, matchupSeed, winProbability, type SimPlayer } from '../src/lib/model.ts';
import { gradePredictions, sortPredictions } from '../src/lib/predictions.ts';
import type { Meta, Prediction, Week } from '../src/lib/types.ts';
import { DATA_DIR, RAW_DIR, ROOT, WEEKS_DIR } from './paths.ts';

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const readJson = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const CALIBRATED_AT = '93dbc14'; // commit that introduced model version 2

// ---------- live: from git history ----------
const live = new Map<string, Prediction>();
const v2From = git('show', '-s', '--format=%cI', CALIBRATED_AT).trim();
const commits = git('log', '--reverse', '--format=%h %cI', '--', 'public/data/weeks').trim().split('\n').map((l) => l.split(' '));
for (const [sha, when] of commits) {
  let meta: Meta, week: Week;
  try {
    meta = JSON.parse(git('show', `${sha}:public/data/meta.json`));
    week = JSON.parse(git('show', `${sha}:public/data/weeks/${meta.currentMatchupPeriod}.json`));
  } catch {
    continue;
  }
  const date = meta.todayET;
  if (week.status === 'final' || !week.dates.includes(date)) continue;
  for (const m of week.matchups) {
    const k = `${date}:${m.matchupId}`;
    if (live.has(k)) continue; // first published prediction of the day
    live.set(k, {
      period: week.matchupPeriod, date, matchupId: m.matchupId, homeId: m.home.teamId, awayId: m.away.teamId,
      pHome: m.home.winProb, source: 'live', model: Date.parse(when) < Date.parse(v2From) ? 1 : 2, homeWon: null,
    });
  }
}

// ---------- replay: earlier days ----------
const pro = parseProSchedule(readJson(join(RAW_DIR, 'pro-schedules.json')));
type Game = { date: string; pts: number; season: number };
const logs = new Map<number, Game[]>();
const espnProj = new Map<number, number | null>();
for (const file of ['players.json', 'freeagents.json']) for (const pe of readJson(join(RAW_DIR, file)).players) {
  const p = pe.player;
  if (logs.has(p.id)) continue;
  const g: Game[] = [];
  for (const s of p.stats ?? []) if (s.statSplitTypeId === 5 && s.statSourceId === 0 && (s.stats?.['42'] ?? 0) >= 1)
    g.push({ date: s.seasonId === 2027 ? spToDate(pro.day1, s.scoringPeriodId) : '0000', pts: s.appliedTotal, season: s.seasonId });
  logs.set(p.id, g);
  espnProj.set(p.id, (p.stats ?? []).find((s: any) => s.seasonId === 2027 && s.statSplitTypeId === 0 && s.statSourceId === 1 && s.scoringPeriodId === 0)?.appliedAverage ?? null);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
function asOf(pid: number, date: string) {
  const all = logs.get(pid) ?? [];
  const cur = all.filter((x) => x.season === 2027 && x.date < date).map((x) => x.pts);
  const last = all.filter((x) => x.season === 2026).map((x) => x.pts);
  const prior = last.length >= 10 ? mean(last) : espnProj.get(pid) ?? null;
  const fpg = chooseFpg(cur.length ? mean(cur) : null, prior, cur.length);
  const cv = gameCv([...last, ...cur]);
  return { fpg, sd: cv != null ? cv * fpg : MODEL.sdFallbackFraction * fpg };
}

const replay: Prediction[] = [];
const meta: Meta = readJson(join(DATA_DIR, 'meta.json'));
for (let n = 2; n < meta.currentMatchupPeriod; n++) {
  const w: Week = readJson(join(WEEKS_DIR, `${n}.json`));
  for (const m of w.matchups) {
    w.dates.forEach((cut, i) => {
      if (live.has(`${cut}:${m.matchupId}`)) return;
      const side = (tid: number): SimPlayer[] =>
        m.lineups[tid].flatMap((r) => {
          const ds = w.dates.filter((d) => r.dailyStarter[d] && (r.dailyStatus[d] === 'played' || r.dailyStatus[d] === 'dnp'));
          if (!ds.length) return [];
          // Past injury reports aren't available: a starter who missed every game that week counts as listed OUT.
          const out = !ds.some((d) => r.dailyStatus[d] === 'played');
          const e = asOf(r.playerId, cut);
          return [{
            starter: true, fpg: e.fpg, sd: e.sd,
            actual: ds.filter((d) => d < cut).reduce((a, d) => a + (r.daily[d] ?? 0), 0),
            remaining: ds.filter((d) => d >= cut).map(() => ({ p: out ? 0 : MODEL.playProbability.active, fixed: null })),
          }];
        });
      const wp = winProbability(side(m.home.teamId), side(m.away.teamId), MODEL.trials, matchupSeed(m.matchupId) + i);
      replay.push({
        period: n, date: cut, matchupId: m.matchupId, homeId: m.home.teamId, awayId: m.away.teamId,
        pHome: wp.home, source: 'replay', model: MODEL.version, homeWon: null,
      });
    });
  }
}

const weeks: Week[] = Array.from({ length: meta.matchupPeriods.length }, (_, i) => i + 1).map((n) => readJson(join(WEEKS_DIR, `${n}.json`)));
const all = sortPredictions(gradePredictions([...replay, ...live.values()], weeks));
writeFileSync(join(DATA_DIR, 'predictions.json'), JSON.stringify(all) + '\n');
console.log(`predictions: ${live.size} live (from git history), ${replay.length} replayed, ${all.filter((p) => p.homeWon != null).length} graded`);
