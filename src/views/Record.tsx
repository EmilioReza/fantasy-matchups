// Model track record: every day's win probabilities, graded once each week is final.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Core } from '../data.ts';
import { loadPredictions } from '../data.ts';
import { dayLabel, pct } from '../format.ts';
import { brier, calibration, type CalibrationBin } from '../lib/predictions.ts';
import type { Prediction } from '../lib/types.ts';

type Filter = 'all' | 'live';

const r1 = (x: number) => Math.round(x * 1000) / 10;

function CalibrationChart({ bins }: { bins: CalibrationBin[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Plot area: x = stated chance 50–100%, y = how often the favourite won 0–100%.
  const W = 560, H = 350, L = 74, R = 16, T = 16, B = 52;
  const x = (v: number) => L + ((v - 0.5) / 0.5) * (W - L - R);
  const y = (v: number) => T + (1 - v) * (H - T - B);
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const rad = (n: number) => 5 + 9 * Math.sqrt(n / maxN);
  const hb = hover != null ? bins[hover] : null;
  return (
    <figure class="cal">
      <div class="cal-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Calibration chart: how often the favourite won at each stated chance. Points on the diagonal mean the percentages were accurate.">
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g>
              <line class="cal-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text class="cal-tick" x={L - 8} y={y(v) + 4} text-anchor="end">{Math.round(v * 100)}%</text>
            </g>
          ))}
          {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => (
            <text class="cal-tick" x={x(v)} y={H - B + 18} text-anchor="middle">{Math.round(v * 100)}%</text>
          ))}
          <text class="cal-axis" x={(L + W - R) / 2} y={H - 6} text-anchor="middle">What the site said (favourite's chance)</text>
          <text class="cal-axis" transform={`translate(18 ${(T + H - B) / 2}) rotate(-90)`} text-anchor="middle">How often the favourite won</text>
          {/* Perfect calibration */}
          <line class="cal-diag" x1={x(0.5)} y1={y(0.5)} x2={x(1)} y2={y(1)} />
          <text
            class="cal-diag-label"
            text-anchor="middle"
            transform={`translate(${x(0.71)} ${y(0.71) - 8}) rotate(${(Math.atan2(y(1) - y(0.5), x(1) - x(0.5)) * 180) / Math.PI})`}
          >
            perfectly accurate
          </text>
          {bins.map((b, i) => (
            <g
              class={`cal-pt ${hover === i ? 'is-hover' : ''}`}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`Said ${Math.round(b.lo * 100)} to ${Math.round(b.hi * 100)} percent, ${b.n} predictions, favourite won ${pct(b.won)}`}
            >
              <line class="cal-gap" x1={x(b.said)} x2={x(b.said)} y1={y(b.said)} y2={y(b.won)} />
              <circle class="cal-hit" cx={x(b.said)} cy={y(b.won)} r={rad(b.n) + 10} />
              <circle class="cal-dot" cx={x(b.said)} cy={y(b.won)} r={rad(b.n)} />
            </g>
          ))}
        </svg>
        {hb && (
          <div class="cal-tip" style={{ left: `${(x(hb.said) / W) * 100}%`, top: `${(y(hb.won) / H) * 100}%` }} role="status">
            <strong>Said {Math.round(hb.lo * 100)}–{Math.round(hb.hi * 100)}%</strong> (avg {r1(hb.said)}%)
            <br />
            {hb.n} predictions · favourite won {Math.round(hb.won * hb.n)} ({r1(hb.won)}%)
          </div>
        )}
      </div>
      <figcaption class="muted small">
        Each dot groups predictions by what the site said; bigger dots are more predictions. Dots above the line mean
        favourites won more often than the site said (too cautious), below means less often (overconfident).
      </figcaption>
    </figure>
  );
}

