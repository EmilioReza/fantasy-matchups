// The ESPN fetch + build pipeline, shared by the nightly job (Node) and the site's Refresh button
// (browser), so both produce the same numbers. Pure apart from the `get` function it is given.
import { buildSchedule, buildTeams, buildWeek, type BuildInputs, type BuildWarning, type DayRosters, type LiveDay } from './build.ts';
import {
  matchupPeriodScoringPeriods, modelFpg, parseDayRoster, parseMatchups, parsePlayers, parseProSchedule, parseSettings,
  parseTeams, spToDate, type LeagueSettings, type ProSchedule,
} from './espn.ts';
import { MODEL } from './model.ts';
import type { Player, Schedule, Team, Week } from './types.ts';

export interface LeagueConfig {
  leagueId: number;
  season: number;
  timezone: string;
  /** teamId → manager first name, when ESPN's first name is not the one the league uses. */
  managerNames?: Record<string, string>;
}

/** GET an ESPN fantasy API path (starting with /apis/...) as JSON. */
export type Getter = (path: string, headers?: Record<string, string>) => Promise<any>;

// ---------- Request paths ----------

export function leaguePath(cfg: LeagueConfig, views: string[], extra = ''): string {
  const q = views.map((v) => `view=${v}`).join('&');
  return `/apis/v3/games/fba/seasons/${cfg.season}/segments/0/leagues/${cfg.leagueId}?${q}${extra}`;
}

export function seasonPath(cfg: LeagueConfig, views: string[]): string {
  return `/apis/v3/games/fba/seasons/${cfg.season}?${views.map((v) => `view=${v}`).join('&')}`;
}

const statsFilter = (season: number) => ({ value: 82, additionalValue: [`00${season}`, `02${season}`, `10${season}`] });

/** Filter for kona_playercard: season totals, last-15, projection, plus up to 82 single-game logs per player. */
export function playerFilterHeader(playerIds: number[], season: number): Record<string, string> {
  return {
    'X-Fantasy-Filter': JSON.stringify({
      players: {
        filterIds: { value: playerIds },
        limit: playerIds.length + 10,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
        filterStatsForTopScoringPeriodIds: statsFilter(season),
      },
    }),
  };
}

/** Filter for kona_player_info: the most-owned free agents and waiver players, with game logs. */
export function freeAgentFilterHeader(limit: number, season: number): Record<string, string> {
  return {
    'X-Fantasy-Filter': JSON.stringify({
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
        limit,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
        filterStatsForTopScoringPeriodIds: statsFilter(season),
      },
    }),
  };
}

// ---------- Fetch ----------

export interface RawData {
  league: any;
  pro: any;
  /** scoringPeriodId → mRoster for that day (finished days, plus today when live). */
  days: Record<number, any>;
  /** matchup period → mRoster on its first day: the lineup managers have set for a future week. */
  planned: Record<number, any>;
  players: { players: any[] };
  freeAgents: { players: any[] };
  todayET: string;
}

export interface FetchOptions {
  todayET: string;
  /** Which days' rosters to fetch. */
  wantDay: (mp: number, date: string, currentPeriod: number) => boolean;
  /** Players to include beyond today's rosters (e.g. everyone in published weeks). */
  extraPlayerIds?: Iterable<number>;
  /** Parallel requests (Node keeps 1 to be polite; the browser uses a few). */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

async function pool<T>(jobs: (() => Promise<T>)[], n: number, tick: () => void): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
      tick();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, worker));
  return out;
}

export async function fetchRaw(get: Getter, cfg: LeagueConfig, opts: FetchOptions): Promise<RawData> {
  let done = 0;
  let total = 30; // rough until the league tells us how many days and weeks there are
  const tick = () => opts.onProgress?.(++done, total);
  const [league, pro] = await pool(
    [
      () => get(leaguePath(cfg, ['mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mSettings', 'mStatus'])),
      () => get(seasonPath(cfg, ['proTeamSchedules_wl'])),
    ],
    opts.concurrency ?? 1,
    tick,
  );
  const settings = parseSettings(league);
  const proSched = parseProSchedule(pro);
  const current = settings.currentMatchupPeriod;
  const lastPeriod = Math.max(current, ...(league.schedule ?? []).map((m: any) => m.matchupPeriodId ?? 0));

  const daySps: number[] = [];
  for (let mp = 1; mp <= current; mp++) {
    for (const sp of matchupPeriodScoringPeriods(settings, proSched.day1, mp)) {
      if (opts.wantDay(mp, spToDate(proSched.day1, sp), current)) daySps.push(sp);
    }
  }
  const futurePeriods: { mp: number; sp: number }[] = [];
  for (let mp = current + 1; mp <= lastPeriod; mp++) {
    const sp = matchupPeriodScoringPeriods(settings, proSched.day1, mp)[0];
    if (sp != null) futurePeriods.push({ mp, sp });
  }
  total = 2 + daySps.length + futurePeriods.length + 1;
  const rosterAt = (sp: number) => () => get(leaguePath(cfg, ['mRoster'], `&scoringPeriodId=${sp}`));
  const fetched = await pool([...daySps.map(rosterAt), ...futurePeriods.map((f) => rosterAt(f.sp))], opts.concurrency ?? 1, tick);
  const days: RawData['days'] = {};
  daySps.forEach((sp, i) => (days[sp] = fetched[i]));
  const planned: RawData['planned'] = {};
  futurePeriods.forEach((f, i) => (planned[f.mp] = fetched[daySps.length + i]));

  const ids = new Set<number>(opts.extraPlayerIds ?? []);
  for (const day of [league, ...fetched]) for (const t of day.teams ?? []) for (const e of t.roster?.entries ?? []) ids.add(e.playerId);
  const idList = [...ids];
  const chunks: number[][] = [];
  for (let i = 0; i < idList.length; i += 150) chunks.push(idList.slice(i, i + 150));
  total += chunks.length;
  const results = await pool(
    [
      ...chunks.map((c) => () => get(leaguePath(cfg, ['kona_playercard']), playerFilterHeader(c, cfg.season))),
      () => get(leaguePath(cfg, ['kona_player_info']), freeAgentFilterHeader(150, cfg.season)),
    ],
    opts.concurrency ?? 1,
    tick,
  );
  const freeAgents = results.pop();
  return {
    league,
    pro,
    days,
    planned,
    players: { players: results.flatMap((r) => r.players ?? []) },
    freeAgents: { players: freeAgents?.players ?? [] },
    todayET: opts.todayET,
  };
}

