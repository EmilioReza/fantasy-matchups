// Decides whether a scheduled run should do work, so runs land at 1 AM and 5 AM Chicago time
// across daylight saving. GitHub cron fires at both candidate UTC times; this filters them.
import { zonedParts } from './dates.ts';

export type RunKind = 'run1' | 'run5' | 'manual' | 'skip';

export interface GateState {
  lastRunChicagoDate: string | null;
  lastSettleChicagoDate: string | null;
}

export function decideRun(
  now: Date,
  state: GateState,
  manual: boolean,
  timeZone = 'America/Chicago',
): { kind: RunKind; chicagoDate: string; hour: number } {
  const { date, hour } = zonedParts(now, timeZone);
  if (manual) return { kind: 'manual', chicagoDate: date, hour };
  if (hour >= 1 && hour <= 4) {
    return { kind: state.lastRunChicagoDate === date ? 'skip' : 'run1', chicagoDate: date, hour };
  }
  if (hour >= 5) {
    return { kind: state.lastSettleChicagoDate === date ? 'skip' : 'run5', chicagoDate: date, hour };
  }
  return { kind: 'skip', chicagoDate: date, hour };
}
