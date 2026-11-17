import { useEffect, useState } from 'preact/hooks';
import type { Core } from '../data.ts';
import { loadWeek } from '../data.ts';
import { fmt0, fmt1 } from '../format.ts';
import type { LineupRow, Week } from '../lib/types.ts';
import { StatusChip, TeamLogo, record } from './common.tsx';

export function TeamView({ core, teamId }: { core: Core; teamId: number }) {
  const team = core.teams.get(teamId);
  const [week, setWeek] = useState<Week | null>(null);
  useEffect(() => {
    loadWeek(core.meta.currentMatchupPeriod).then(setWeek, () => setWeek(null));
  }, [teamId]);
  if (!team) return <p class="banner warn">No team {teamId}. <a href="#/">Back to scoreboard</a></p>;

  const m = week?.matchups.find((x) => x.home.teamId === teamId || x.away.teamId === teamId);
  const rows = new Map<number, LineupRow>((m?.lineups[teamId] ?? []).map((r) => [r.playerId, r]));
  const roster = [...team.roster].sort((a, b) => {
    const ra = rows.get(a);
    const rb = rows.get(b);
    return Number(rb?.starter ?? 0) - Number(ra?.starter ?? 0) || (core.players.get(b)?.fpgSeason ?? 0) - (core.players.get(a)?.fpgSeason ?? 0);
  });

  return (
    <article>
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="#/">← Scoreboard</a>
      </nav>
      <div class="team-head">
        <TeamLogo team={team} size={56} />
        <div>
          <h1>{team.name}</h1>
          <p class="muted">
            {team.owner && <>{team.owner} · </>}
            {record(team)} · {fmt0(team.record.pointsFor)} PF · {fmt0(team.record.pointsAgainst)} PA
          </p>
        </div>
      </div>
      {m && (
        <p>
          <a class="btn" href={`#/week/${core.meta.currentMatchupPeriod}/matchup/${m.matchupId}`}>Open this week's matchup →</a>
        </p>
      )}
      <section class="card" aria-labelledby="roster-h">
        <h2 id="roster-h" class="box-title">Roster</h2>
        <div class="table-wrap" tabIndex={0} role="region" aria-label="Roster">
          <table class="box-table roster-table">
            <thead>
              <tr>
                <th scope="col" class="col-player">Player</th>
                <th scope="col">Slot</th>
                <th scope="col">Status</th>
                <th scope="col" class="num">FP/G</th>
                <th scope="col" class="num">Last 15</th>
                <th scope="col" class="num">GP</th>
                <th scope="col" class="num" title="Games this week">Wk G</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((pid) => {
                const p = core.players.get(pid);
                const r = rows.get(pid);
                return (
                  <tr class={r?.starter ? 'is-starter' : 'is-bench'}>
                    <th scope="row" class="col-player">
                      <span class="pl-name">{p?.name ?? pid}</span>
                      <span class="pl-meta">{p?.proTeam} · {p?.positions.join(', ')}</span>
                    </th>
                    <td><span class="slot-tag">{r?.slot ?? ''}</span></td>
                    <td>{p && p.injuryStatus !== 'ACTIVE' ? <StatusChip status={p.injuryStatus} /> : <span class="muted">Active</span>}{p?.returnDate && <span class="muted small"> back {p.returnDate.slice(5).replace('-', '/')}</span>}</td>
                    <td class="num strong">{p?.fpgSeason != null ? fmt1(p.fpgSeason) : '–'}</td>
                    <td class="num">{p?.fpgLast15 != null ? fmt1(p.fpgLast15) : '–'}</td>
                    <td class="num">{p?.gamesPlayed ?? 0}</td>
                    <td class="num">{r?.gamesThisPeriod ?? '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section class="card" aria-labelledby="results-h">
        <h2 id="results-h" class="box-title">Weekly results</h2>
        <div class="table-wrap" tabIndex={0} role="region" aria-label="Weekly results">
          <table class="box-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col" class="col-player">Opponent</th>
                <th scope="col" class="num">For</th>
                <th scope="col" class="num">Against</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {team.results.map((r) => {
                const opp = core.teams.get(r.opponentId);
                return (
                  <tr>
                    <td><a href={`#/week/${r.matchupPeriod}/matchup/${r.matchupId}`}>Week {r.matchupPeriod}</a></td>
                    <th scope="row" class="col-player"><a href={`#/team/${r.opponentId}`}>{opp?.name ?? r.opponentId}</a></th>
                    <td class="num">{fmt0(r.pointsFor)}</td>
                    <td class="num">{fmt0(r.pointsAgainst)}</td>
                    <td>{r.result ? <span class={`chip chip-${r.result.toLowerCase()}`}>{r.result === 'W' ? 'Win' : r.result === 'L' ? 'Loss' : 'Tie'}</span> : <span class="muted">In progress</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
