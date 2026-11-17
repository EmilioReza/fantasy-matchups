// Downloads each team's ESPN logo into public/data/logos/ and points teams.json at the local copy.
// Custom uploaded logos need a signed-in ESPN session, so ESPN_S2 / ESPN_SWID are sent as a Cookie
// header when set. Cookies, headers and response bodies are never printed.
// A logo that can't be downloaded keeps any copy saved earlier; with no copy, the site shows initials.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Team } from '../src/lib/types.ts';
import { DATA_DIR, ensureDir } from './paths.ts';

export const LOGO_DIR = join(DATA_DIR, 'logos');
const MAX_BYTES = 2_000_000;

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export const extFor = (contentType: string | null): string | null =>
  EXT[(contentType ?? '').split(';')[0].trim().toLowerCase()] ?? null;

/** Stable per-URL stem, so a logo is downloaded once and re-downloaded only when the team changes it. */
export const logoStem = (teamId: number, url: string) =>
  `${teamId}-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;

/** Only ESPN hosts get the cookies. */
export function needsCookie(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'espn.com' || host.endsWith('.espn.com');
  } catch {
    return false;
  }
}

function cookieHeader(): Record<string, string> {
  const s2 = process.env.ESPN_S2?.trim();
  const swid = process.env.ESPN_SWID?.trim();
  return s2 && swid ? { Cookie: `espn_s2=${s2}; SWID=${swid}` } : {};
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function syncLogos(teams: Team[], dir = LOGO_DIR, fetcher: Fetcher = fetch): Promise<{ teams: Team[]; notes: string[] }> {
  ensureDir(dir);
  const existing = readdirSync(dir);
  const notes: string[] = [];
  const out: Team[] = [];
  for (const t of teams) {
    const url = t.logo;
    const mine = existing.filter((f) => f.startsWith(`${t.teamId}-`));
    if (!url || url.startsWith('data/')) {
      out.push({ ...t, logo: url ?? null });
      continue;
    }
    const stem = logoStem(t.teamId, url);
    const have = mine.find((f) => f.startsWith(stem + '.'));
    if (have) {
      out.push({ ...t, logo: `data/logos/${have}` });
      continue;
    }
    let saved: string | null = null;
    try {
      const res = await fetcher(url, { headers: needsCookie(url) ? cookieHeader() : {}, redirect: 'follow' });
      const ext = extFor(res.headers.get('content-type'));
      if (!res.ok) notes.push(`team ${t.teamId}: logo download returned HTTP ${res.status}${res.status === 401 ? ' (ESPN login needed: set ESPN_S2 and ESPN_SWID)' : ''}`);
      else if (!ext) notes.push(`team ${t.teamId}: logo is not an image`);
      else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_BYTES) notes.push(`team ${t.teamId}: logo is larger than 2 MB, skipped`);
        else {
          saved = `${stem}.${ext}`;
          writeFileSync(join(dir, saved), buf);
          for (const old of mine) rmSync(join(dir, old));
        }
      }
    } catch (e) {
      notes.push(`team ${t.teamId}: logo download failed (${(e as Error).name})`);
    }
    // Fall back to an older saved copy (e.g. cookies expired), else no logo.
    const keep = saved ?? mine[0] ?? null;
    out.push({ ...t, logo: keep ? `data/logos/${keep}` : null });
  }
  return { teams: out, notes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = join(DATA_DIR, 'teams.json');
  if (!existsSync(file)) throw new Error('teams.json missing: run build-data first');
  const { teams, notes } = await syncLogos(JSON.parse(readFileSync(file, 'utf8')));
  writeFileSync(file, JSON.stringify(teams) + '\n');
  for (const n of notes) console.warn(`::warning::${n}`);
  console.log(`logos: ${teams.filter((t) => t.logo).length}/${teams.length} teams have a saved logo`);
}
