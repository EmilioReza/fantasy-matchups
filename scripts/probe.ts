// One-off: save raw ESPN responses to fixtures/ so parsers can be built offline.
// Usage: npm run probe [-- <scoringPeriodId> ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { espnGet, leaguePath, loadLeagueConfig, playerFilterHeader, scrub, seasonPath } from './espn-client.ts';

const cfg = loadLeagueConfig();
const out = new URL('../fixtures/', import.meta.url);
mkdirSync(out, { recursive: true });
const save = (name: string, data: unknown) => {
  writeFileSync(new URL(name, out), JSON.stringify(scrub(data)));
  console.log('saved', name);
};

const league: any = await espnGet(
  leaguePath(cfg, ['mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mSettings', 'mStatus']),
);
save('league.json', league);

const pro: any = await espnGet(seasonPath(cfg, ['proTeamSchedules_wl']));
save('pro-schedules.json', pro);

const ids: number[] = league.teams.flatMap((t: any) => t.roster.entries.map((e: any) => e.playerId));
const kona = await espnGet(leaguePath(cfg, ['kona_playercard']), playerFilterHeader(ids, cfg.season));
save('players.json', kona);

const periods = process.argv.slice(2).map(Number);
if (!periods.length) periods.push(league.status.latestScoringPeriod - 1, league.status.latestScoringPeriod);
for (const sp of periods) {
  const day = await espnGet(leaguePath(cfg, ['mRoster', 'mMatchupScore'], `&scoringPeriodId=${sp}`));
  save(`roster-sp${sp}.json`, day);
}
