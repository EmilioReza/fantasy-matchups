import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Core } from '../data.ts';
import { loadWeek } from '../data.ts';
import { dayLabel, fmt0, fmt1, pct, shortRange } from '../format.ts';
import {
  MODEL, chooseFpg, expectedRemaining, matchupSeed, projectTeam, round1, toSimPlayer, weekPoints, winProbability, type SimPlayer,
} from '../lib/model.ts';
import {
  clearOverrides, loadOverrides, overrideKey, readKey, saveOverrides, setDay, setField, setPickup, writeKey,
  type MatchupOverrides,
} from '../lib/overrides.ts';
import { pickupRow } from '../lib/pickup.ts';
import type { LineupRow, Matchup, Week } from '../lib/types.ts';
import { Headshot, StatusChip, TeamLogo, WinBar, WinPct } from './common.tsx';

type FpgSource = 'season' | 'last15';
const FPG_KEY = 'fmp:fpgSource';

/** Text input that only commits parseable numbers, so typing "33." is not clobbered. */
function NumInput(props: {
  value: number | null;
  placeholder?: string;
  label: string;
  edited?: boolean;
  step?: string;
  onCommit: (v: number | undefined) => void;
  class?: string;
}) {
  const [text, setText] = useState(props.value == null ? '' : String(props.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(props.value == null ? '' : String(props.value));
  }, [props.value]);
  return (
    <span class={`inp-wrap ${props.edited ? 'edited' : ''}`}>
      <input
        class={`num-input num ${props.class ?? ''}`}
        type="text"
        inputMode="decimal"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(props.value == null ? '' : String(props.value));
        }}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value;
          setText(t);
          if (t.trim() === '') return props.onCommit(undefined);
          const v = Number(t);
          if (Number.isFinite(v)) props.onCommit(v);
        }}
      />
    </span>
  );
}

interface TeamCalc {
  teamId: number;
  rows: LineupRow[];
  sims: SimPlayer[];
  proj: { actual: number; projected: number; gamesLeft: number };
}

function useMatchupCalc(core: Core, week: Week | null, m: Matchup | undefined, ov: MatchupOverrides, src: FpgSource): TeamCalc[] {
  return useMemo(() => {
    if (!m || !week) return [];
    return [m.home.teamId, m.away.teamId].map((teamId) => {
      const pickups = Object.entries(ov)
        .filter(([, o]) => o.addTo === teamId)
        .map(([pid]) => core.players.get(Number(pid)))
        .filter((p) => p != null)
        .map((p) => pickupRow(p, week, core.schedule.proTeams[p.proTeam]?.games ?? []));
      const rows = [...(m.lineups[teamId] ?? []), ...pickups];
      const sims = rows.map((r) => {
        const base = src === 'last15' ? core.players.get(r.playerId)?.fpgLast15 ?? r.fpg : r.fpg;
        return toSimPlayer(r, ov[r.playerId], base);
      });
      return { teamId, rows, sims, proj: projectTeam(sims) };
    });
  }, [core, week, m, ov, src]);
}

function useWinProb(m: Matchup | undefined, calc: TeamCalc[], official: boolean): { home: number; away: number } | null {
  const [wp, setWp] = useState<{ home: number; away: number } | null>(null);
  useEffect(() => {
    if (!m || calc.length < 2) return;
    if (official) {
      setWp({ home: m.home.winProb, away: m.away.winProb });
      return;
    }
    const t = setTimeout(() => {
      setWp(winProbability(calc[0].sims, calc[1].sims, MODEL.browserTrials, matchupSeed(m.matchupId)));
    }, MODEL.browserDebounceMs);
    return () => clearTimeout(t);
  }, [m, calc, official]);
  return wp;
}

