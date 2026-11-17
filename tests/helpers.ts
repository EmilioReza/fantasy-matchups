import { readFileSync } from 'node:fs';
import { parseDayRoster, parseMatchups, parsePlayers, parseProSchedule, parseSettings, parseTeams } from '../src/lib/espn.ts';
import type { BuildInputs } from '../src/lib/build.ts';

export const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export function fixtureInputs(todayET = '2026-11-17', trials = 2000): BuildInputs {
  const league = fixture('league.json');
  const pro = parseProSchedule(fixture('pro-schedules.json'));
  const abbrev = Object.fromEntries(Object.entries(pro.teams).map(([id, t]) => [id, t.abbrev]));
  const players = parsePlayers(fixture('players.json'), 2027, abbrev);
  return {
    settings: parseSettings(league),
    pro,
    teams: parseTeams(league),
    matchups: parseMatchups(league),
    players: new Map(players.map((p) => [p.playerId, p])),
    dayRosters: { 28: parseDayRoster(fixture('roster-sp28.json'), 28) },
    todayET,
    trials,
  };
}
