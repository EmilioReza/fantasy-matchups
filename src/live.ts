// The Refresh button: pull the league straight from ESPN in the browser (ESPN allows this site's
// origin), rebuild the current and future weeks with the same pipeline as the nightly job, and swap
// the results into the data cache. Today's games count their points so far.
import leagueConfig from '../config/league.json';
import type { Core } from './data.ts';
import { prime } from './data.ts';
import { addDays, zonedParts } from './lib/dates.ts';
import { MODEL } from './lib/model.ts';
import { buildFromRaw, fetchLiveDay, fetchRaw, type LeagueConfig } from './lib/pipeline.ts';
import type { Meta, Team } from './lib/types.ts';

const ESPN = 'https://lm-api-reads.fantasy.espn.com';

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  return res.json();
}

export async function liveRefresh(core: Core, onProgress: (done: number, total: number) => void): Promise<void> {
  const cfg = leagueConfig as LeagueConfig;
  // The NBA day: after midnight Eastern, last night's late games may still be on, so they stay "today".
  const calendarET = zonedParts(new Date(), 'America/New_York').date;
  const getLive = (d: string) => fetchLiveDay((url) => getJson(url), d).catch(() => undefined);
  const lastNight = await getLive(addDays(calendarET, -1));
  const lateGames = !!lastNight && Object.values(lastNight.byProTeam).some((g) => g.state === 'in');
  const todayET = lateGames ? lastNight.date : calendarET;
  // If a new week started since the last nightly run, rebuild last week too so its final day is in.
  const published = core.meta.currentMatchupPeriod;
  const first = (current: number) => (published < current ? published : current);
  const [raw, live] = await Promise.all([
    fetchRaw((path, headers) => getJson(ESPN + path, headers), cfg, {
      todayET,
      // The current week's finished days plus today (live). Past weeks stay as published.
      wantDay: (mp, date, current) => mp >= first(current) && mp <= current && date <= todayET,
      concurrency: 4,
      onProgress,
    }),
    lateGames ? Promise.resolve(lastNight) : getLive(todayET),
  ]);
  const built = buildFromRaw(raw, cfg, {
    periods: (current, last) => Array.from({ length: last - first(current) + 1 }, (_, i) => first(current) + i),
    trials: (mp, current) => (mp === current ? MODEL.trials : MODEL.browserTrials),
    live,
  });

  // Keep the site's saved logos; ESPN's custom logo URLs only load for signed-in viewers.
  const teams: Team[] = built.teams.map((t) => ({ ...t, logo: core.teams.get(t.teamId)?.logo ?? t.logo }));
  // Keep names of players from past weeks who are not in today's data.
  const players = new Map(core.players);
  for (const p of built.players) players.set(p.playerId, p);

  const now = new Date().toISOString();
  const periods = [...new Set([...core.meta.matchupPeriods, ...built.weeks.map((w) => w.matchupPeriod)])].sort((a, b) => a - b);
  const current = built.weeks.find((w) => w.matchupPeriod === built.settings.currentMatchupPeriod);
  const meta: Meta = {
    ...core.meta,
    currentMatchupPeriod: built.settings.currentMatchupPeriod,
    matchupPeriods: periods,
    dates: current?.dates ?? core.meta.dates,
    todayET,
    generatedAt: now,
    liveAt: now,
  };
  for (const w of built.weeks) prime(`weeks/${w.matchupPeriod}.json`, w);
  prime('meta.json', meta);
  prime('teams.json', teams);
  prime('players.json', [...players.values()]);
  prime('freeagents.json', built.freeAgents);
  prime('schedule.json', built.schedule);
}