function Band({ core, calc, wp, week }: { core: Core; calc: TeamCalc[]; wp: { home: number; away: number } | null; week: Week }) {
  const [h, a] = calc;
  const th = core.teams.get(h.teamId)!;
  const ta = core.teams.get(a.teamId)!;
  const final = week.status === 'final';
  const lead = round1(h.proj.projected - a.proj.projected);
  const leader = lead >= 0 ? th : ta;
  return (
    <section class="band" aria-live="polite" aria-label="Scoreboard">
      <div class="band-side band-home">
        <div class="band-team">
          <TeamLogo team={th} size={40} />
          <a href={`#/team/${th.teamId}`} class="band-name">{th.name}</a>
        </div>
        <div class="band-total num">{final ? fmt0(h.proj.actual) : fmt1(h.proj.projected)}</div>
        <div class="band-sub num">
          {final ? 'Final' : week.status === 'upcoming' ? <>{h.proj.gamesLeft} games</> : <>{fmt0(h.proj.actual)} so far · {h.proj.gamesLeft} left</>}
        </div>
      </div>
      <div class="band-mid">
        {final ? (
          <div class="band-lead">{lead === 0 ? 'Tied' : `${leader.abbrev} won by ${fmt0(Math.abs(lead))}`}</div>
        ) : (
          <>
            <div class="band-lead-label">Projected {lead === 0 ? 'tie' : 'lead'}</div>
            <div class="band-lead num">{lead === 0 ? '—' : <>{leader.abbrev} +{fmt1(Math.abs(lead))}</>}</div>
          </>
        )}
        {wp && !final && (
          <>
            <div class="band-wp-label">Win probability</div>
            <div class="band-wp num">
              <WinPct team={th} p={wp.home} side="home" />
              <WinPct team={ta} p={wp.away} side="away" />
            </div>
            <WinBar home={wp.home} label={`Win probability: ${th.name} ${pct(wp.home)}, ${ta.name} ${pct(wp.away)}`} />
          </>
        )}
      </div>
      <div class="band-side band-away">
        <div class="band-team">
          <TeamLogo team={ta} size={40} />
          <a href={`#/team/${ta.teamId}`} class="band-name">{ta.name}</a>
        </div>
        <div class="band-total num">{final ? fmt0(a.proj.actual) : fmt1(a.proj.projected)}</div>
        <div class="band-sub num">
          {final ? 'Final' : week.status === 'upcoming' ? <>{a.proj.gamesLeft} games</> : <>{fmt0(a.proj.actual)} so far · {a.proj.gamesLeft} left</>}
        </div>
      </div>
    </section>
  );
}

