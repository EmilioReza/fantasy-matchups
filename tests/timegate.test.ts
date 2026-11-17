import { describe, expect, it } from 'vitest';
import { decideRun, type GateState } from '../src/lib/timegate.ts';
import { addDays, zonedParts } from '../src/lib/dates.ts';

const CRONS = [6, 7, 10, 11]; // UTC hours

function simulate(startDate: string, days: number) {
  const state: GateState = { lastRunChicagoDate: null, lastSettleChicagoDate: null };
  const runs: { kind: string; date: string; hour: number }[] = [];
  for (let d = 0; d < days; d++) {
    const day = addDays(startDate, d);
    for (const h of CRONS) {
      // Start up to 40 minutes late, as GitHub often does.
      const now = new Date(`${day}T${String(h).padStart(2, '0')}:${d % 2 ? '40' : '00'}:00Z`);
      const r = decideRun(now, state, false);
      if (r.kind === 'run1') state.lastRunChicagoDate = r.chicagoDate;
      if (r.kind === 'run5') state.lastSettleChicagoDate = r.chicagoDate;
      if (r.kind !== 'skip') runs.push({ kind: r.kind, date: r.chicagoDate, hour: r.hour });
      if (zonedParts(now, 'America/Chicago').hour === 0) expect(r.kind).toBe('skip');
    }
  }
  return runs;
}

describe('time gate', () => {
  for (const [label, start] of [['January (CST)', '2027-01-05'], ['July (CDT)', '2027-07-05'], ['March DST switch', '2027-03-10'], ['November DST switch', '2026-10-30']]) {
    it(`exactly one 1 AM and one 5 AM run per Chicago date in ${label}`, () => {
      const runs = simulate(start, 8);
      const dates = [...new Set(runs.map((r) => r.date))];
      for (const date of dates.slice(1, -1)) {
        const r1 = runs.filter((r) => r.date === date && r.kind === 'run1');
        const r5 = runs.filter((r) => r.date === date && r.kind === 'run5');
        expect(r1).toHaveLength(1);
        expect(r5).toHaveLength(1);
        expect(r1[0].hour).toBe(1);
        expect(r5[0].hour).toBe(5);
      }
    });
  }
  it('manual dispatch always runs', () => {
    const now = new Date('2027-01-05T06:00:00Z'); // midnight CST
    expect(decideRun(now, { lastRunChicagoDate: '2027-01-05', lastSettleChicagoDate: '2027-01-05' }, true).kind).toBe('manual');
  });
});
