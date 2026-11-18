// Parsers for raw ESPN fantasy basketball responses. Pure functions; built and tested against fixtures/.
// Field names were confirmed against real responses; see docs/espn-api-notes.md.
import { addDays, dayOfWeek, zonedParts } from './dates.ts';
import { chooseFpg, gameSd, round1 } from './model.ts';
import type { Player } from './types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

// ESPN does not name lineup slots in settings; these ids are stable across fba leagues.
export const SLOT_NAMES: Record<number, string> = {
  0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F',
  9: 'PF/C', 10: 'F/C', 11: 'UTIL', 12: 'BE', 13: 'IR',
};
export const BENCH_SLOT = 12;
export const IR_SLOT = 13;
const POSITION_NAMES: Record<number, string> = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C' };

// ---------- Settings / status ----------

export interface LeagueSettings {
  name: string;
  scoring: Record<string, number>; // statId → points
  starterSlotIds: number[];
  lineupSlotCounts: Record<string, number>;
  lockType: string;
  /** matchup period → list of "weeks" (ESPN calls them matchup periods too; playoff rounds span 2). */
  matchupPeriodWeeks: Record<number, number[]>;
  currentMatchupPeriod: number;
  latestScoringPeriod: number;
  finalScoringPeriod: number;
}

export function parseSettings(league: Json): LeagueSettings {
  const s = league.settings;
  const scoring: Record<string, number> = {};
  for (const item of s.scoringSettings.scoringItems) scoring[String(item.statId)] = item.points;
  const counts: Record<string, number> = s.rosterSettings.lineupSlotCounts;
  const starterSlotIds = Object.entries(counts)
    .filter(([id, n]) => n > 0 && Number(id) !== BENCH_SLOT && Number(id) !== IR_SLOT)
    .map(([id]) => Number(id));
  const weeks: Record<number, number[]> = {};
  for (const [mp, list] of Object.entries(s.scheduleSettings.matchupPeriods as Record<string, number[]>)) {
    weeks[Number(mp)] = list;
  }
  return {
    name: s.name,
    scoring,
    starterSlotIds,
    lineupSlotCounts: counts,
    lockType: s.rosterSettings.lineupLocktimeType ?? 'UNKNOWN',
    matchupPeriodWeeks: weeks,
    currentMatchupPeriod: league.status.currentMatchupPeriod,
    latestScoringPeriod: league.status.latestScoringPeriod,
    finalScoringPeriod: league.status.finalScoringPeriod,
  };
}

// ---------- Pro schedule / calendar ----------

export interface ProSchedule {
  day1: string; // date of scoring period 1 (ET)
  teams: Record<number, { abbrev: string; gamesBySp: Record<number, string> }>;
}

export function etDate(epochMs: number): string {
  return zonedParts(new Date(epochMs), 'America/New_York').date;
}

export function parseProSchedule(pro: Json): ProSchedule {
  const teams: ProSchedule['teams'] = {};
  let day1: string | null = null;
  for (const t of pro.settings.proTeams) {
    const gamesBySp: Record<number, string> = {};
    for (const [sp, games] of Object.entries(t.proGamesByScoringPeriod ?? {}) as [string, Json[]][]) {
      for (const g of games) {
        const d = etDate(g.date);
        gamesBySp[Number(sp)] = d;
        const cand = addDays(d, 1 - Number(sp));
        if (day1 == null || cand < day1) day1 = cand;
      }
    }
    teams[t.id] = { abbrev: t.abbrev, gamesBySp };
  }
  if (!day1) throw new Error('pro schedule has no games');
  return { day1, teams };
}

export const spToDate = (day1: string, sp: number) => addDays(day1, sp - 1);
export const dateToSp = (day1: string, date: string) =>
  Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(day1 + 'T00:00:00Z')) / 86_400_000) + 1;

/**
 * Scoring periods (days) in each ESPN "week". Week 1 runs from day 1 through the first Sunday;
 * later weeks run Monday–Sunday. Verified against pointsByScoringPeriod keys for weeks 1–4.
 */
export function weekScoringPeriods(day1: string, week: number): number[] {
  let firstSunday = 1;
  while (dayOfWeek(spToDate(day1, firstSunday)) !== 0) firstSunday++;
  if (week === 1) return range(1, firstSunday);
  const start = firstSunday + 1 + (week - 2) * 7;
  return range(start, start + 6);
}

export function matchupPeriodScoringPeriods(settings: LeagueSettings, day1: string, mp: number): number[] {
  const weeks = settings.matchupPeriodWeeks[mp] ?? [mp];
  return weeks.flatMap((w) => weekScoringPeriods(day1, w));
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

// ---------- Teams and head-to-head schedule ----------

export interface ParsedTeam {
  teamId: number;
  name: string;
  abbrev: string;
  owner: string;
  logo: string | null;
  record: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number };
  roster: { playerId: number; slotId: number }[];
}

