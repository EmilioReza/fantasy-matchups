import { useState } from 'preact/hooks';
import type { Team } from '../lib/types.ts';
import { pct } from '../format.ts';
import { STATUS_CHIP } from '../format.ts';

export function TeamLogo({ team, size = 36 }: { team: Team | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!team) return null;
  if (!team.logo || failed) {
    return (
      <span class="logo logo-fallback" style={{ width: size, height: size }} aria-hidden="true">
        {team.abbrev.slice(0, 3)}
      </span>
    );
  }
  return (
    <img class="logo" src={/^https?:/.test(team.logo) ? team.logo : import.meta.env.BASE_URL + team.logo} alt="" width={size} height={size} loading="lazy" referrerpolicy="no-referrer" onError={() => setFailed(true)} />
  );
}

/** First word of a team name: "Capture the Flagg" → "Capture". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** "62% Capture" on the home side, "Sengooners 38%" on the away side; full name on hover. */
export function WinPct({ team, p, side }: { team: Team | undefined; p: number; side: 'home' | 'away' }) {
  const full = team?.name ?? '';
  const name = firstName(full);
  const num = <strong class="wp-num">{pct(p)}</strong>;
  return (
    <span class={`wp wp-${side} c-${side}`} title={`${full}: ${pct(p)} to win`}>
      {side === 'home' ? <>{num}<span class="wp-name">{name}</span></> : <><span class="wp-name">{name}</span>{num}</>}
    </span>
  );
}

export function WinBar({ home, label }: { home: number; label?: string }) {
  const h = Math.max(0, Math.min(1, home));
  return (
    <div class="winbar" role="img" aria-label={label ?? `Win probability: home ${pct(h)}, away ${pct(1 - h)}`}>
      <span class="winbar-home" style={{ width: `${h * 100}%` }} />
      <span class="winbar-away" style={{ width: `${(1 - h) * 100}%` }} />
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const label = STATUS_CHIP[status];
  if (!label) return null;
  return <span class={`chip chip-${label.toLowerCase()}`} title={status.replace(/_/g, ' ').toLowerCase()}>{label}</span>;
}

export const record = (t: Team) =>
  `${t.record.wins}-${t.record.losses}${t.record.ties ? `-${t.record.ties}` : ''}`;
