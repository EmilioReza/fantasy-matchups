import { describe, expect, it } from 'vitest';
import { brier, calibration, gradePredictions, recordPredictions } from '../src/lib/predictions.ts';
import type { Prediction, Week } from '../src/lib/types.ts';

const side = (teamId: number, winProb: number) => ({ teamId, actual: 0, projected: 0, gamesLeft: 0, winProb });
const week = (status: Week['status'], pHome: number, winner: 'HOME' | 'AWAY' | null = null): Week => ({
  matchupPeriod: 6, dates: ['2026-11-23', '2026-11-24'], finalDates: [], status,
  matchups: [{ matchupId: 21, winner, home: side(1, pHome), away: side(2, 1 - pHome), lineups: {} }],
});

describe('track record', () => {
  it("keeps the first prediction of each day and skips days outside the week", () => {
    let list = recordPredictions([], week('in_progress', 0.6), '2026-11-23', 2);
    list = recordPredictions(list, week('in_progress', 0.9), '2026-11-23', 2); // later run same day
    expect(list).toHaveLength(1);
    expect(list[0].pHome).toBe(0.6);
    expect(recordPredictions(list, week('in_progress', 0.7), '2026-11-30', 2)).toHaveLength(1);
    expect(recordPredictions([], week('final', 0.7), '2026-11-24', 2)).toHaveLength(0);
  });
  it('grades when the week is final and buckets from the favourite side', () => {
    let list = recordPredictions([], week('in_progress', 0.75), '2026-11-23', 2);
    list = recordPredictions(list, week('in_progress', 0.25), '2026-11-24', 2);
    list = gradePredictions(list, [week('final', 1, 'AWAY')]);
    expect(list.map((p) => p.homeWon)).toEqual([0, 0]);
    const bins = calibration(list);
    // 75% for home (lost) and 75% for away (won): one hit, one miss in the 70–80% bucket.
    expect(bins).toEqual([{ lo: 0.7, hi: 0.8, n: 2, said: 0.75, won: 0.5 }]);
    expect(brier(list)).toBeCloseTo((0.75 ** 2 + 0.25 ** 2) / 2);
  });
  it('ignores ungraded predictions', () => {
    const p: Prediction = { period: 6, date: '2026-11-23', matchupId: 21, homeId: 1, awayId: 2, pHome: 0.8, source: 'live', model: 2, homeWon: null };
    expect(calibration([p])).toEqual([]);
    expect(brier([p])).toBeNull();
  });
});
