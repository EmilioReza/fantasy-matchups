import { describe, expect, it } from 'vitest';
import { buildSchedule, buildTeams, buildWeek, type BuildWarning } from '../src/lib/build.ts';
import { fixtureInputs } from './helpers.ts';

describe('buildWeek on the period-5 fixture (today = Nov 17)', () => {
  const inp = fixtureInputs();
  const warnings: BuildWarning[] = [];
  const week = buildWeek(inp, 5, warnings);

  it('covers every matchup and the 7 days', () => {
    expect(week.matchups).toHaveLength(4);
    expect(week.dates).toHaveLength(7);
    expect(week.finalDates).toEqual(['2026-11-16']);
    expect(week.status).toBe('in_progress');
  });

  it('actual points match ESPN for Nov 16 with no warnings', () => {
    expect(warnings).toEqual([]);
    const m = week.matchups.find((x) => x.home.teamId === 1 || x.away.teamId === 1)!;
    const team1 = m.home.teamId === 1 ? m.home : m.away;
    const team7 = m.home.teamId === 7 ? m.home : m.away;
    expect(team1.actual).toBe(233);
    expect(team7.actual).toBe(402);
  });

  it('projected ≥ actual and win probs sum to 1', () => {
    for (const m of week.matchups) {
      expect(m.home.projected).toBeGreaterThanOrEqual(m.home.actual);
      expect(m.home.winProb + m.away.winProb).toBeCloseTo(1, 2);
    }
  });

  it('day cells use the right statuses', () => {
    const rows = Object.values(week.matchups[0].lineups).flat();
    for (const r of rows) {
      const st = r.dailyStatus['2026-11-16'];
      if (st === 'played') expect(r.daily['2026-11-16']).not.toBeNull();
      if (st === 'dnp') expect(r.daily['2026-11-16']).toBe(0);
      if (st === 'no_game') expect(r.daily['2026-11-16']).toBeNull();
      expect(['scheduled', 'no_game', 'not_rostered']).toContain(r.dailyStatus['2026-11-18']);
    }
  });

  it('keeps the week file small', () => {
    expect(JSON.stringify(week).length).toBeLessThan(300_000);
  });

  it('builds teams with results and a schedule', () => {
    const teams = buildTeams(inp, 5);
    expect(teams.find((t) => t.teamId === 1)!.results.filter((r) => r.result).length).toBe(4);
    const sched = buildSchedule(inp);
    expect(sched.periods.find((p) => p.matchupPeriod === 5)!.dates[0]).toBe('2026-11-16');
    expect(Object.keys(sched.proTeams)).toHaveLength(30);
  });
});

describe('future weeks use the lineup set on ESPN', () => {
  it('takes roster and slots from the planned lineup, not today', () => {
    const inp = fixtureInputs();
    const team = inp.teams[0];
    const [benched, ...rest] = team.roster;
    const newcomer = [...inp.players.keys()].find((id) => !inp.teams.some((t) => t.roster.some((r) => r.playerId === id)))!;
    // Planned: first player moved to the bench (12), a new player added in a starting slot (11).
    inp.plannedRosters = { 6: { [team.teamId]: [{ playerId: benched.playerId, slotId: 12 }, ...rest, { playerId: newcomer, slotId: 11 }] } };
    const wk = buildWeek(inp, 6);
    const rows = wk.matchups.flatMap((m) => m.lineups[team.teamId] ?? []);
    expect(wk.status).toBe('upcoming');
    expect(rows.find((r) => r.playerId === benched.playerId)?.starter).toBe(false);
    expect(rows.find((r) => r.playerId === newcomer)?.starter).toBe(true);
    // Other teams fall back to today's roster.
    const other = inp.teams[1];
    expect(wk.matchups.flatMap((m) => m.lineups[other.teamId] ?? []).length).toBe(other.roster.length);
  });
});
