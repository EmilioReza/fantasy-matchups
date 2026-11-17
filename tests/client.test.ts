import { afterEach, describe, expect, it, vi } from 'vitest';
import { espnGet } from '../scripts/espn-client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ESPN_S2;
  delete process.env.ESPN_SWID;
});

describe('ESPN client', () => {
  it('401/403 fails with the update-the-secrets message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(espnGet('/apis/x', {}, { backoff: [] })).rejects.toThrow(
      'ESPN cookies expired: update the ESPN_S2 and ESPN_SWID secrets',
    );
  });

  it('sends cookies only when both are set, and never puts them in errors', async () => {
    const seen: (string | undefined)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).Cookie);
      return new Response('', { status: 500 });
    }));
    await expect(espnGet('/apis/x?view=a', {}, { backoff: [] })).rejects.toThrow(/HTTP 500/);
    expect(seen.every((c) => c === undefined)).toBe(true);
    process.env.ESPN_S2 = 'SECRET_S2';
    process.env.ESPN_SWID = '{SECRET-SWID}';
    const err = (await espnGet("/apis/x?view=a", {}, { backoff: [] }).catch((e) => e)) as Error;
    expect(seen.at(-1)).toBe('espn_s2=SECRET_S2; SWID={SECRET-SWID}');
    expect(err.message).not.toContain('SECRET');
  });

  it('retries, then falls back to the second host', async () => {
    const hosts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      hosts.push(new URL(u).host);
      return hosts.length < 4 ? new Response('', { status: 503 }) : new Response('{"ok":1}', { status: 200 });
    }));
    expect(await espnGet('/apis/x', {}, { backoff: [1, 1] })).toEqual({ ok: 1 });
    expect(hosts).toEqual(['lm-api-reads.fantasy.espn.com', 'fantasy.espn.com', 'lm-api-reads.fantasy.espn.com', 'fantasy.espn.com']);
  });
});
