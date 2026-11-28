import { useState } from 'preact/hooks';
import type { Team } from '../lib/types.ts';
import { STATUS_CHIP, pctPair } from '../format.ts';

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

/**
 * "62% Emilio" on the home side, "Mhyank 38%" on the away side: the manager's first name, team name on
 * hover. Both sides come from the home team's chance so the pair always adds up to 100%.
 */
export function WinPct({ team, pHome, side }: { team: Team | undefined; pHome: number; side: 'home' | 'away' }) {
  const full = team?.name ?? '';
  const name = team?.owner || firstName(full);
  const shown = pctPair(pHome)[side];
  const num = <strong class="wp-num">{shown}</strong>;
  return (
    <span class={`wp wp-${side} c-${side}`} title={`${name} (${full}): ${shown} to win`}>
      {side === 'home' ? <>{num}<span class="wp-name">{name}</span></> : <><span class="wp-name">{name}</span>{num}</>}
    </span>
  );
}

export function WinBar({ home, label }: { home: number; label?: string }) {
  const h = Math.max(0, Math.min(1, home));
  return (
    <div class="winbar" role="img" aria-label={label ?? `Win probability: home ${pctPair(h).home}, away ${pctPair(h).away}`}>
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

/** ESPN headshot (fantasy player ids are ESPN ids). Hidden if ESPN has none. */
export function Headshot({ playerId }: { playerId: number }) {
  return (
    <img
      class="headshot"
      src={`https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=96&h=70&cb=1`}
      alt=""
      width={36}
      height={26}
      loading="lazy"
      decoding="async"
      onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
    />
  );
}
