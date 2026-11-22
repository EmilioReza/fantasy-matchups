// Nightly fetch: pull every ESPN view we need into RAW_DIR (a temp folder, never committed).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthError, espnGet, loadLeagueConfig, scrub } from './espn-client.ts';
import { RAW_DIR, WEEKS_DIR, ensureDir } from './paths.ts';
import { fetchRaw } from '../src/lib/pipeline.ts';
import { zonedParts } from '../src/lib/dates.ts';

async function main() {
  const cfg = loadLeagueConfig();
  ensureDir(RAW_DIR);
  const save = (name: string, data: unknown) => writeFileSync(join(RAW_DIR, name), JSON.stringify(scrub(data)));
  const todayET = process.env.TODAY_ET ?? zonedParts(new Date(), 'America/New_York').date;

  const weekFile = (mp: number) => join(WEEKS_DIR, `${mp}.json`);
  const frozen = (mp: number) => existsSync(weekFile(mp)) && JSON.parse(readFileSync(weekFile(mp), 'utf8')).status === 'final';
  // Everyone in published weeks too, so a player dropped since then still has a name.
  const extra = new Set<number>();
  for (let mp = 1; existsSync(weekFile(mp)); mp++) {
    for (const m of JSON.parse(readFileSync(weekFile(mp), 'utf8')).matchups ?? [])
      for (const rows of Object.values<any[]>(m.lineups ?? {})) for (const r of rows) extra.add(r.playerId);
  }

  const raw = await fetchRaw((path, headers) => espnGet(path, headers), cfg, {
    todayET,
    // Every finished day of every period that is not yet frozen as final.
    wantDay: (mp, date) => !frozen(mp) && date < todayET,
    extraPlayerIds: extra,
  });

  save('league.json', raw.league);
  save('pro-schedules.json', raw.pro);
  for (const [sp, day] of Object.entries(raw.days)) save(`roster-sp${sp}.json`, day);
  for (const [mp, day] of Object.entries(raw.planned)) save(`plan-mp${mp}.json`, day);
  save('players.json', raw.players);
  save('freeagents.json', raw.freeAgents);
  const scoringPeriods = Object.keys(raw.days).map(Number).sort((a, b) => a - b);
  const plannedPeriods = Object.keys(raw.planned).map(Number).sort((a, b) => a - b);
  writeFileSync(join(RAW_DIR, 'manifest.json'), JSON.stringify({ todayET, scoringPeriods, plannedPeriods }));
  console.log(
    `fetched league, schedule, ${scoringPeriods.length} day rosters, ${plannedPeriods.length} planned lineups, ` +
      `${raw.players.players.length} players, ${raw.freeAgents.players.length} free agents (today ET ${todayET})`,
  );
}

main().catch((e) => {
  if (e instanceof AuthError) console.error(`::error::${e.message}`);
  console.error((e as Error).message); // message only: never headers or bodies
  process.exit(1);
});
