import { beforeEach, describe, expect, it } from 'vitest';
import { clearOverrides, loadOverrides, overrideKey, saveOverrides, setDay, setField } from '../src/lib/overrides.ts';
import { projectTeam, toSimPlayer } from '../src/lib/model.ts';
import type { LineupRow } from '../src/lib/types.ts';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const row = (id: number, fpg: number, actual = 0): LineupRow => ({
  playerId: id, slot: 'PG', starter: true, fpg, sd: null, gamesThisPeriod: 2, daily: {}, dailyStatus: {},
  dailyStarter: {}, actual, remaining: [{ date: '2026-11-18', p: 1 }, { date: '2026-11-20', p: 1 }],
});

describe('overrides', () => {
  const key = overrideKey(2027, 5, 17);
  beforeEach(() => { (globalThis as any).localStorage = new MemStorage(); });

  it('an edit survives a reload', () => {
    saveOverrides(key, setField({}, 1, 'fpg', 50));
    expect(loadOverrides(key)).toEqual({ 1: { fpg: 50 } });
  });

  it('new nightly data updates untouched fields only', () => {
    let ov = setField({}, 1, 'fpg', 50);
    ov = setDay(ov, 1, '2026-11-20', 10);
    saveOverrides(key, ov);
    const loaded = loadOverrides(key);
    // Nightly data changes: player 1 actual went up, player 2 fpg changed.
    const nightly = [row(1, 30, 44), row(2, 25)];
    const sims = nightly.map((r) => toSimPlayer(r, loaded[r.playerId]));
    expect(sims[0].fpg).toBe(50); // edited
    expect(sims[0].actual).toBe(44); // untouched → new data
    expect(sims[1].fpg).toBe(25);
    expect(projectTeam(sims).projected).toBe(44 + 50 + 10 + 25 * 2);
  });

  it('reset clears every override for that matchup', () => {
    saveOverrides(key, setField(setField({}, 1, 'starter', false), 2, 'gamesLeft', 1));
    saveOverrides(overrideKey(2027, 5, 18), setField({}, 3, 'fpg', 1));
    clearOverrides(key);
    expect(loadOverrides(key)).toEqual({});
    expect(loadOverrides(overrideKey(2027, 5, 18))).toEqual({ 3: { fpg: 1 } });
  });

  it('works with storage blocked', () => {
    (globalThis as any).localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    saveOverrides(key, setField({}, 1, 'fpg', 12));
    expect(loadOverrides(key)).toEqual({ 1: { fpg: 12 } });
  });

  it('removing the last edit stores nothing', () => {
    saveOverrides(key, setField(setField({}, 1, 'fpg', 12), 1, 'fpg', undefined));
    expect((globalThis as any).localStorage.m.size).toBe(0);
  });
});
