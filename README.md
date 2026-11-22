# Fantasy Matchup Projector

A static site that shows every head-to-head matchup in our ESPN fantasy basketball league for the
current week: points so far, a projected final and a win probability, with the box-score what-if
editor from the original prototype. Data refreshes at 1:00 AM and 5:00 AM Central via GitHub Actions.

- **Site:** `https://<username>.github.io/fantasy-matchups/`
- **Data:** `public/data/*.json`, written by the nightly job. Schemas in `schemas/`.
- **Math:** `src/lib/model.ts` is shared by the job and the browser, so what-if numbers match the published ones.
- **ESPN API notes:** [docs/espn-api-notes.md](docs/espn-api-notes.md).

## Develop

```bash
npm ci
npm run dev            # http://localhost:5173/fantasy-matchups/
npm test               # Vitest: parsers, scoring, projection, win prob, time gate, overrides, schemas
```

Refresh data locally (no cookies needed while the league is public):

```bash
npm run fetch && npm run build-data && npm run validate-data
```

`npm run probe` re-captures raw ESPN responses into `fixtures/` for parser work.

## How it updates

`.github/workflows/nightly.yml` is scheduled at four UTC times. The first step (`scripts/gate.ts`)
reads Chicago local time and lets exactly one 1 AM run and one 5 AM run through per Chicago date, in
both CST and CDT. A manual **Actions → nightly → Run workflow** always runs. Each run rebuilds the
whole current matchup period from ESPN, validates every file, commits `public/data/` if it changed,
and deploys to Pages. Past weeks are frozen once final.

If ESPN returns 401/403 the run fails with *"ESPN cookies expired: update the ESPN_S2 and ESPN_SWID
secrets"*. Nothing is committed, and the site flags data older than 36 hours as stale.

## Private league?

Add repository secrets `ESPN_S2` and `ESPN_SWID` (Settings → Secrets and variables → Actions), taken
from espn.com cookies in a desktop browser (DevTools → Application → Cookies). They are only sent as
a `Cookie` header and never written to files or logs.

## Team logos

`scripts/logos.ts` runs after `build-data` and saves each team's logo into `public/data/logos/`
(once per logo URL), so the site serves its own copies. Custom uploaded logos are only visible to a
signed-in ESPN account, so they download only when the `ESPN_S2` and `ESPN_SWID` secrets are set;
without them those teams show their abbreviation. Once a logo has been saved it stays, even if the
cookies later expire.

## Refresh button

The **Refresh** button in the header pulls the league straight from ESPN in the browser (ESPN allows
this site's origin) and rebuilds the current and future weeks with the same code the nightly job runs
(`src/lib/pipeline.ts`). Games in progress count their points so far, and only the time left is
projected, using the clock from ESPN's public NBA scoreboard. It takes a few seconds, changes nothing
in the repository, and lasts until the page is reloaded.

## Future weeks and pickups

Every scheduled week is published. Upcoming weeks use the roster and lineup each manager has
already set for that week on ESPN (pending adds and drops included), read from the week's first day. The job also saves the 150 most-owned free agents and waiver players
(`public/data/freeagents.json`), and the matchup page can add any of them to a team's what-if
lineup, using their pro team's remaining games that week.

## Manager names

Win percentages show each manager's first name from ESPN. To show a different name, add it to
`managerNames` in `config/league.json` by team id (e.g. `"2": "Adhitya"`).

## Offseason

GitHub disables scheduled workflows after 60 days with no repository activity. Nightly data commits
keep it alive during the season; after a quiet offseason, re-enable the **nightly** workflow from the
Actions tab.

## Tuning

`config/model.json` holds play probabilities by injury status, the prior weight for blending FP/G
with last season, the SD fallback (0.47 × FP/G), the week-long form swing, simulation trial counts
and the stale threshold. Why those values: [docs/model-backtest.md](docs/model-backtest.md).
