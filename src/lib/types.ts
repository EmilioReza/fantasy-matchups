// Shapes of the generated JSON under public/data/. Shared by the nightly job and the browser.

export type DayStatus = 'played' | 'dnp' | 'no_game' | 'scheduled' | 'not_rostered';
export type WeekStatus = 'final' | 'in_progress' | 'upcoming';

export interface Meta {
  schemaVersion: 1;
  leagueId: number;
  leagueName: string;
  season: number;
  timezone: string;
  lineupLockType: string;
  currentMatchupPeriod: number;
  matchupPeriods: number[]; // periods with a weeks/{p}.json file
  dates: string[]; // dates of the current matchup period
  todayET: string; // NBA "today" at build time
  generatedAt: string;
  lastRunChicagoDate: string | null;
  lastSettleChicagoDate: string | null;
}

export interface TeamResult {
  matchupPeriod: number;
  matchupId: number;
  opponentId: number;
  pointsFor: number;
  pointsAgainst: number;
  result: 'W' | 'L' | 'T' | null;
}

export interface Team {
  teamId: number;
  name: string;
  abbrev: string;
  owner: string;
  logo: string | null;
  record: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number };
  roster: number[];
  results: TeamResult[];
}

export interface Player {
  playerId: number;
  name: string;
  proTeam: string;
  positions: string[];
  injuryStatus: string; // ACTIVE, DAY_TO_DAY, OUT, ...
  returnDate: string | null;
  fpgSeason: number | null;
  fpgLast15: number | null;
  fpgProjected: number | null;
  sdGame: number | null;
  /** Prior FP/G: average of the player's recent games last season (≥10), else null. */
  fpgPrior: number | null;
  /** Single-game SD ÷ mean over the player's last 82 games (both seasons), or null with too few. */
  cvGame: number | null;
  gamesPlayed: number;
}

export interface RemainingGame {
  date: string;
  p: number;
}

export interface LineupRow {
  playerId: number;
  slot: string;
  starter: boolean;
  fpg: number;
  sd: number | null;
  gamesThisPeriod: number;
  daily: Record<string, number | null>;
  dailyStatus: Record<string, DayStatus>;
  /** For final days: was the player in a starting slot that day (only those points count). */
  dailyStarter: Record<string, boolean>;
  /** Official points so far (starter days only). */
  actual: number;
  /** Games still to be played this period, with play probability. */
  remaining: RemainingGame[];
}

export interface Side {
  teamId: number;
  actual: number;
  projected: number;
  gamesLeft: number;
  winProb: number;
}

export interface Matchup {
  matchupId: number;
  home: Side;
  away: Side;
  winner: 'HOME' | 'AWAY' | 'TIE' | null;
  lineups: Record<string, LineupRow[]>;
}

export interface Week {
  matchupPeriod: number;
  dates: string[];
  finalDates: string[];
  status: WeekStatus;
  matchups: Matchup[];
}

export interface Schedule {
  periods: { matchupPeriod: number; dates: string[] }[];
  proTeams: Record<string, { abbrev: string; games: string[] }>;
}
