export const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
export const fmt0 = (x: number) => Math.round(x).toLocaleString('en-US');
export const pct = (x: number) => `${Math.round(x * 100)}%`;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dayLabel(date: string): { wd: string; md: string } {
  const d = new Date(date + 'T12:00:00Z');
  return { wd: WD[d.getUTCDay()], md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` };
}

export function shortRange(dates: string[]): string {
  if (!dates.length) return '';
  const f = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(dates[0])} – ${f(dates[dates.length - 1])}`;
}

/** "Nov 17, 1:04 AM CT" */
export function asOf(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  return `${date}, ${time} CT`;
}

export const STATUS_CHIP: Record<string, string> = {
  OUT: 'OUT',
  DAY_TO_DAY: 'DTD',
  QUESTIONABLE: 'Q',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'SSPD',
};