/** owner is the manager's first name (or a configured override), falling back to the ESPN display name. */
export function parseTeams(league: Json, managerNames: Record<string, string> = {}): ParsedTeam[] {
  const members = new Map<string, string>(
    (league.members ?? []).map((m: Json) => [m.id, (m.firstName ?? '').trim() || m.displayName]),
  );
  return league.teams.map((t: Json) => {
    const o = t.record?.overall ?? {};
    return {
      teamId: t.id,
      name: t.name ?? `${t.location ?? ''} ${t.nickname ?? ''}`.trim(),
      abbrev: t.abbrev,
      owner: managerNames[String(t.id)] ?? members.get(t.primaryOwner) ?? '',
      logo: t.logo ?? null,
      record: {
        wins: o.wins ?? 0,
        losses: o.losses ?? 0,
        ties: o.ties ?? 0,
        pointsFor: round1(o.pointsFor ?? 0),
        pointsAgainst: round1(o.pointsAgainst ?? 0),
      },
      roster: (t.roster?.entries ?? []).map((e: Json) => ({ playerId: e.playerId, slotId: e.lineupSlotId })),
    };
  });
}

export interface ParsedMatchup {
  matchupId: number;
  matchupPeriod: number;
  homeId: number;
  awayId: number | null; // null = bye
  homePoints: Record<number, number>;
  awayPoints: Record<number, number>;
  homeTotal: number;
  awayTotal: number;
  winner: 'HOME' | 'AWAY' | 'TIE' | null;
}

export function parseMatchups(league: Json): ParsedMatchup[] {
  const pts = (side: Json) =>
    Object.fromEntries(Object.entries(side?.pointsByScoringPeriod ?? {}).map(([k, v]) => [Number(k), v as number]));
  return league.schedule.map((m: Json) => ({
    matchupId: m.id,
    matchupPeriod: m.matchupPeriodId,
    homeId: m.home.teamId,
    awayId: m.away?.teamId ?? null,
    homePoints: pts(m.home),
    awayPoints: pts(m.away),
    homeTotal: round1(m.home.totalPoints ?? 0),
    awayTotal: round1(m.away?.totalPoints ?? 0),
    winner: m.winner === 'HOME' || m.winner === 'AWAY' || m.winner === 'TIE' ? m.winner : null,
  }));
}

// ---------- Per-day rosters ----------

export interface DayEntry {
  playerId: number;
  slotId: number;
  /** ESPN appliedTotal for that day's game, or null when the player did not play. */
  points: number | null;
  /** Raw stats for that day (for the scoringItems cross-check). */
  stats: Record<string, number> | null;
  appliedTotal: number | null;
}

/** mRoster with scoringPeriodId=sp → teamId → entries, with that day's single-game stats. */
export function parseDayRoster(day: Json, sp: number): Record<number, DayEntry[]> {
  const out: Record<number, DayEntry[]> = {};
  for (const t of day.teams) {
    out[t.id] = (t.roster?.entries ?? []).map((e: Json) => {
      const stats: Json[] = e.playerPoolEntry?.player?.stats ?? [];
      const game = stats.find((s) => s.statSplitTypeId === 5 && s.statSourceId === 0 && s.scoringPeriodId === sp);
      const played = game != null && (game.stats?.['42'] ?? 0) >= 1;
      return {
        playerId: e.playerId,
        slotId: e.lineupSlotId,
        points: played ? round1(game.appliedTotal ?? 0) : null,
        stats: played ? game.stats : null,
        appliedTotal: played ? game.appliedTotal : null,
      };
    });
  }
  return out;
}

// ---------- Players ----------

function findStat(stats: Json[], season: number, split: number, source: number): Json | undefined {
  return stats.find(
    (s) => s.seasonId === season && s.statSplitTypeId === split && s.statSourceId === source && s.scoringPeriodId === 0,
  );
}

export function parsePlayers(kona: Json, season: number, abbrevByProId: Record<number, string>): Player[] {
  return kona.players.map((pe: Json) => {
    const p = pe.player;
    const stats: Json[] = p.stats ?? [];
    const seasonStat = findStat(stats, season, 0, 0);
    const last15 = findStat(stats, season, 2, 0);
    const proj = findStat(stats, season, 0, 1);
    const gp = seasonStat?.stats?.['42'] ?? 0;
    const games = stats
      .filter((s) => s.seasonId === season && s.statSplitTypeId === 5 && s.statSourceId === 0 && (s.stats?.['42'] ?? 0) >= 1)
      .map((s) => s.appliedTotal as number);
    const rd = p.injuryDetails?.expectedReturnDate as number[] | undefined;
    const returnDate = rd && rd.length === 3 ? `${rd[0]}-${String(rd[1]).padStart(2, '0')}-${String(rd[2]).padStart(2, '0')}` : null;
    const positions = (p.eligibleSlots as number[]).filter((s) => s in POSITION_NAMES).map((s) => POSITION_NAMES[s]);
    return {
      playerId: p.id,
      name: p.fullName,
      proTeam: abbrevByProId[p.proTeamId] ?? 'FA',
      positions,
      injuryStatus: p.injuryStatus ?? 'ACTIVE',
      returnDate: p.injuryStatus === 'ACTIVE' ? null : returnDate,
      fpgSeason: seasonStat?.appliedAverage != null ? round1(seasonStat.appliedAverage) : null,
      fpgLast15: last15?.appliedAverage != null ? round1(last15.appliedAverage) : null,
      fpgProjected: proj?.appliedAverage != null ? round1(proj.appliedAverage) : null,
      sdGame: gameSd(games),
      gamesPlayed: gp,
      proTeamId: p.proTeamId,
    } as Player & { proTeamId: number };
  });
}

export function modelFpg(p: Player): number {
  return chooseFpg(p.fpgSeason, p.fpgProjected, p.gamesPlayed);
}