function BoxScore(props: {
  core: Core;
  week: Week;
  calc: TeamCalc;
  side: 'home' | 'away';
  ov: MatchupOverrides;
  editable: boolean;
  onChange: (ov: MatchupOverrides) => void;
}) {
  const { core, week, calc, side, ov, editable, onChange } = props;
  const team = core.teams.get(calc.teamId)!;
  const finalSet = new Set(week.finalDates);
  const headId = `box-${calc.teamId}`;
  // Weekly lineups: a starter toggle applies to every day of the period, played days included.
  const counts = (r: LineupRow, i: number, d: string) =>
    ov[r.playerId]?.starter !== undefined ? calc.sims[i].starter : !!r.dailyStarter[d];

  const dayTotals = week.dates.map((d) => {
    let sum = 0;
    let bench = 0;
    let est = false;
    calc.rows.forEach((r, i) => {
      const s = calc.sims[i];
      if (finalSet.has(d)) {
        if (counts(r, i, d)) sum += r.daily[d] ?? 0;
        else bench += r.daily[d] ?? 0;
      } else if (s.starter) {
        const fixed = ov[r.playerId]?.days?.[d];
        const g = r.remaining.find((x) => x.date === d);
        if (fixed != null) sum += fixed;
        else if (g && ov[r.playerId]?.gamesLeft == null) {
          sum += g.p * s.fpg;
          est = true;
        }
      }
    });
    return { sum, bench, est };
  });
  const benchTotal = round1(dayTotals.reduce((a, t) => a + t.bench, 0));

  return (
    <section class={`card box box-${side}`} aria-labelledby={headId}>
      <h2 id={headId} class="box-title">
        <TeamLogo team={team} size={26} />
        <span>{team.name}</span>
        <span class="muted box-owner">{team.owner}</span>
      </h2>
      <div class="table-wrap" tabIndex={0} role="region" aria-label={`${team.name} box score`}>
        <table class="box-table">
          <thead>
            <tr>
              <th class="col-start" scope="col"><span class="sr-only">Starting</span>Start</th>
              <th class="col-player" scope="col">Player</th>
              <th scope="col" class="num">FP/G</th>
              <th scope="col" class="num" title="Games this period">G</th>
              {week.dates.map((d) => {
                const l = dayLabel(d);
                return (
                  <th scope="col" class={`col-day num ${finalSet.has(d) ? 'is-final' : ''}`}>
                    <span class="day-wd">{l.wd}</span>
                    <span class="day-md">{l.md}</span>
                    {finalSet.has(d) && <span class="day-final">final</span>}
                  </th>
                );
              })}
              <th scope="col" class="num">Actual</th>
              <th scope="col" class="num">Proj</th>
            </tr>
          </thead>
          <tbody>
            {calc.rows.map((r, i) => {
              const s = calc.sims[i];
              const p = core.players.get(r.playerId);
              const o = ov[r.playerId] ?? {};
              const name = p?.name ?? `Player ${r.playerId}`;
              const used = week.dates.filter((d) => finalSet.has(d) && (r.dailyStatus[d] === 'played' || r.dailyStatus[d] === 'dnp')).length;
              const gShown = o.gamesLeft != null ? used + o.gamesLeft : r.gamesThisPeriod;
              const left = s.remaining.filter((g) => g.fixed != null || g.p > 0).length;
              const rowProj = s.actual + expectedRemaining(s);
              // Past weeks have no "current" lineup: a row started if it held a starting slot on any day.
              const started = week.status === 'final' ? Object.values(r.dailyStarter).some(Boolean) : s.starter;
              const offRoster = Object.values(r.dailyStatus).every((x) => x === 'not_rostered' || x === 'no_game') && !r.starter && r.remaining.length === 0 && r.actual === 0;
              return (
                <tr class={`${started ? 'is-starter' : 'is-bench'} ${offRoster ? 'is-off' : ''}`}>
                  <td class="col-start">
                    {editable ? (
                      <span class={`inp-wrap ${o.starter !== undefined ? 'edited' : ''}`}>
                        <input
                          type="checkbox"
                          class="start-toggle"
                          checked={s.starter}
                          aria-label={`Start ${name}`}
                          onChange={(e) => {
                            const v = (e.target as HTMLInputElement).checked;
                            onChange(setField(ov, r.playerId, 'starter', v === r.starter ? undefined : v));
                          }}
                        />
                      </span>
                    ) : (
                      <span class="slot-tag">{started ? '✓' : ''}</span>
                    )}
                  </td>
                  <th scope="row" class="col-player">
                    <span class="pl">
                      <Headshot playerId={r.playerId} />
                      <span class="pl-text">
                        <span class="pl-name">
                          {name}
                          {o.addTo != null && (
                            <button type="button" class="pl-remove" aria-label={`Remove ${name}`} title="Remove pickup" onClick={() => onChange(setPickup(ov, r.playerId, null))}>×</button>
                          )}
                        </span>
                        <span class="pl-meta">
                          <span class="slot-tag">{r.slot}</span> {p?.proTeam ?? ''}
                          {p && <StatusChip status={p.injuryStatus} />}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td class="num">
                    {editable ? (
                      <NumInput
                        value={o.fpg ?? round1(s.fpg)}
                        edited={o.fpg !== undefined}
                        label={`${name} fantasy points per game`}
                        onCommit={(v) => onChange(setField(ov, r.playerId, 'fpg', v))}
                      />
                    ) : (
                      fmt1(r.fpg)
                    )}
                  </td>
                  <td class="num">
                    {editable ? (
                      <NumInput
                        class="narrow"
                        value={gShown}
                        edited={o.gamesLeft !== undefined}
                        label={`${name} games this period`}
                        onCommit={(v) =>
                          onChange(setField(ov, r.playerId, 'gamesLeft', v === undefined || v === r.gamesThisPeriod ? undefined : Math.max(0, v - used)))
                        }
                      />
                    ) : (
                      r.gamesThisPeriod
                    )}
                  </td>
                  {week.dates.map((d) => {
                    const st = r.dailyStatus[d];
                    if (finalSet.has(d)) {
                      const counted = counts(r, i, d);
                      if (st === 'played') return <td class={`num day-cell locked ${counted ? '' : 'not-counted'}`} title={counted ? undefined : 'On bench: not counted'}>{fmt0(r.daily[d] ?? 0)}</td>;
                      if (st === 'dnp') return <td class="num day-cell locked dnp" title="DNP">0</td>;
                      if (st === 'not_rostered') return <td class="num day-cell locked off" title="Not on this roster"></td>;
                      return <td class="num day-cell locked nogame" title="No game">–</td>;
                    }
                    if (st !== 'scheduled') return <td class="num day-cell nogame" title={st === 'not_rostered' ? 'Not on this roster' : 'No game'}>{st === 'not_rostered' ? '' : '–'}</td>;
                    const g = r.remaining.find((x) => x.date === d);
                    const fixed = o.days?.[d];
                    return (
                      <td class="num day-cell open">
                        {editable ? (
                          <NumInput
                            class="narrow"
                            value={fixed ?? null}
                            edited={fixed !== undefined}
                            placeholder={g && g.p > 0 ? fmt0(g.p * s.fpg) : 'out'}
                            label={`${name} points on ${dayLabel(d).wd} ${dayLabel(d).md}`}
                            onCommit={(v) => onChange(setDay(ov, r.playerId, d, v))}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                  <td class="num">
                    {started ? (
                      <span class="strong">{fmt0(s.actual)}</span>
                    ) : (
                      <span class="muted" title="On bench: not counted">{fmt0(weekPoints(r))}</span>
                    )}
                  </td>
                  <td class="num proj-cell">
                    {started ? <span class="strong">{fmt1(rowProj)}</span> : <span class="muted">–</span>}
                    <span class="n-left">{left} left</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <th scope="row" class="col-player">Starters</th>
              <td />
              <td class="num">{calc.proj.gamesLeft} left</td>
              {dayTotals.map((t, i) => (
                <td class={`num ${finalSet.has(week.dates[i]) ? 'strong' : 'muted'}`}>
                  {t.sum === 0 && !finalSet.has(week.dates[i]) ? '' : `${t.est ? '~' : ''}${fmt0(t.sum)}`}
                </td>
              ))}
              <td class="num strong">{fmt0(calc.proj.actual)}</td>
              <td class={`num strong c-${side}`}>{fmt1(calc.proj.projected)}</td>
            </tr>
            <tr class="bench-total" title="Bench points: not counted">
              <td />
              <th scope="row" class="col-player">Bench <span class="small">(not counted)</span></th>
              <td />
              <td />
              {dayTotals.map((t, i) => (
                <td class="num">{finalSet.has(week.dates[i]) && t.bench ? fmt0(t.bench) : ''}</td>
              ))}
              <td class="num">{fmt0(benchTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && <PickupPicker core={core} week={week} teamId={calc.teamId} ov={ov} onChange={onChange} />}
    </section>
  );
}

/** Add a free agent to this team's what-if lineup. Lists games left this week so pickups are easy to compare. */
function PickupPicker({ core, week, teamId, ov, onChange }: { core: Core; week: Week; teamId: number; ov: MatchupOverrides; onChange: (ov: MatchupOverrides) => void }) {
  const [q, setQ] = useState('');
  const team = core.teams.get(teamId);
  const open = new Set(week.dates.filter((d) => !week.finalDates.includes(d)));
  const options = core.freeAgents
    .filter((p) => ov[p.playerId]?.addTo == null)
    .map((p) => ({ p, left: (core.schedule.proTeams[p.proTeam]?.games ?? []).filter((d) => open.has(d)).length }))
    .filter(({ p }) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  if (!core.freeAgents.length) return null;
  return (
    <div class="pickup">
      <label class="field pickup-field">
        <span>Add a free agent to {team?.name ?? 'this team'}</span>
        <input type="search" placeholder="Search free agents" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search free agents" />
      </label>
      <select
        aria-label={`Free agent to add to ${team?.name ?? 'this team'}`}
        value=""
        onChange={(e) => {
          const v = Number((e.target as HTMLSelectElement).value);
          if (v) {
            onChange(setPickup(ov, v, teamId));
            setQ('');
          }
        }}
      >
        <option value="">{options.length ? `Choose from ${options.length} free agents…` : 'No matches'}</option>
        {options.map(({ p, left }) => (
          <option value={p.playerId}>
            {p.name} · {p.positions.join('/')} {p.proTeam} · {fmt1(chooseFpgOf(p))} FP/G · {left} G left{p.injuryStatus !== 'ACTIVE' ? ` · ${p.injuryStatus.replace(/_/g, ' ').toLowerCase()}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

const chooseFpgOf = (p: { fpgSeason: number | null; fpgProjected: number | null; gamesPlayed: number }) =>
  chooseFpg(p.fpgSeason, p.fpgProjected, p.gamesPlayed);

export function MatchupView({ core, period, matchupId }: { core: Core; period: number; matchupId: number }) {
  const [week, setWeek] = useState<Week | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = overrideKey(core.meta.season, period, matchupId);
  const [ov, setOv] = useState<MatchupOverrides>(() => loadOverrides(key));
  const [src, setSrc] = useState<FpgSource>(() => (readKey(FPG_KEY) === 'last15' ? 'last15' : 'season'));

  useEffect(() => {
    setWeek(null);
    setOv(loadOverrides(key));
    loadWeek(period).then(setWeek, (e) => setErr(e.message));
  }, [period, matchupId]);

  const m = week?.matchups.find((x) => x.matchupId === matchupId);
  const editable = !!week && week.status !== 'final';
  const effectiveOv = editable ? ov : {};
  const calc = useMatchupCalc(core, week, m, effectiveOv, editable ? src : 'season');
  const hasEdits = Object.keys(effectiveOv).length > 0;
  const wp = useWinProb(m, calc, !hasEdits && src === 'season');

  const update = (next: MatchupOverrides) => {
    setOv(next);
    saveOverrides(key, next);
  };

  if (err) return <p class="banner warn">{err}</p>;
  if (!week) return <p class="loading">Loading matchup…</p>;
  if (!m) return <p class="banner warn">No matchup {matchupId} in week {period}. <a href="#/">Back to scoreboard</a></p>;

  return (
    <article class="matchup">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href={`#/week/${period}`}>← Week {period} scoreboard</a>
        <span class="muted">{shortRange(week.dates)}{week.status === 'final' ? ' · Final' : ''}</span>
      </nav>
      <Band core={core} calc={calc} wp={wp} week={week} />
      {editable && (
        <div class="tools">
          <div class="seg" role="group" aria-label="FP/G source">
            <button type="button" aria-pressed={src === 'season'} onClick={() => { setSrc('season'); writeKey(FPG_KEY, null); }}>Season FP/G</button>
            <button type="button" aria-pressed={src === 'last15'} onClick={() => { setSrc('last15'); writeKey(FPG_KEY, 'last15'); }}>Last 15 days</button>
          </div>
          <p class="muted small hint">Toggle starters, or edit FP/G, games and future days to play out what-ifs. Edits stay in this browser.</p>
        </div>
      )}
      {hasEdits && (
        <div class="whatif-bar" role="status">
          <span><span class="dot" aria-hidden="true" /> Showing your what-if edits</span>
          <button type="button" class="btn" onClick={() => { clearOverrides(key); setOv({}); }}>Reset to official</button>
        </div>
      )}
      {calc.map((c, i) => (
        <BoxScore core={core} week={week} calc={c} side={i === 0 ? 'home' : 'away'} ov={effectiveOv} editable={editable} onChange={update} />
      ))}
    </article>
  );
}
