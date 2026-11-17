// Minimal ESPN read client used by probe.ts and fetch.ts.
// Cookies (ESPN_S2 / ESPN_SWID) are optional and are never logged or written anywhere.
import { readFileSync } from 'node:fs';

export interface LeagueConfig {
  leagueId: number;
  season: number;
  timezone: string;
}

export function loadLeagueConfig(): LeagueConfig {
  return JSON.parse(readFileSync(new URL('../config/league.json', import.meta.url), 'utf8'));
}

const HOSTS = ['https://lm-api-reads.fantasy.espn.com', 'https://fantasy.espn.com'];
const BACKOFF_MS = [5_000, 30_000, 120_000];

export class AuthError extends Error {}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', ...extra };
  const s2 = process.env.ESPN_S2?.trim();
  const swid = process.env.ESPN_SWID?.trim();
  if (s2 && swid) h.Cookie = `espn_s2=${s2}; SWID=${swid}`;
  return h;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a path (starting with /apis/...) as JSON. Tries the newer host, then falls back. Retries with backoff. */
export async function espnGet<T = unknown>(
  path: string,
  extraHeaders: Record<string, string> = {},
  opts: { backoff?: number[] } = {},
): Promise<T> {
  const backoff = opts.backoff ?? (process.env.ESPN_FAST_RETRY ? [100, 100, 100] : BACKOFF_MS);
  let lastErr = 'unknown error';
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    for (const host of HOSTS) {
      try {
        const res = await fetch(host + path, { headers: headers(extraHeaders), redirect: 'manual' });
        if (res.status === 401 || res.status === 403) {
          throw new AuthError('ESPN cookies expired: update the ESPN_S2 and ESPN_SWID secrets');
        }
        if (!res.ok) {
          lastErr = `HTTP ${res.status} from ${new URL(host).host}`;
          // A 400 means our request is malformed; retrying will not help.
          if (res.status === 400) throw new Error(`ESPN rejected request for ${path.split('?')[0]}: ${lastErr}`);
          continue;
        }
        const text = await res.text();
        try {
          return JSON.parse(text) as T;
        } catch {
          lastErr = `non-JSON response from ${new URL(host).host}`;
          continue;
        }
      } catch (e) {
        if (e instanceof AuthError || (e as Error).message.startsWith('ESPN rejected')) throw e;
        lastErr = `network error from ${new URL(host).host}: ${(e as Error).message}`;
      }
    }
    if (attempt < backoff.length) {
      console.warn(`ESPN fetch failed (${lastErr}); retry ${attempt + 1}/${backoff.length} in ${backoff[attempt] / 1000}s`);
      await sleep(backoff[attempt]);
    }
  }
  // Only the path (no headers, no body) goes into the message.
  throw new Error(`ESPN fetch failed for ${path.split('?')[0]}: ${lastErr}`);
}

export function leaguePath(cfg: LeagueConfig, views: string[], extra = ''): string {
  const q = views.map((v) => `view=${v}`).join('&');
  return `/apis/v3/games/fba/seasons/${cfg.season}/segments/0/leagues/${cfg.leagueId}?${q}${extra}`;
}

export function seasonPath(cfg: LeagueConfig, views: string[]): string {
  return `/apis/v3/games/fba/seasons/${cfg.season}?${views.map((v) => `view=${v}`).join('&')}`;
}

/** Filter for kona_playercard: season totals, last-15, projection, plus up to 82 single-game logs per player. */
export function playerFilterHeader(playerIds: number[], season: number): Record<string, string> {
  return {
    'X-Fantasy-Filter': JSON.stringify({
      players: {
        filterIds: { value: playerIds },
        limit: playerIds.length + 10,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
        filterStatsForTopScoringPeriodIds: {
          value: 82,
          additionalValue: [`00${season}`, `02${season}`, `10${season}`],
        },
      },
    }),
  };
}

/** Remove member personal fields before anything is saved. The league JSON includes real first/last names. */
export function scrub(obj: any): any {
  if (obj && Array.isArray(obj.members)) {
    obj.members = obj.members.map((m: any) => ({ id: m.id, displayName: m.displayName }));
  }
  if (obj?.status?.creationInfo) delete obj.status.creationInfo;
  return obj;
}
