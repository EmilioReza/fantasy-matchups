// Loads the static JSON the nightly job publishes. Cached per session.
import type { Meta, Player, Schedule, Team, Week } from './lib/types.ts';

const base = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();

function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(`${base}data/${path}`, { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
        return r.json();
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

/** Replace a cached file with fresh data (Refresh button). */
export function prime(path: string, value: unknown): void {
  cache.set(path, Promise.resolve(value));
}

export const loadMeta = () => load<Meta>('meta.json');
export const loadTeams = () => load<Team[]>('teams.json');
export const loadPlayers = () => load<Player[]>('players.json');
export const loadSchedule = () => load<Schedule>('schedule.json');
export const loadFreeAgents = () => load<Player[]>('freeagents.json').catch(() => [] as Player[]);
export const loadWeek = (p: number) => load<Week>(`weeks/${p}.json`);

export interface Core {
  meta: Meta;
  teams: Map<number, Team>;
  /** Rostered and recently rostered players, plus free agents (for what-if pickups). */
  players: Map<number, Player>;
  /** Free agents, best FP/G first. */
  freeAgents: Player[];
  schedule: Schedule;
}

export async function loadCore(): Promise<Core> {
  const [meta, teams, players, freeAgents, schedule] = await Promise.all([
    loadMeta(), loadTeams(), loadPlayers(), loadFreeAgents(), loadSchedule(),
  ]);
  return {
    meta,
    teams: new Map(teams.map((t) => [t.teamId, t])),
    players: new Map([...freeAgents, ...players].map((p) => [p.playerId, p])),
    freeAgents,
    schedule,
  };
}
