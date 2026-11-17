// Nightly fetch: pull every ESPN view we need into RAW_DIR (a temp folder, never committed).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthError, espnGet, leaguePath, loadLeagueConfig, playerFilterHeader, scrub, seasonPath } from './espn-client.ts';
import { RAW_DIR, WEEKS_DIR, ensureDir } from './paths.ts';
import { matchupPeriodScoringPeriods, parseProSchedule, parseSettings, spToDate } from '../src/lib/espn.ts';
import { zonedParts } from '../src/lib/dates.ts';

async function main() {
  const cfg = loadLeagueConfig();
  ensureDir(RAW_DIR);
  const save = (name: string, data: unknown) => writeFileSync(join(RAW_DIR, name), JSON.stringify(scrub(data)));

  const league: any = await espnGet(
    leaguePath(cfg, ['mTeam', 'mRoster', 'mMatchup', 'mMatchupScore', 'mSettings', 'mStatus']),
  );
  save('league.json', league);
  const proRaw = await espnGet(seasonPath(cfg, ['proTeamSchedules_wl']));
  save('pro-schedules.json', proRaw);

  const settings = parseSettings(league);
  const pro = parseProSchedule(proRaw);
  const todayET = process.env.TODAY_ET ?? zonedParts(new Date(), 'America/New_York').date;

  // Every finished day of every period that is not yet frozen as final.
  const sps = new Set<number>();
  for (let mp = 1; mp <= settings.currentMatchupPeriod; mp++) {
    const f = join(WEEKS_DIR, `${mp}.json`);
    if (existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).status === 'final') continue;
    for (const sp of matchupPeriodScoringPeriods(settings, pro.day1, mp)) {
      if (spToDate(pro.day1, sp) < todayET) sps.add(sp);
    }
  }

  const playerIds = new Set<number>(league.teams.flatMap((t: any) => t.roster.entries.map((e: any) => e.playerId)));
  for (const sp of [...sps].sort((a, b) => a - b)) {
    const day: any = await espnGet(leaguePath(cfg, ['mRoster'], `&scoringPeriodId=${sp}`));
    for (const t of day.teams) for (const e of t.roster?.entries ?? []) playerIds.add(e.playerId);
    save(`roster-sp${sp}.json`, day);
  }

  const ids = [...playerIds];
  const players: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const res: any = await espnGet(leaguePath(cfg, ['kona_playercard']), playerFilterHeader(chunk, cfg.season));
    players.push(...res.players);
  }
  save('players.json', { players });
  writeFileSync(join(RAW_DIR, 'manifest.json'), JSON.stringify({ todayET, scoringPeriods: [...sps].sort((a, b) => a - b) }));
  console.log(`fetched league, schedule, ${sps.size} day rosters, ${players.length} players (today ET ${todayET})`);
}

main().catch((e) => {
  if (e instanceof AuthError) console.error(`::error::${e.message}`);
  console.error((e as Error).message); // message only: never headers or bodies
  process.exit(1);
});
