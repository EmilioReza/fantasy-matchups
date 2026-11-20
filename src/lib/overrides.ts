// The browser's what-if layer. Stores only the fields a viewer changed, never a copy of the data,
// so new nightly numbers still flow into everything untouched. Works with storage blocked.
import type { RowOverride } from './model.ts';

export type MatchupOverrides = Record<string, RowOverride>; // playerId → override

const memory = new Map<string, string>(); // fallback when localStorage throws

function getStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__fmp_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function readKey(key: string): string | null {
  try {
    const s = getStore();
    if (s) return s.getItem(key);
  } catch {
    /* fall through */
  }
  return memory.get(key) ?? null;
}

export function writeKey(key: string, value: string | null): void {
  try {
    const s = getStore();
    if (s) {
      if (value == null) s.removeItem(key);
      else s.setItem(key, value);
      return;
    }
  } catch {
    /* fall through */
  }
  if (value == null) memory.delete(key);
  else memory.set(key, value);
}

export const overrideKey = (season: number, period: number, matchupId: number) =>
  `fmp:v1:${season}:${period}:${matchupId}`;

export function loadOverrides(key: string): MatchupOverrides {
  try {
    const raw = readKey(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOverrides(key: string, ov: MatchupOverrides): void {
  const clean = pruneOverrides(ov);
  writeKey(key, Object.keys(clean).length ? JSON.stringify(clean) : null);
}

export function clearOverrides(key: string): void {
  writeKey(key, null);
}

/** Drop empty rows/day maps so "has edits" is accurate. */
export function pruneOverrides(ov: MatchupOverrides): MatchupOverrides {
  const out: MatchupOverrides = {};
  for (const [pid, o] of Object.entries(ov)) {
    const r: RowOverride = {};
    if (o.addTo !== undefined) r.addTo = o.addTo;
    if (o.starter !== undefined) r.starter = o.starter;
    if (o.fpg !== undefined && Number.isFinite(o.fpg)) r.fpg = o.fpg;
    if (o.gamesLeft !== undefined && Number.isFinite(o.gamesLeft)) r.gamesLeft = o.gamesLeft;
    if (o.days) {
      const days = Object.fromEntries(Object.entries(o.days).filter(([, v]) => v != null && Number.isFinite(v)));
      if (Object.keys(days).length) r.days = days;
    }
    if (Object.keys(r).length) out[pid] = r;
  }
  return out;
}

/** Set (or clear with undefined) one field on one player's override. */
export function setField(
  ov: MatchupOverrides,
  playerId: number,
  field: 'starter' | 'fpg' | 'gamesLeft',
  value: boolean | number | undefined,
): MatchupOverrides {
  const cur = { ...(ov[playerId] ?? {}) } as RowOverride;
  if (value === undefined) delete cur[field];
  else (cur as Record<string, unknown>)[field] = value;
  return pruneOverrides({ ...ov, [playerId]: cur });
}

export function setDay(ov: MatchupOverrides, playerId: number, date: string, value: number | undefined): MatchupOverrides {
  const cur = { ...(ov[playerId] ?? {}) };
  const days = { ...(cur.days ?? {}) };
  if (value === undefined) delete days[date];
  else days[date] = value;
  cur.days = days;
  return pruneOverrides({ ...ov, [playerId]: cur });
}

/** Add a free agent to a team's what-if lineup, or remove one (teamId null). */
export function setPickup(ov: MatchupOverrides, playerId: number, teamId: number | null): MatchupOverrides {
  const next = { ...ov };
  if (teamId == null) delete next[playerId];
  else next[playerId] = { addTo: teamId };
  return pruneOverrides(next);
}
