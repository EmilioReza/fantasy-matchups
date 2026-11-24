// Parse raw ESPN responses, compute points/projections/win probabilities, write public/data/.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spToDate } from '../src/lib/espn.ts';
import { buildFromRaw, type RawData } from '../src/lib/pipeline.ts';
import { gradePredictions, recordPredictions } from '../src/lib/predictions.ts';
import { MODEL } from '../src/lib/model.ts';
import type { Meta, Prediction, Week } from '../src/lib/types.ts';
import { loadLeagueConfig } from './espn-client.ts';
import { DATA_DIR, RAW_DIR, WEEKS_DIR, ensureDir } from './paths.ts';

const raw = (name: string) => JSON.parse(readFileSync(join(RAW_DIR, name), 'utf8'));
const readJson = <T>(f: string): T | null => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const writeJson = (f: string, data: unknown) => writeFileSync(f, JSON.stringify(data) + '\n');

const cfg = loadLeagueConfig();
const manifest = raw('manifest.json') as { todayET: string; scoringPeriods: number[]; plannedPeriods?: number[] };
const rawData: RawData = {
  league: raw('league.json'),
  pro: raw('pro-schedules.json'),
  days: Object.fromEntries(manifest.scoringPeriods.map((sp) => [sp, raw(`roster-sp${sp}.json`)])),
  planned: Object.fromEntries((manifest.plannedPeriods ?? []).map((mp) => [mp, raw(`plan-mp${mp}.json`)])),
  players: raw('players.json'),
  freeAgents: existsSync(join(RAW_DIR, 'freeagents.json')) ? raw('freeagents.json') : { players: [] },
  todayET: manifest.todayET,
};

ensureDir(WEEKS_DIR);
// Every scheduled period: past (frozen once final), current, and future (from the lineups set on ESPN).
const built = buildFromRaw(rawData, cfg, {
  periods: (_current, last) =>
    Array.from({ length: last }, (_, i) => i + 1).filter((mp) => readJson<Week>(join(WEEKS_DIR, `${mp}.json`))?.status !== 'final'),
});
for (const week of built.weeks) {
  writeJson(join(WEEKS_DIR, `${week.matchupPeriod}.json`), week);
  console.log(`week ${week.matchupPeriod}: ${week.status}, ${week.matchups.length} matchups`);
}
for (const w of built.warnings) {
  console.warn(`::warning::period ${w.matchupPeriod} team ${w.teamId} ${w.date}: ours ${w.ours} vs ESPN ${w.espn}`);
}

// Track record: save today's win probabilities, grade any week that is now final.
const predFile = join(DATA_DIR, 'predictions.json');
let predictions = readJson<Prediction[]>(predFile) ?? [];
const currentWeek = built.weeks.find((w) => w.matchupPeriod === built.settings.currentMatchupPeriod);
if (currentWeek) predictions = recordPredictions(predictions, currentWeek, rawData.todayET, MODEL.version);
const allWeeks = readdirSync(WEEKS_DIR).map((f) => readJson<Week>(join(WEEKS_DIR, f))!);
predictions = gradePredictions(predictions, allWeeks);
writeJson(predFile, predictions);

writeJson(join(DATA_DIR, 'teams.json'), built.teams);
writeJson(join(DATA_DIR, 'players.json'), built.players);
writeJson(join(DATA_DIR, 'freeagents.json'), built.freeAgents);
writeJson(join(DATA_DIR, 'schedule.json'), built.schedule);

const settings = built.settings;
const prev = readJson<Meta>(join(DATA_DIR, 'meta.json'));
const kind = process.env.RUN_KIND ?? 'manual';
const chicagoDate = process.env.CHICAGO_DATE ?? null;
const periods = readdirSync(WEEKS_DIR)
  .map((f) => Number(f.replace('.json', '')))
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const curWeek = readJson<Week>(join(WEEKS_DIR, `${settings.currentMatchupPeriod}.json`))!;
const meta: Meta = {
  schemaVersion: 1,
  leagueId: cfg.leagueId,
  leagueName: settings.name,
  season: cfg.season,
  timezone: cfg.timezone,
  lineupLockType: settings.lockType,
  currentMatchupPeriod: settings.currentMatchupPeriod,
  matchupPeriods: periods,
  dates: curWeek.dates,
  todayET: manifest.todayET,
  generatedAt: new Date().toISOString(),
  lastRunChicagoDate: kind === 'run1' ? chicagoDate : prev?.lastRunChicagoDate ?? null,
  lastSettleChicagoDate: kind === 'run5' ? chicagoDate : prev?.lastSettleChicagoDate ?? null,
};
writeJson(join(DATA_DIR, 'meta.json'), meta);
console.log(`wrote data for "${meta.leagueName}" period ${meta.currentMatchupPeriod} (${spToDate(built.pro.day1, 1)} season start)`);
