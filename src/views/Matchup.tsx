import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Core } from '../data.ts';
import { loadWeek } from '../data.ts';
import { dayLabel, fmt0, fmt1, pct, shortRange } from '../format.ts';
import {
  MODEL, expectedRemaining, matchupSeed, projectTeam, round1, toSimPlayer, winProbability, type SimPlayer,
} from '../lib/model.ts';
import {
  clearOverrides, loadOverrides, overrideKey, readKey, saveOverrides, setDay, setField, writeKey,
  type MatchupOverrides,
} from '../lib/overrides.ts';
import type { LineupRow, Matchup, Week } from '../lib/types.ts';
import { StatusChip, TeamLogo, WinBar } from './common.tsx';

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

function useMatchupCalc(core: Core, m: Matchup | undefined, ov: MatchupOverrides, src: FpgSource): TeamCalc[] {
  return useMemo(() => {
    if (!m) return [];
    return [m.home.teamId, m.away.teamId].map((teamId) => {
      const rows = m.lineups[teamId] ?? [];
      const sims = rows.map((r) => {
        const base = src === 'last15' ? core.players.get(r.playerId)?.fpgLast15 ?? r.fpg : r.fpg;
        return toSimPlayer(r, ov[r.playerId], base);
      });
      return { teamId, rows, sims, proj: projectTeam(sims) };
    });
  }, [core, m, ov, src]);
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
          {final ? 'Final' : <>{fmt0(h.proj.actual)} so far · {h.proj.gamesLeft} left</>}
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
            <div class="band-wp num">
              <span class="c-home">{pct(wp.home)}</span>
              <span class="band-wp-label">win probability</span>
              <span class="c-away">{pct(wp.away)}</span>
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
          {final ? 'Final' : <>{fmt0(a.proj.actual)} so far · {a.proj.gamesLeft} left</>}
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

  const dayTotals = week.dates.map((d) => {
    let sum = 0;
    let est = false;
    calc.rows.forEach((r, i) => {
      const s = calc.sims[i];
      if (finalSet.has(d)) {
        if (r.dailyStarter[d]) sum += r.daily[d] ?? 0;
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
    return { sum, est };
  });

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
              const offRoster = Object.values(r.dailyStatus).every((x) => x === 'not_rostered' || x === 'no_game') && !r.starter && r.remaining.length === 0 && r.actual === 0;
              return (
                <tr class={`${s.starter ? 'is-starter' : 'is-bench'} ${offRoster ? 'is-off' : ''}`}>
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
                      <span class="slot-tag">{s.starter ? '✓' : ''}</span>
                    )}
                  </td>
                  <th scope="row" class="col-player">
                    <span class="pl-name">{name}</span>
                    <span class="pl-meta">
                      <span class="slot-tag">{r.slot}</span> {p?.proTeam ?? ''}
                      {p && <StatusChip status={p.injuryStatus} />}
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
                      const counted = r.dailyStarter[d];
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
                  <td class="num strong">{fmt0(r.actual)}</td>
                  <td class="num proj-cell">
                    {s.starter ? <span class="strong">{fmt1(rowProj)}</span> : <span class="muted">–</span>}
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
          </tfoot>
        </table>
      </div>
    </section>
  );
}

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
  const calc = useMatchupCalc(core, m, effectiveOv, editable ? src : 'season');
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
