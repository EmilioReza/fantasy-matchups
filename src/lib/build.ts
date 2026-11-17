// Turns parsed ESPN data into the published week/team/schedule files. Pure; used by scripts/build-data.ts.
import {
  BENCH_SLOT,
  IR_SLOT,
  SLOT_NAMES,
  dateToSp,
  matchupPeriodScoringPeriods,
  modelFpg,
  spToDate,
  type DayEntry,
  type LeagueSettings,
  type ParsedMatchup,
  type ParsedTeam,
  type ProSchedule,
} from './espn.ts';
import { MODEL, matchupSeed, playProbability, projectTeam, round1, toSimPlayer, winProbability, type ModelConfig } from './model.ts';
import type { DayStatus, LineupRow, Matchup, Player, Schedule, Team, Week, WeekStatus } from './types.ts';

export type DayRosters = Record<number, Record<number, DayEntry[]>>; // sp → teamId → entries

export interface BuildInputs {
  settings: LeagueSettings;
  pro: ProSchedule;
  teams: ParsedTeam[];
  matchups: ParsedMatchup[];
  players: Map<number, Player & { proTeamId?: number }>;
  dayRosters: DayRosters;
  todayET: string;
  cfg?: ModelConfig;
  trials?: number;
}

export interface BuildWarning {
  matchupPeriod: number;
  teamId: number;
  date: string;
  ours: number;
  espn: number;
}

export function periodDates(inp: BuildInputs, mp: number): { sps: number[]; dates: string[] } {
  const sps = matchupPeriodScoringPeriods(inp.settings, inp.pro.day1, mp);
  // Trust ESPN's own scoring-period keys when they extend beyond our week rule.
  for (const m of inp.matchups) {
    if (m.matchupPeriod !== mp) continue;
    for (const k of Object.keys(m.homePoints).map(Number)) if (!sps.includes(k)) sps.push(k);
  }
  sps.sort((a, b) => a - b);
  return { sps, dates: sps.map((sp) => spToDate(inp.pro.day1, sp)) };
}

const slotOrder = (id: number) => (id === BENCH_SLOT ? 100 : id === IR_SLOT ? 200 : id);

function proTeamIdOf(p: (Player & { proTeamId?: number }) | undefined, pro: ProSchedule): number | null {
  if (!p) return null;
  if (p.proTeamId != null) return p.proTeamId;
  const hit = Object.entries(pro.teams).find(([, t]) => t.abbrev === p.proTeam);
  return hit ? Number(hit[0]) : null;
}

