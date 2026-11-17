// Parse raw ESPN responses, compute points/projections/win probabilities, write public/data/.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchedule, buildTeams, buildWeek, type BuildWarning, type DayRosters } from '../src/lib/build.ts';
import { parseDayRoster, parseMatchups, parsePlayers, parseProSchedule, parseSettings, parseTeams, spToDate } from '../src/lib/espn.ts';
import type { Meta, Week } from '../src/lib/types.ts';
import { loadLeagueConfig } from './espn-client.ts';
import { DATA_DIR, RAW_DIR, WEEKS_DIR, ensureDir } from './paths.ts';

const raw = (name: string) => JSON.parse(readFileSync(join(RAW_DIR, name), 'utf8'));
const readJson = <T>(f: string): T | null => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const writeJson = (f: string, data: unknown) => writeFileSync(f, JSON.stringify(data) + '\n');

const cfg = loadLeagueConfig();
const manifest = raw('manifest.json') as { todayET: string; scoringPeriods: number[] };
const league = raw('league.json');
const settings = parseSettings(league);
const pro = parseProSchedule(raw('pro-schedules.json'));
const abbrev = Object.fromEntries(Object.entries(pro.teams).map(([id, t]) => [id, t.abbrev]));
const players = parsePlayers(raw('players.json'), cfg.season, abbrev);
const dayRosters: DayRosters = {};
for (const sp of manifest.scoringPeriods) dayRosters[sp] = parseDayRoster(raw(`roster-sp${sp}.json`), sp);

const inp = {
  settings,
  pro,
  teams: parseTeams(league),
  matchups: parseMatchups(league),
  players: new Map(players.map((p) => [p.playerId, p])),
  dayRosters,
  todayET: manifest.todayET,
};

ensureDir(WEEKS_DIR);
const warnings: BuildWarning[] = [];
for (let mp = 1; mp <= settings.currentMatchupPeriod; mp++) {
  const f = join(WEEKS_DIR, `${mp}.json`);
  if (readJson<Week>(f)?.status === 'final') continue; // frozen
  const week = buildWeek(inp, mp, warnings);
  writeJson(f, week);
  console.log(`week ${mp}: ${week.status}, ${week.matchups.length} matchups`);
}
for (const w of warnings) {
  console.warn(`::warning::period ${w.matchupPeriod} team ${w.teamId} ${w.date}: ours ${w.ours} vs ESPN ${w.espn}`);
}

writeJson(join(DATA_DIR, 'teams.json'), buildTeams(inp, settings.currentMatchupPeriod));
writeJson(join(DATA_DIR, 'players.json'), players.map(({ proTeamId, ...p }: any) => p));
writeJson(join(DATA_DIR, 'schedule.json'), buildSchedule(inp));

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
console.log(`wrote data for "${meta.leagueName}" period ${meta.currentMatchupPeriod} (${spToDate(pro.day1, 1)} season start)`);