// ---------- Live games (today) ----------

/** Today's NBA games from ESPN's public scoreboard: state and share of the game still to play. */
export async function fetchLiveDay(getJson: (url: string) => Promise<any>, date: string): Promise<LiveDay> {
  const sb = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, '')}`);
  const byProTeam: LiveDay['byProTeam'] = {};
  for (const ev of sb.events ?? []) {
    const comp = ev.competitions?.[0];
    const st = comp?.status;
    const state: 'pre' | 'in' | 'post' = st?.type?.state === 'in' ? 'in' : st?.type?.state === 'post' ? 'post' : 'pre';
    const left = state === 'post' ? 0 : state === 'pre' ? 1 : gameLeft(st?.period ?? 1, st?.displayClock ?? '12:00');
    for (const c of comp?.competitors ?? []) byProTeam[Number(c.team?.id)] = { state, left };
  }
  return { date, byProTeam };
}

/** Share of a 48-minute game left, from the period and clock ("7:42" or "38.2"). Overtime counts as nearly done. */
export function gameLeft(period: number, clock: string): number {
  const [a, b] = clock.split(':');
  const minutes = b === undefined ? Number(a) / 60 : Number(a) + Number(b) / 60;
  if (!Number.isFinite(minutes)) return 0.5;
  if (period > 4) return Math.min(0.1, minutes / 48);
  return Math.max(0, Math.min(1, ((4 - period) * 12 + minutes) / 48));
}

// ---------- Build ----------

export interface Built {
  settings: LeagueSettings;
  pro: ProSchedule;
  weeks: Week[];
  teams: Team[];
  /** Players with the internal proTeamId removed. */
  players: Player[];
  freeAgents: Player[];
  schedule: Schedule;
  warnings: BuildWarning[];
  lastPeriod: number;
}

export interface BuildOptions {
  /** Periods to (re)build. Default: all scheduled periods. */
  periods?: (current: number, last: number) => number[];
  trials?: (mp: number, current: number) => number;
  live?: LiveDay;
}

const strip = (players: (Player & { proTeamId?: number })[]): Player[] => players.map(({ proTeamId, ...p }) => p);

export function buildFromRaw(raw: RawData, cfg: LeagueConfig, opts: BuildOptions = {}): Built {
  const settings = parseSettings(raw.league);
  const pro = parseProSchedule(raw.pro);
  const abbrev = Object.fromEntries(Object.entries(pro.teams).map(([id, t]) => [id, t.abbrev]));
  const players = parsePlayers(raw.players, cfg.season, abbrev);
  const dayRosters: DayRosters = {};
  for (const [sp, day] of Object.entries(raw.days)) dayRosters[Number(sp)] = parseDayRoster(day, Number(sp));
  const plannedRosters: NonNullable<BuildInputs['plannedRosters']> = {};
  for (const [mp, day] of Object.entries(raw.planned)) plannedRosters[Number(mp)] = parseDayRoster(day, -1);

  const inp: BuildInputs = {
    settings,
    pro,
    teams: parseTeams(raw.league, cfg.managerNames),
    matchups: parseMatchups(raw.league),
    players: new Map(players.map((p) => [p.playerId, p])),
    dayRosters,
    plannedRosters,
    todayET: raw.todayET,
    live: opts.live,
  };
  const current = settings.currentMatchupPeriod;
  const lastPeriod = Math.max(current, ...inp.matchups.filter((m) => m.awayId != null).map((m) => m.matchupPeriod));
  const periods = opts.periods?.(current, lastPeriod) ?? Array.from({ length: lastPeriod }, (_, i) => i + 1);
  const warnings: BuildWarning[] = [];
  const weeks = periods.map((mp) => buildWeek({ ...inp, trials: opts.trials?.(mp, current) ?? MODEL.trials }, mp, warnings));

  const rostered = new Set(inp.teams.flatMap((t) => t.roster.map((r) => r.playerId)));
  const freeAgents = parsePlayers(raw.freeAgents, cfg.season, abbrev)
    .filter((p) => !rostered.has(p.playerId) && p.proTeam !== 'FA')
    .sort((a, b) => modelFpg(b) - modelFpg(a));

  return {
    settings,
    pro,
    weeks,
    teams: buildTeams(inp, current),
    players: strip(players),
    freeAgents: strip(freeAgents),
    schedule: buildSchedule(inp),
    warnings,
    lastPeriod,
  };
}
