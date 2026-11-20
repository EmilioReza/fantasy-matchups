import { describe, expect, it } from 'vitest';
import { chooseFpg, effectiveSd, playProbability, projectTeam, toSimPlayer, weekPoints, winProbability, type SimPlayer } from '../src/lib/model.ts';
import type { LineupRow } from '../src/lib/types.ts';

const games = (n: number, p = 1) => Array.from({ length: n }, () => ({ p, fixed: null }));
const player = (fpg: number, n: number, opts: Partial<SimPlayer> = {}): SimPlayer => ({
  starter: true, fpg, sd: 0.35 * fpg, actual: 0, remaining: games(n), ...opts,
});

describe('inputs', () => {
  it('play probability by status', () => {
    expect(playProbability('ACTIVE', null, '2026-11-18')).toBe(0.95);
    expect(playProbability('DAY_TO_DAY', '2026-11-18', '2026-11-18')).toBe(0.7);
    expect(playProbability('OUT', '2026-11-20', '2026-11-19')).toBe(0);
    expect(playProbability('OUT', '2026-11-20', '2026-11-20')).toBe(0.95);
    expect(playProbability('OUT', null, '2026-11-20')).toBe(0);
  });
  it('blends the season average with the prior, weighted like 8 games', () => {
    expect(chooseFpg(40, 30, 8)).toBe(35);
    expect(chooseFpg(40, 30, 24)).toBe(37.5);
    expect(chooseFpg(null, 30, 0)).toBe(30);
    expect(chooseFpg(40, null, 3)).toBe(40);
  });
  it('spread follows FP/G edits', () => {
    expect(effectiveSd(12, 40, undefined, 30)).toBe(16);
    expect(effectiveSd(null, 40)).toBeCloseTo(0.47 * 40);
  });
});

describe('projection', () => {
  it('hand-computed roster', () => {
    const team: SimPlayer[] = [
      player(40, 3, { actual: 50, remaining: [{ p: 0.95, fixed: null }, { p: 0.95, fixed: null }, { p: 0.7, fixed: null }] }),
      player(20, 2, { actual: 10, remaining: [{ p: 0.95, fixed: null }, { p: 0, fixed: null }] }),
      player(30, 4, { starter: false, actual: 0 }), // bench: no projection
      player(25, 2, { actual: 0, remaining: [{ p: 0.95, fixed: 31 }, { p: 0.95, fixed: null }] }),
    ];
    // 60 actual + 40*(0.95+0.95+0.7) + 20*0.95 + 31 + 25*0.95
    expect(projectTeam(team).projected).toBe(237.8); // 237.75 rounded to one decimal
    expect(projectTeam(team).actual).toBe(60);
    expect(projectTeam(team).gamesLeft).toBe(3 + 1 + 2);
  });
  it('gamesLeft override uses the mean play probability', () => {
    const row: LineupRow = {
      playerId: 1, slot: 'PG', starter: true, fpg: 30, sd: null, gamesThisPeriod: 3, daily: {}, dailyStatus: {},
      dailyStarter: {}, actual: 0, remaining: [{ date: '2026-11-18', p: 0.95 }],
    };
    const sp = toSimPlayer(row, { gamesLeft: 3 });
    expect(sp.remaining).toHaveLength(3);
    expect(projectTeam([sp]).projected).toBeCloseTo(3 * 0.95 * 30, 1);
  });
  it('starter swaps count the whole week, already-played days included (weekly lineups)', () => {
    const base = { slot: 'PG', fpg: 30, sd: null, gamesThisPeriod: 2, dailyStatus: {}, remaining: [] };
    const bench: LineupRow = { ...base, playerId: 1, starter: false, daily: { '2026-11-16': 41, '2026-11-17': 12, '2026-11-18': null }, dailyStarter: { '2026-11-16': false, '2026-11-17': false }, actual: 0 };
    const starter: LineupRow = { ...base, playerId: 2, starter: true, daily: { '2026-11-16': 20 }, dailyStarter: { '2026-11-16': true }, actual: 20 };
    expect(weekPoints(bench)).toBe(53);
    expect(toSimPlayer(bench, { starter: true }).actual).toBe(53);
    expect(toSimPlayer(bench, undefined).actual).toBe(0);
    expect(toSimPlayer(starter, { starter: false }).actual).toBe(0);
    expect(projectTeam([toSimPlayer(bench, { starter: true }), toSimPlayer(starter, { starter: false })]).actual).toBe(53);
  });
});

describe('win probability', () => {
  const lineup = () => Array.from({ length: 10 }, (_, i) => player(25 + i, 5));
  it('is deterministic for a seed', () => {
    expect(winProbability(lineup(), lineup(), 3000, 7)).toEqual(winProbability(lineup(), lineup(), 3000, 7));
  });
  it('equal teams are about 50%', () => {
    const r = winProbability(lineup(), lineup(), 10000, 42);
    expect(r.home).toBeGreaterThan(0.48);
    expect(r.home).toBeLessThan(0.52);
  });
  it('a 160-point projected lead with ~50 games left is 85–95%', () => {
    // 10 starters × 5 games each side; equal rosters plus a 160-point head start.
    const home = lineup();
    home[0] = { ...home[0], actual: 160 };
    const r = winProbability(home, lineup(), 10000, 42);
    expect(r.home).toBeGreaterThan(0.85);
    expect(r.home).toBeLessThan(0.95);
  });
  it('week-long form swings make the same lead less certain', () => {
    const home = lineup();
    home[0] = { ...home[0], actual: 160 };
    const without = winProbability(home, lineup(), 10000, 42, 0).home;
    const withForm = winProbability(home, lineup(), 10000, 42, 0.1).home;
    expect(withForm).toBeLessThan(without);
    expect(withForm).toBeGreaterThan(0.7);
  });
});
