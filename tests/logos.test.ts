import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extFor, logoStem, needsCookie, syncLogos } from '../scripts/logos.ts';
import type { Team } from '../src/lib/types.ts';

const team = (teamId: number, logo: string | null): Team => ({
  teamId, name: `T${teamId}`, abbrev: `T${teamId}`, owner: '', logo,
  record: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }, roster: [], results: [],
});
const img = (type = 'image/png', status = 200) => new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'content-type': type } });
const URL1 = 'https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/abc';

afterEach(() => { delete process.env.ESPN_S2; delete process.env.ESPN_SWID; });

describe('logos', () => {
  it('maps content types and hosts', () => {
    expect(extFor('image/jpeg; charset=x')).toBe('jpg');
    expect(extFor('application/json')).toBeNull();
    expect(needsCookie(URL1)).toBe(true);
    expect(needsCookie('https://g.espncdn.com/x.svg')).toBe(false);
    expect(needsCookie('https://evil.com/espn.com')).toBe(false);
  });

  it('downloads with cookies only for ESPN hosts and rewrites the path', async () => {
    process.env.ESPN_S2 = 's2'; process.env.ESPN_SWID = '{id}';
    const dir = mkdtempSync(join(tmpdir(), 'logos-'));
    const seen: Record<string, unknown> = {};
    const { teams, notes } = await syncLogos([team(1, URL1), team(2, 'https://g.espncdn.com/a.svg'), team(3, null)], dir, async (u, init) => {
      seen[u] = (init.headers as Record<string, string>).Cookie;
      return u.endsWith('.svg') ? img('image/svg+xml') : img();
    });
    expect(notes).toEqual([]);
    expect(seen[URL1]).toBe('espn_s2=s2; SWID={id}');
    expect(seen['https://g.espncdn.com/a.svg']).toBeUndefined();
    expect(teams.map((t) => t.logo)).toEqual([`data/logos/${logoStem(1, URL1)}.png`, expect.stringMatching(/^data\/logos\/2-\w+\.svg$/), null]);
  });

  it('skips the download when the file exists, keeps an old copy on 401, and replaces stale files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logos-'));
    writeFileSync(join(dir, `${logoStem(1, URL1)}.png`), 'x');
    writeFileSync(join(dir, '2-oldoldold0.png'), 'x');
    writeFileSync(join(dir, '4-oldoldold0.jpg'), 'x');
    let calls = 0;
    const { teams, notes } = await syncLogos([team(1, URL1), team(2, URL1 + '2'), team(4, URL1 + '4')], dir, async (u) => {
      calls++;
      return u.endsWith('4') ? img('application/json', 401) : img('image/webp');
    });
    expect(calls).toBe(2);
    expect(teams[0].logo).toBe(`data/logos/${logoStem(1, URL1)}.png`);
    expect(teams[1].logo).toBe(`data/logos/${logoStem(2, URL1 + '2')}.webp`);
    expect(teams[2].logo).toBe('data/logos/4-oldoldold0.jpg');
    expect(notes[0]).toMatch(/team 4: .*401.*ESPN_S2/);
    expect(notes[0]).not.toMatch(/mystique|http/);
    expect(readdirSync(dir).filter((f) => f.startsWith('2-'))).toEqual([`${logoStem(2, URL1 + '2')}.webp`]);
  });
});
