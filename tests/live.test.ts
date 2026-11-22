import { describe, expect, it } from 'vitest';
import { buildWeek } from '../src/lib/build.ts';
import { gameLeft } from '../src/lib/pipeline.ts';
import { expectedRemaining, toSimPlayer } from '../src/lib/model.ts';
import { fixtureInputs } from './helpers.ts';

describe('live games', () => {
  it('share of the game left from period and clock', () => {
    expect(gameLeft(1, '12:00')).toBe(1);
    expect(gameLeft(2, '0.0')).toBe(0.5);
    expect(gameLeft(3, '6:00')).toBeCloseTo(18 / 48);
    expect(gameLeft(4, '45.2')).toBeCloseTo(45.2 / 60 / 48);
    expect(gameLeft(5, '2:30')).toBeLessThanOrEqual(0.1);
  });

  it('counts points so far and projects only the rest of a game in progress', () => {
    // Nov 16 (sp 28) as "today", every game at halftime.
    const inp = fixtureInputs('2026-11-16');
    const byProTeam: Record<number, { state: 'in'; left: number }> = {};
    for (const id of Object.keys(inp.pro.teams)) byProTeam[Number(id)] = { state: 'in', left: 0.5 };
    const live = buildWeek({ ...inp, live: { date: '2026-11-16', byProTeam } }, 5);
    const plain = buildWeek(inp, 5);
    const rows = live.matchups.flatMap((m) => Object.values(m.lineups).flat());
    const playing = rows.filter((r) => r.dailyStatus['2026-11-16'] === 'live' && (r.daily['2026-11-16'] ?? 0) > 0);
    expect(playing.length).toBeGreaterThan(10);
    const r = playing.find((x) => x.starter)!;
    const g = r.remaining.find((x) => x.date === '2026-11-16')!;
    expect(g).toMatchObject({ p: 1, scale: 0.5 });
    expect(r.actual).toBeGreaterThan(0);
    // Half a game left: the day's expectation is half a game's FP/G.
    const sim = toSimPlayer({ ...r, remaining: [g] }, undefined);
    expect(expectedRemaining(sim)).toBeCloseTo(0.5 * r.fpg, 1);
    // Points so far count on top of the plain projection's actual (which has no Nov 16 points yet).
    const sum = (w: typeof live) => w.matchups.reduce((a, m) => a + m.home.actual + m.away.actual, 0);
    expect(sum(live)).toBeGreaterThan(sum(plain));
    expect(live.finalDates).not.toContain('2026-11-16');
  });
});
