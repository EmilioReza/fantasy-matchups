// All projection and win-probability math. Imported by both the nightly job and the browser,
// so the site's live what-if numbers match the published ones exactly.
import modelConfig from '../../config/model.json';
import type { LineupRow, RemainingGame } from './types.ts';

export type ModelConfig = typeof modelConfig;
export const MODEL: ModelConfig = modelConfig;

// ---------- Scoring ----------

/** Fantasy points from a raw stat map (statId → value) using the league's scoringItems. */
export function pointsFromStats(stats: Record<string, number>, scoring: Record<string, number>): number {
  let total = 0;
  for (const [statId, pts] of Object.entries(scoring)) total += (stats[statId] ?? 0) * pts;
  return round1(total);
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ---------- Inputs ----------

/** Per-game play probability from ESPN injury status. Dates are YYYY-MM-DD strings. */
export function playProbability(
  injuryStatus: string | null | undefined,
  returnDate: string | null,
  gameDate: string,
  cfg: ModelConfig = MODEL,
): number {
  const pp = cfg.playProbability;
  switch (injuryStatus) {
    case 'DAY_TO_DAY':
    case 'QUESTIONABLE':
      return pp.dayToDay;
    case 'OUT':
    case 'INJURY_RESERVE':
    case 'SUSPENSION':
      if (!returnDate) return pp.outNoReturn;
      return gameDate >= returnDate ? pp.outAfterReturn : pp.outBeforeReturn;
    default:
      return pp.active;
  }
}

/** Season FP/G, blended 50/50 with ESPN's projection when fewer than 5 games played. */
export function chooseFpg(
  season: number | null,
  projected: number | null,
  gamesPlayed: number,
  cfg: ModelConfig = MODEL,
): number {
  if (season == null || gamesPlayed === 0) return round1(projected ?? season ?? 0);
  if (gamesPlayed < cfg.minGamesForSeasonAvg && projected != null) return round1((season + projected) / 2);
  return round1(season);
}

/** Sample standard deviation of single-game scores, or null with too few games. */
export function gameSd(scores: number[], cfg: ModelConfig = MODEL): number | null {
  if (scores.length < cfg.minGamesForSd) return null;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const v = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1);
  return round1(Math.sqrt(v));
}

export function effectiveSd(sd: number | null, fpg: number, cfg: ModelConfig = MODEL): number {
  return sd ?? cfg.sdFallbackFraction * fpg;
}

// ---------- Simulation inputs (shared by job + browser what-ifs) ----------

export interface SimGame {
  p: number;
  /** Points the viewer typed for this day; replaces the random draw. */
  fixed: number | null;
}

export interface SimPlayer {
  starter: boolean;
  fpg: number;
  sd: number;
  actual: number;
  remaining: SimGame[];
}

/** What a viewer may override on one player row. */
export interface RowOverride {
  starter?: boolean;
  fpg?: number;
  gamesLeft?: number;
  days?: Record<string, number>;
}

export function toSimPlayer(row: LineupRow, ov: RowOverride | undefined, fpgBase?: number, cfg: ModelConfig = MODEL): SimPlayer {
  const fpg = ov?.fpg ?? fpgBase ?? row.fpg;
  const days = ov?.days ?? {};
  let remaining: SimGame[] = row.remaining.map((g: RemainingGame) => ({
    p: g.p,
    fixed: days[g.date] ?? null,
  }));
  if (ov?.gamesLeft != null) {
    const fixed = remaining.filter((g) => g.fixed != null);
    const free = remaining.filter((g) => g.fixed == null);
    const meanP = free.length ? free.reduce((a, g) => a + g.p, 0) / free.length : cfg.playProbability.active;
    const n = Math.max(0, Math.round(ov.gamesLeft) - fixed.length);
    remaining = [...fixed, ...Array.from({ length: n }, (_, i) => free[i] ?? { p: meanP, fixed: null })];
  }
  return {
    starter: ov?.starter ?? row.starter,
    fpg,
    sd: effectiveSd(row.sd, fpg, cfg),
    actual: row.actual,
    remaining,
  };
}

// ---------- Projection ----------

export function expectedRemaining(pl: SimPlayer): number {
  if (!pl.starter) return 0;
  return pl.remaining.reduce((a, g) => a + (g.fixed ?? g.p * pl.fpg), 0);
}

/** Proj = Actual + Σ starters Σ games left p·FPG. Actual always counts (it is official). */
export function projectTeam(players: SimPlayer[]): { actual: number; projected: number; gamesLeft: number } {
  let actual = 0;
  let exp = 0;
  let gamesLeft = 0;
  for (const pl of players) {
    actual += pl.actual;
    exp += expectedRemaining(pl);
    if (pl.starter) gamesLeft += pl.remaining.filter((g) => g.fixed != null || g.p > 0).length;
  }
  return { actual: round1(actual), projected: round1(actual + exp), gamesLeft };
}

// ---------- Win probability (Monte Carlo) ----------

/** mulberry32: small, fast, seedable PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function simTotal(players: SimPlayer[], rand: () => number): number {
  let total = 0;
  for (const pl of players) {
    total += pl.actual;
    if (!pl.starter) continue;
    for (const g of pl.remaining) {
      if (g.fixed != null) total += g.fixed;
      else if (rand() < g.p) total += pl.fpg + pl.sd * normal(rand);
    }
  }
  return total;
}

/** Share of trials each side wins; ties split evenly. Deterministic for a given seed. */
export function winProbability(
  home: SimPlayer[],
  away: SimPlayer[],
  trials: number = MODEL.trials,
  seed: number = MODEL.seed,
): { home: number; away: number } {
  const rand = rng(seed);
  let h = 0;
  for (let i = 0; i < trials; i++) {
    const a = simTotal(home, rand);
    const b = simTotal(away, rand);
    if (Math.abs(a - b) < 0.05) h += 0.5;
    else if (a > b) h += 1;
  }
  const ph = Math.round((h / trials) * 1000) / 1000;
  return { home: ph, away: Math.round((1 - ph) * 1000) / 1000 };
}

export function matchupSeed(matchupId: number, cfg: ModelConfig = MODEL): number {
  return (cfg.seed + matchupId * 7919) >>> 0;
}