function WeekGrid({ core, preds }: { core: Core; preds: Prediction[] }) {
  const weeks = [...new Set(preds.map((p) => p.period))].sort((a, b) => b - a);
  const name = (id: number) => core.teams.get(id)?.owner || core.teams.get(id)?.name || `Team ${id}`;
  return (
    <>
      {weeks.map((wk) => {
        const ps = preds.filter((p) => p.period === wk);
        const dates = [...new Set(ps.map((p) => p.date))].sort();
        const mids = [...new Set(ps.map((p) => p.matchupId))];
        const graded = ps.every((p) => p.homeWon != null);
        return (
          <section class="card rec-week" aria-labelledby={`rec-w${wk}`}>
            <h3 id={`rec-w${wk}`} class="box-title">
              <span>Week {wk}</span>
              <span class="muted small">{graded ? "winner's chance each morning" : 'in progress · first team\'s chance each morning'}</span>
            </h3>
            <div class="table-wrap" tabIndex={0} role="region" aria-label={`Week ${wk} predictions`}>
              <table class="box-table rec-table">
                <thead>
                  <tr>
                    <th scope="col" class="col-player">Matchup</th>
                    {dates.map((d) => {
                      const l = dayLabel(d);
                      return (
                        <th scope="col" class="col-day num">
                          <span class="day-wd">{l.wd}</span>
                          <span class="day-md">{l.md}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {mids.map((mid) => {
                    const row = ps.filter((p) => p.matchupId === mid);
                    const first = row[0];
                    // Graded weeks read from the winner's side; in-progress weeks from the first-listed team.
                    const homeSide = first.homeWon == null ? true : first.homeWon >= 0.5;
                    const a = homeSide ? first.homeId : first.awayId;
                    const b = homeSide ? first.awayId : first.homeId;
                    return (
                      <tr>
                        <th scope="row" class="col-player">
                          <span class="pl-name">{name(a)}{first.homeWon != null && ' ✓'}</span>
                          <span class="pl-meta">vs {name(b)}</span>
                        </th>
                        {dates.map((d) => {
                          const p = row.find((x) => x.date === d);
                          if (!p) return <td class="num muted">–</td>;
                          const v = homeSide ? p.pHome : 1 - p.pHome;
                          const missed = p.homeWon != null && v < 0.5;
                          return (
                            <td
                              class={`num rec-cell ${p.source === 'replay' ? 'is-replay' : ''} ${missed ? 'is-miss' : ''}`}
                              title={`${p.source === 'replay' ? 'Replayed' : 'Published that morning'} · model v${p.model}${missed ? ' · favoured the team that lost' : ''}`}
                            >
                              {pct(v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

export function RecordView({ core }: { core: Core }) {
  const [all, setAll] = useState<Prediction[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => {
    loadPredictions().then(setAll, (e) => setErr(e.message));
  }, [core]);
  const preds = useMemo(() => (all ?? []).filter((p) => filter === 'all' || p.source === 'live'), [all, filter]);
  const graded = preds.filter((p) => p.homeWon != null);
  const bins = calibration(graded);
  const b = brier(graded);
  // Share of predictions where the favourite (the side given 50%+) won; ties count half.
  const favWon = graded.length
    ? graded.reduce((a, p) => a + (p.pHome >= 0.5 ? p.homeWon! : 1 - p.homeWon!), 0) / graded.length
    : null;
  const matchups = new Set(graded.map((p) => p.matchupId)).size;
  const liveStart = (all ?? []).find((p) => p.source === 'live')?.date;

  if (err) return <p class="banner warn">{err}</p>;
  if (!all) return <p class="loading">Loading track record…</p>;
  return (
    <article class="record">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="#/">← Scoreboard</a>
      </nav>
      <div class="page-head">
        <div>
          <h1>Model track record</h1>
          <p class="muted">
            Every morning the site gives each matchup a win chance. Once the week is over, we check: when it said 75%,
            did the favourite win about 75% of the time?
          </p>
        </div>
        <div class="seg" role="group" aria-label="Which predictions">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button type="button" aria-pressed={filter === 'live'} onClick={() => setFilter('live')}>Published only</button>
        </div>
      </div>

      <div class="rec-stats">
        <div class="card rec-stat">
          <span class="rec-stat-n num">{graded.length}</span>
          <span class="muted small">graded predictions · {matchups} matchups</span>
        </div>
        <div class="card rec-stat">
          <span class="rec-stat-n num">{favWon == null ? '–' : pct(favWon)}</span>
          <span class="muted small">of the time the favourite won</span>
        </div>
        <div class="card rec-stat">
          <span class="rec-stat-n num">{b == null ? '–' : b.toFixed(3)}</span>
          <span class="muted small">Brier score (0 is perfect, a coin flip is 0.250)</span>
        </div>
      </div>

      {graded.length ? (
        <section class="card rec-cal" aria-labelledby="cal-h">
          <h2 id="cal-h" class="box-title">Is 75% really 75%?</h2>
          <CalibrationChart bins={bins} />
          <div class="table-wrap" tabIndex={0} role="region" aria-label="Calibration table">
            <table class="box-table">
              <thead>
                <tr>
                  <th scope="col">Site said</th>
                  <th scope="col" class="num">Predictions</th>
                  <th scope="col" class="num">Favourite won</th>
                  <th scope="col" class="num">Expected wins</th>
                </tr>
              </thead>
              <tbody>
                {bins.map((bn) => (
                  <tr>
                    <td>{Math.round(bn.lo * 100)}–{Math.round(bn.hi * 100)}% <span class="muted small">(avg {r1(bn.said)}%)</span></td>
                    <td class="num">{bn.n}</td>
                    <td class="num strong">{Math.round(bn.won * bn.n)} ({r1(bn.won)}%)</td>
                    <td class="num">{(bn.said * bn.n).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="muted small rec-note">
            Days of the same matchup move together, so {graded.length} predictions are really {matchups} outcomes. Expect the
            dots to wander until there are a few hundred predictions; a single upset moves a small group a lot.
          </p>
        </section>
      ) : (
        <p class="banner">No finished weeks yet{filter === 'live' ? ' with published predictions' : ''}.</p>
      )}

      <h2 class="rec-h2">Day by day</h2>
      <p class="muted small">
        <span class="rec-key">72%</span> published that morning{liveStart ? ` (saved since ${dayLabel(liveStart).md})` : ''} ·{' '}
        <span class="rec-key is-replay">72%</span> replayed afterwards from the games played before that day ·{' '}
        <span class="rec-key is-miss">40%</span> favoured the team that lost. Predictions before Nov 20 came from the first
        version of the model.
      </p>
      <WeekGrid core={core} preds={preds} />
    </article>
  );
}