export function buildWeek(inp: BuildInputs, mp: number, warnings: BuildWarning[] = []): Week {
  const cfg = inp.cfg ?? MODEL;
  const { sps, dates } = periodDates(inp, mp);
  const finalSps = sps.filter((sp) => spToDate(inp.pro.day1, sp) < inp.todayET);
  for (const sp of finalSps) {
    if (!inp.dayRosters[sp]) throw new Error(`missing roster for scoring period ${sp} (${spToDate(inp.pro.day1, sp)})`);
  }
  const finalDates = finalSps.map((sp) => spToDate(inp.pro.day1, sp));
  const periodOver = finalSps.length === sps.length;
  const starterSlots = new Set(inp.settings.starterSlotIds);
  const current = new Map(inp.teams.map((t) => [t.teamId, new Map(t.roster.map((r) => [r.playerId, r.slotId]))]));

  const buildRows = (teamId: number): LineupRow[] => {
    const ids = new Set<number>();
    for (const sp of finalSps) for (const e of inp.dayRosters[sp][teamId] ?? []) ids.add(e.playerId);
    if (!periodOver) for (const id of current.get(teamId)?.keys() ?? []) ids.add(id);

    const rows: (LineupRow & { _order: number })[] = [];
    for (const pid of ids) {
      const info = inp.players.get(pid);
      const proId = proTeamIdOf(info, inp.pro);
      const games = proId != null ? inp.pro.teams[proId]?.gamesBySp ?? {} : {};
      const nowSlot = periodOver ? undefined : current.get(teamId)?.get(pid);
      let lastSlot = nowSlot;
      const daily: LineupRow['daily'] = {};
      const dailyStatus: LineupRow['dailyStatus'] = {};
      const dailyStarter: LineupRow['dailyStarter'] = {};
      const remaining: LineupRow['remaining'] = [];
      let actual = 0;
      let gamesThisPeriod = 0;
      for (const sp of sps) {
        const date = spToDate(inp.pro.day1, sp);
        const hasGame = games[sp] != null;
        if (finalSps.includes(sp)) {
          const e = inp.dayRosters[sp][teamId]?.find((x) => x.playerId === pid);
          let st: DayStatus;
          if (!e) {
            st = 'not_rostered';
            daily[date] = null;
          } else {
            lastSlot ??= e.slotId;
            if (e.points != null) {
              st = 'played';
              daily[date] = e.points;
            } else if (hasGame) {
              st = 'dnp';
              daily[date] = 0;
            } else {
              st = 'no_game';
              daily[date] = null;
            }
            if (st === 'played' || st === 'dnp') gamesThisPeriod++;
            const starting = starterSlots.has(e.slotId);
            dailyStarter[date] = starting;
            if (starting && e.points != null) actual += e.points;
          }
          dailyStatus[date] = st;
        } else {
          daily[date] = null;
          if (nowSlot === undefined) dailyStatus[date] = 'not_rostered';
          else if (hasGame) {
            dailyStatus[date] = 'scheduled';
            gamesThisPeriod++;
            const p = playProbability(info?.injuryStatus, info?.returnDate ?? null, date, cfg);
            remaining.push({ date, p });
          } else dailyStatus[date] = 'no_game';
        }
      }
      const slotId = lastSlot ?? BENCH_SLOT;
      rows.push({
        playerId: pid,
        slot: SLOT_NAMES[slotId] ?? String(slotId),
        starter: nowSlot !== undefined && starterSlots.has(nowSlot),
        fpg: info ? modelFpg(info) : 0,
        sd: info?.sdGame ?? null,
        gamesThisPeriod,
        daily,
        dailyStatus,
        dailyStarter,
        actual: round1(actual),
        remaining,
        _order: (nowSlot === undefined && !periodOver ? 1000 : 0) + slotOrder(slotId),
      });
    }
    rows.sort((a, b) => a._order - b._order || b.fpg - a.fpg);
    return rows.map(({ _order, ...r }) => r);
  };

  const matchups: Matchup[] = [];
  for (const m of inp.matchups) {
    if (m.matchupPeriod !== mp || m.awayId == null) continue;
    const lineups: Record<string, LineupRow[]> = {};
    const sides = [m.homeId, m.awayId].map((teamId) => {
      const rows = buildRows(teamId);
      lineups[teamId] = rows;
      // Cross-check our starter sums with ESPN's per-day team points.
      const espnPts = teamId === m.homeId ? m.homePoints : m.awayPoints;
      for (const sp of finalSps) {
        const date = spToDate(inp.pro.day1, sp);
        const ours = round1(rows.reduce((a, r) => a + (r.dailyStarter[date] ? r.daily[date] ?? 0 : 0), 0));
        if (espnPts[sp] != null && Math.abs(ours - espnPts[sp]) > 0.1) {
          warnings.push({ matchupPeriod: mp, teamId, date, ours, espn: espnPts[sp] });
        }
      }
      return { teamId, sim: rows.map((r) => toSimPlayer(r, undefined, undefined, cfg)) };
    });
    const [h, a] = sides;
    const ph = projectTeam(h.sim);
    const pa = projectTeam(a.sim);
    let wp: { home: number; away: number };
    if (periodOver && m.winner) {
      wp = m.winner === 'HOME' ? { home: 1, away: 0 } : m.winner === 'AWAY' ? { home: 0, away: 1 } : { home: 0.5, away: 0.5 };
    } else {
      wp = winProbability(h.sim, a.sim, inp.trials ?? cfg.trials, matchupSeed(m.matchupId, cfg));
    }
    matchups.push({
      matchupId: m.matchupId,
      winner: periodOver ? m.winner : null,
      home: { teamId: h.teamId, actual: ph.actual, projected: ph.projected, gamesLeft: ph.gamesLeft, winProb: wp.home },
      away: { teamId: a.teamId, actual: pa.actual, projected: pa.projected, gamesLeft: pa.gamesLeft, winProb: wp.away },
      lineups,
    });
  }

  let status: WeekStatus;
  if (periodOver && matchups.every((m) => m.winner != null)) status = 'final';
  else if (dates[0] <= inp.todayET) status = 'in_progress';
  else status = 'upcoming';
  return { matchupPeriod: mp, dates, finalDates, status, matchups };
}

export function buildTeams(inp: BuildInputs, maxPeriod: number): Team[] {
  return inp.teams.map((t) => {
    const results = inp.matchups
      .filter((m) => m.matchupPeriod <= maxPeriod && m.awayId != null && (m.homeId === t.teamId || m.awayId === t.teamId))
      .sort((a, b) => a.matchupPeriod - b.matchupPeriod)
      .map((m) => {
        const home = m.homeId === t.teamId;
        const result: 'W' | 'L' | 'T' | null =
          m.winner == null ? null : m.winner === 'TIE' ? 'T' : (m.winner === 'HOME') === home ? 'W' : 'L';
        return {
          matchupPeriod: m.matchupPeriod,
          matchupId: m.matchupId,
          opponentId: (home ? m.awayId : m.homeId)!,
          pointsFor: home ? m.homeTotal : m.awayTotal,
          pointsAgainst: home ? m.awayTotal : m.homeTotal,
          result,
        };
      });
    return {
      teamId: t.teamId,
      name: t.name,
      abbrev: t.abbrev,
      owner: t.owner,
      logo: t.logo,
      record: t.record,
      roster: t.roster.map((r) => r.playerId),
      results,
    };
  });
}

export function buildSchedule(inp: BuildInputs): Schedule {
  const mps = Object.keys(inp.settings.matchupPeriodWeeks).map(Number).sort((a, b) => a - b);
  const proTeams: Schedule['proTeams'] = {};
  for (const [id, t] of Object.entries(inp.pro.teams)) {
    if (Number(id) === 0) continue;
    proTeams[t.abbrev] = { abbrev: t.abbrev, games: Object.values(t.gamesBySp).sort() };
  }
  return { periods: mps.map((mp) => ({ matchupPeriod: mp, dates: periodDates(inp, mp).dates })), proTeams };
}

export { dateToSp };
