# ESPN Fantasy API notes

Verified on Nov 17, 2026 against league `113908445`, season id `2027`, using `scripts/probe.ts`.
Raw responses are saved in `fixtures/` (member first/last names and notification settings stripped).
The API is unofficial: re-run `npm run probe` and the tests whenever something looks off.

## Confirmed

| Item | Finding |
| --- | --- |
| Host | `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/{id}` works with no cookies (league is public). `fantasy.espn.com` answers with a 302, so it is only a last-resort fallback. |
| Season id | `2027` for the 2026–27 season. |
| Lineup lock | `settings.rosterSettings.lineupLocktimeType = "INDIVIDUAL_FIRSTGAME_WEEKLY"`. The code always uses the slot ESPN recorded for each day, which is correct for weekly and daily lock. |
| Slots | `lineupSlotCounts`: 0 PG, 1 SG, 2 SF, 3 PF, 4 C, 5 G, 6 F, 11 UTIL×3 start; 12 BE×3, 13 IR×1. Starters = every slot with count > 0 except 12 and 13. ESPN does not name slots; names come from a constant map in `src/lib/espn.ts`. |
| Scoring | `settings.scoringSettings.scoringItems[]` → `{statId, points}`. This league: PTS 1, BLK 4, STL 4, AST 2, REB 1, TO −2, FGM 2, FGA −1, FTM 1, FTA −1, 3PM 1, stat 7 = 1. |
| Status | `status.currentMatchupPeriod`, `status.latestScoringPeriod` (today), `status.finalScoringPeriod`. |
| Matchup periods | `settings.scheduleSettings.matchupPeriods` maps matchup period → list of weeks (`"20": [20, 21]` for 2-week playoff rounds). It does **not** list scoring periods (days). |
| Weeks → days | Week 1 = scoring periods 1–6 (Tue Oct 20 – Sun Oct 25). Later weeks run Mon–Sun, 7 days each. Confirmed against `pointsByScoringPeriod` keys for weeks 1–4. If ESPN reports extra keys for a period, they are added. |
| Scoring period → date | Scoring period 1 = 2026-10-20 (ET). Each period is one ET calendar day; derived from `proGamesByScoringPeriod` game dates. |
| Head-to-head schedule | `schedule[]`: `id` (matchupId), `matchupPeriodId`, `home/away.teamId`, `home/away.pointsByScoringPeriod`, `totalPoints`, `winner` (`HOME`/`AWAY`/`UNDECIDED`). |
| Teams | `teams[]`: `id`, `name`, `abbrev`, `logo`, `primaryOwner` (→ `members[].displayName`), `record.overall`. |
| Per-day points | `view=mRoster&scoringPeriodId={n}` returns each team's roster **as of that day** (`lineupSlotId` for that day). Each player's `stats[]` has an entry with `statSplitTypeId 5`, `statSourceId 0`, `scoringPeriodId n` when he played, with `appliedTotal` and raw `stats`. `stats["42"]` = games played (1). No entry → did not play. |
| Cross-check | Starter `appliedTotal` sums equal ESPN's `pointsByScoringPeriod` for every team-day of weeks 1–5 (28 days, 0 mismatches). Recomputing from raw stats with `scoringItems` equals `appliedTotal` for every player-day in the fixtures. |
| Player stats | `kona_playercard` with `X-Fantasy-Filter` (`filterIds`, `limit` **requires** a sort such as `sortPercOwned`, `filterStatsForTopScoringPeriodIds: {value: 82, additionalValue: ["002027","022027","102027"]}`) returns season (split 0 source 0), last-15 (split 2), ESPN projection (split 0 source 1) and up to 82 single-game logs (split 5). `appliedAverage` = FP/G. Game logs include last season; filter on `seasonId`. |
| Injuries | `player.injuryStatus`: `ACTIVE`, `DAY_TO_DAY`, `OUT` seen. `player.injuryDetails.expectedReturnDate = [yyyy, m, d]`. |
| Pro schedule | `GET /apis/v3/games/fba/seasons/2027?view=proTeamSchedules_wl` → `settings.proTeams[]` with `abbrev`, `id`, `proGamesByScoringPeriod{sp: [{date (epoch ms), homeProTeamId, awayProTeamId, ...}]}`. |

## Differences from the spec

- `kona_player_info` is replaced by `kona_playercard`, which also returns game logs (needed for each player's game-to-game SD).
- "Daily points" come from `mRoster` + `scoringPeriodId`, not a separate view. `mMatchupScore` on the same call is not needed.
- A day is treated as final once its ET date is before today's ET date at fetch time (2 AM ET for the 1 AM CT run). ESPN's own `latestScoringPeriod` rolls over later in the night, so it is not used for this.
- Added a `not_rostered` day status for players who joined or left a team mid-period.
