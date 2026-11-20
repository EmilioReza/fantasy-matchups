import { describe, expect, it } from 'vitest';
import { pickupRow } from '../src/lib/pickup.ts';
import { pruneOverrides, setField, setPickup } from '../src/lib/overrides.ts';
import { projectTeam, toSimPlayer } from '../src/lib/model.ts';
import type { Player } from '../src/lib/types.ts';

const fa: Player = {
  playerId: 99, name: 'Free Agent', proTeam: 'BOS', positions: ['PG'], injuryStatus: 'ACTIVE', returnDate: null,
  fpgSeason: 30, fpgLast15: 28, fpgProjected: 30, sdGame: 9, fpgPrior: null, cvGame: 0.3, gamesPlayed: 12,
};
const week = { dates: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'], finalDates: ['2026-11-16', '2026-11-17'] };

describe('what-if pickups', () => {
  it('only counts the pro team games still to be played', () => {
    const row = pickupRow(fa, week, ['2026-11-16', '2026-11-18', '2026-11-19']);
    expect(row.remaining.map((g) => g.date)).toEqual(['2026-11-18', '2026-11-19']);
    expect(row.dailyStatus['2026-11-16']).toBe('not_rostered');
    expect(row.starter).toBe(true);
    expect(row.actual).toBe(0);
    expect(projectTeam([toSimPlayer(row, undefined)]).projected).toBeCloseTo(2 * 0.95 * 30, 1);
  });
  it('whole future week counts for an upcoming week', () => {
    const row = pickupRow(fa, { dates: week.dates, finalDates: [] }, week.dates);
    expect(row.remaining).toHaveLength(4);
  });
  it('pickup survives pruning and edits, and removes cleanly', () => {
    let ov = setPickup({}, 99, 1);
    ov = setField(ov, 99, 'starter', false);
    expect(pruneOverrides(ov)).toEqual({ 99: { addTo: 1, starter: false } });
    expect(setPickup(ov, 99, null)).toEqual({});
  });
});
