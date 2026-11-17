import { useEffect, useState } from 'preact/hooks';
import type { Core } from '../data.ts';
import { loadWeek } from '../data.ts';
import { fmt0, fmt1, pct, shortRange } from '../format.ts';
import { readKey, writeKey } from '../lib/overrides.ts';
import type { Matchup, Side, Week } from '../lib/types.ts';
import { TeamLogo, WinBar, record } from './common.tsx';

export const MY_TEAM_KEY = 'fmp:myTeam';

export function useMyTeam(): [number | null, (id: number | null) => void] {
  const [id, setId] = useState<number | null>(() => {
    const v = Number(readKey(MY_TEAM_KEY));
    return v > 0 ? v : null;
  });
  const set = (v: number | null) => {
    writeKey(MY_TEAM_KEY, v ? String(v) : null);
    setId(v);
  };
  return [id, set];
}

function SideRow({ core, side, final, win }: { core: Core; side: Side; final: boolean; win: boolean }) {
  const team = core.teams.get(side.teamId);
  return (
    <div class={`card-side ${final && win ? 'is-winner' : ''}`}>
      <TeamLogo team={team} size={34} />
      <div class="card-team">
        <span class="card-name">{team?.name ?? `Team ${side.teamId}`}</span>
        <span class="card-meta">
          {team && record(team)}
          {!final && <> · {side.gamesLeft} left</>}
        </span>
      </div>
      <div class="card-nums">
        <span class="card-proj num">{final ? fmt0(side.actual) : fmt1(side.projected)}</span>
        <span class="card-actual num">{final ? (win ? 'Final · W' : 'Final') : `${fmt0(side.actual)} so far`}</span>
      </div>
    </div>
  );
}

function MatchupCard({ core, week, m, mine }: { core: Core; week: Week; m: Matchup; mine: boolean }) {
  const final = week.status === 'final';
  const h = core.teams.get(m.home.teamId);
  const a = core.teams.get(m.away.teamId);
  const margin = Math.abs(m.home.projected - m.away.projected);
  return (
    <a class={`card matchup-card ${mine ? 'is-mine' : ''}`} href={`#/week/${week.matchupPeriod}/matchup/${m.matchupId}`}>
      {mine && <span class="mine-tag">My team</span>}
      <SideRow core={core} side={m.home} final={final} win={m.winner === 'HOME'} />
      <SideRow core={core} side={m.away} final={final} win={m.winner === 'AWAY'} />
      {!final && (
        <div class="card-foot">
          <div class="card-wp num">
            <span class="c-home">{pct(m.home.winProb)}</span>
            <span class="muted">{week.status === 'upcoming' ? 'win prob' : `proj. margin ${fmt1(margin)}`}</span>
            <span class="c-away">{pct(m.away.winProb)}</span>
          </div>
          <WinBar home={m.home.winProb} label={`Win probability: ${h?.name} ${pct(m.home.winProb)}, ${a?.name} ${pct(m.away.winProb)}`} />
        </div>
      )}
    </a>
  );
}

export function Scoreboard({ core, period }: { core: Core; period: number }) {
  const [week, setWeek] = useState<Week | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [myTeam, setMyTeam] = useMyTeam();
  useEffect(() => {
    setWeek(null);
    setErr(null);
    loadWeek(period).then(setWeek, (e) => setErr(e.message));
  }, [period]);

  const periods = core.meta.matchupPeriods;
  const sorted = week
    ? [...week.matchups].sort((x, y) => {
        const mx = x.home.teamId === myTeam || x.away.teamId === myTeam ? -1e9 : 0;
        const my = y.home.teamId === myTeam || y.away.teamId === myTeam ? -1e9 : 0;
        return mx + Math.abs(x.home.projected - x.away.projected) - (my + Math.abs(y.home.projected - y.away.projected));
      })
    : [];

  return (
    <section aria-labelledby="sb-title">
      <div class="page-head">
        <div>
          <h1 id="sb-title">Week {period}</h1>
          <p class="muted">
            {week && shortRange(week.dates)}
            {week && ' · '}
            {week?.status === 'final' ? 'Final' : week?.status === 'upcoming' ? 'Upcoming' : week ? 'In progress · closest projected first' : ''}
          </p>
        </div>
        <div class="controls">
          <label class="field">
            <span>Week</span>
            <select value={period} onChange={(e) => (location.hash = `#/week/${(e.target as HTMLSelectElement).value}`)}>
              {periods.map((p) => (
                <option value={p}>
                  Week {p}
                  {p === core.meta.currentMatchupPeriod ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>My team</span>
            <select value={myTeam ?? ''} onChange={(e) => setMyTeam(Number((e.target as HTMLSelectElement).value) || null)}>
              <option value="">None</option>
              {[...core.teams.values()].map((t) => (
                <option value={t.teamId}>{t.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {err && <p class="banner warn">{err}</p>}
      {!week && !err && <p class="loading">Loading week {period}…</p>}
      <div class="card-grid">
        {sorted.map((m) => (
          <MatchupCard core={core} week={week!} m={m} mine={m.home.teamId === myTeam || m.away.teamId === myTeam} />
        ))}
      </div>
      {myTeam && (
        <p class="muted small">
          <a href={`#/team/${myTeam}`}>View {core.teams.get(myTeam)?.name} roster and results →</a>
        </p>
      )}
    </section>
  );
}
