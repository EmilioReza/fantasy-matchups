import { describe, expect, it } from 'vitest';
import {
  matchupPeriodScoringPeriods, parseDayRoster, parseMatchups, parsePlayers, parseProSchedule,
  parseSettings, parseTeams, spToDate, weekScoringPeriods,
} from '../src/lib/espn.ts';
import { pointsFromStats } from '../src/lib/model.ts';
import { fixture } from './helpers.ts';

const league = fixture('league.json');
const settings = parseSettings(league);
const pro = parseProSchedule(fixture('pro-schedules.json'));

describe('settings', () => {
  it('reads scoring, slots, lock type and status', () => {
    expect(settings.scoring['0']).toBe(1); // PTS
    expect(settings.scoring['13']).toBe(2); // FGM
    expect(settings.scoring['14']).toBe(-1); // FGA
    expect(settings.scoring['11']).toBe(-2); // TO
    expect(settings.starterSlotIds.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 11]);
    expect(settings.lockType).toBe('INDIVIDUAL_FIRSTGAME_WEEKLY');
    expect(settings.currentMatchupPeriod).toBe(5);
  });
});

describe('calendar', () => {
  it('maps scoring period 1 to opening night and 28 to Nov 16', () => {
    expect(pro.day1).toBe('2026-10-20');
    expect(spToDate(pro.day1, 28)).toBe('2026-11-16');
  });
  it('week rule matches ESPN pointsByScoringPeriod keys for completed weeks', () => {
    const ms = parseMatchups(league);
    for (const mp of [1, 2, 3, 4]) {
      const m = ms.find((x) => x.matchupPeriod === mp)!;
      expect(Object.keys(m.homePoints).map(Number)).toEqual(weekScoringPeriods(pro.day1, mp));
    }
    expect(matchupPeriodScoringPeriods(settings, pro.day1, 5).map((sp) => spToDate(pro.day1, sp))).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
    ]);
  });
});

describe('teams and matchups', () => {
  it('parses every team with a roster', () => {
    const teams = parseTeams(league);
    expect(teams).toHaveLength(8);
    for (const t of teams) {
      expect(t.name).toBeTruthy();
      expect(t.roster.length).toBeGreaterThan(10);
    }
    expect(teams.find((t) => t.teamId === 1)!.name).toBe('Capture the Flagg');
  });
  it('has 4 matchups in period 5', () => {
    const m5 = parseMatchups(league).filter((m) => m.matchupPeriod === 5);
    expect(m5).toHaveLength(4);
    expect(m5.every((m) => m.winner === null)).toBe(true);
  });
});

describe('daily rosters', () => {
  const day = parseDayRoster(fixture('roster-sp28.json'), 28);
  it('starter sums equal ESPN team points for Nov 16', () => {
    const ms = parseMatchups(league).filter((m) => m.matchupPeriod === 5);
    for (const m of ms) {
      for (const [teamId, pts] of [[m.homeId, m.homePoints], [m.awayId!, m.awayPoints]] as const) {
        const sum = day[teamId]
          .filter((e) => settings.starterSlotIds.includes(e.slotId) && e.points != null)
          .reduce((a, e) => a + e.points!, 0);
        expect(sum).toBeCloseTo(pts[28], 1);
      }
    }
  });
  it('scoringItems recompute equals ESPN appliedTotal for every player-day', () => {
    let n = 0;
    for (const sp of [28, 29]) {
      const d = parseDayRoster(fixture(`roster-sp${sp}.json`), sp);
      for (const entries of Object.values(d)) {
        for (const e of entries) {
          if (!e.stats) continue;
          expect(pointsFromStats(e.stats, settings.scoring)).toBeCloseTo(e.appliedTotal!, 5);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(50);
  });
  it('known lines: Fears 42, Boozer 50 (Nov 16, 2026)', () => {
    const players = parsePlayers(fixture('players.json'), 2027, {});
    const byName = (n: string) => players.find((p) => p.name.includes(n))!.playerId;
    const all = Object.values(day).flat();
    expect(all.find((e) => e.playerId === byName('Fears'))!.points).toBe(42);
    expect(all.find((e) => e.playerId === byName('Boozer'))!.points).toBe(50);
    // And straight from the box-score lines, with this league's scoring:
    const fears = { 0: 19, 13: 6, 14: 13, 17: 1, 15: 6, 16: 7, 6: 10, 3: 10, 11: 3 };
    const boozer = { 0: 29, 13: 10, 14: 21, 17: 7, 15: 2, 16: 2, 6: 7, 3: 7, 1: 1, 11: 5 };
    expect(pointsFromStats(fears, settings.scoring)).toBe(42);
    expect(pointsFromStats(boozer, settings.scoring)).toBe(50);
  });
});

describe('players', () => {
  it('reads averages, injury and game SD', () => {
    const abbrev = Object.fromEntries(Object.entries(pro.teams).map(([id, t]) => [id, t.abbrev]));
    const players = parsePlayers(fixture('players.json'), 2027, abbrev);
    expect(players.length).toBeGreaterThan(100);
    const luka = players.find((p) => p.name === 'Luka Doncic')!;
    expect(luka.proTeam).toBe('LAL');
    expect(luka.fpgSeason).toBeGreaterThan(40);
    expect(luka.sdGame).not.toBeNull();
    const curry = players.find((p) => p.name === 'Stephen Curry')!;
    expect(curry.injuryStatus).toBe('OUT');
    expect(curry.returnDate).toBe('2026-12-12');
  });
});
