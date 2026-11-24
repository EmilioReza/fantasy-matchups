// The model's track record: each day's win probabilities, saved by the nightly job and graded when
// the week is final. Pure; used by scripts/build-data.ts and scripts/backfill-predictions.ts.
import type { Prediction, Week } from './types.ts';

const key = (p: Pick<Prediction, 'date' | 'matchupId'>) => `${p.date}:${p.matchupId}`;

/**
 * Add today's predictions for a week that is being played. The first record of a day is kept: it is
 * the one made before that day's games (later runs could know about in-game injuries).
 */
export function recordPredictions(list: Prediction[], week: Week, todayET: string, model: number): Prediction[] {
  if (week.status === 'final' || !week.dates.includes(todayET)) return list;
  const have = new Set(list.map(key));
  const add: Prediction[] = week.matchups
    .filter((m) => !have.has(`${todayET}:${m.matchupId}`))
    .map((m) => ({
      period: week.matchupPeriod,
      date: todayET,
      matchupId: m.matchupId,
      homeId: m.home.teamId,
      awayId: m.away.teamId,
      pHome: m.home.winProb,
      source: 'live',
      model,
      homeWon: null,
    }));
  return sortPredictions([...list, ...add]);
}

/** Fill in results from final weeks. */
export function gradePredictions(list: Prediction[], weeks: Week[]): Prediction[] {
  const result = new Map<number, number>();
  for (const w of weeks) {
    if (w.status !== 'final') continue;
    for (const m of w.matchups) {
      if (m.winner) result.set(m.matchupId, m.winner === 'HOME' ? 1 : m.winner === 'AWAY' ? 0 : 0.5);
    }
  }
  return list.map((p) => ({ ...p, homeWon: result.get(p.matchupId) ?? p.homeWon }));
}

export function sortPredictions(list: Prediction[]): Prediction[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.matchupId - b.matchupId);
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  /** Average stated chance for the favourite. */
  said: number;
  /** Share of those the favourite won. */
  won: number;
}

/** Fold every graded prediction to the favourite's side and bucket by stated chance. */
export function calibration(list: Prediction[], edges = [0.5, 0.6, 0.7, 0.8, 0.9, 0.97, 1.0001]): CalibrationBin[] {
  const fav = list
    .filter((p) => p.homeWon != null)
    .map((p) => (p.pHome >= 0.5 ? { p: p.pHome, won: p.homeWon! } : { p: 1 - p.pHome, won: 1 - p.homeWon! }));
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const s = fav.filter((x) => x.p >= edges[i] && x.p < edges[i + 1]);
    if (!s.length) continue;
    bins.push({
      lo: edges[i],
      hi: Math.min(1, edges[i + 1]),
      n: s.length,
      said: s.reduce((a, x) => a + x.p, 0) / s.length,
      won: s.reduce((a, x) => a + x.won, 0) / s.length,
    });
  }
  return bins;
}

/** Brier score: mean squared error of the stated chance (0 perfect, 0.25 coin flip). */
export function brier(list: Prediction[]): number | null {
  const g = list.filter((p) => p.homeWon != null);
  return g.length ? g.reduce((a, p) => a + (p.pHome - p.homeWon!) ** 2, 0) / g.length : null;
}
