// What-if pickups: turn a free agent into a lineup row for one week, from their pro team's schedule.
import { MODEL, playProbability, playerFpg, playerSd, type ModelConfig } from './model.ts';
import type { DayStatus, LineupRow, Player, Week } from './types.ts';

/** Days already played count as "not on this roster"; the rest are scheduled games or off days. */
export function pickupRow(player: Player, week: Pick<Week, 'dates' | 'finalDates'>, proGames: string[], cfg: ModelConfig = MODEL): LineupRow {
  const final = new Set(week.finalDates);
  const games = new Set(proGames);
  const daily: LineupRow['daily'] = {};
  const dailyStatus: Record<string, DayStatus> = {};
  const remaining: LineupRow['remaining'] = [];
  for (const d of week.dates) {
    daily[d] = null;
    if (final.has(d)) dailyStatus[d] = 'not_rostered';
    else if (games.has(d)) {
      dailyStatus[d] = 'scheduled';
      remaining.push({ date: d, p: playProbability(player.injuryStatus, player.returnDate, d, cfg) });
    } else dailyStatus[d] = 'no_game';
  }
  const fpg = playerFpg(player, cfg);
  return {
    playerId: player.playerId,
    slot: 'FA',
    starter: true,
    fpg,
    sd: playerSd(player, fpg),
    gamesThisPeriod: remaining.length,
    daily,
    dailyStatus,
    dailyStarter: {},
    actual: 0,
    remaining,
  };
}
