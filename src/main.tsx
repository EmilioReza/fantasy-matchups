import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles/tokens.css';
import './styles/app.css';
import { loadCore, type Core } from './data.ts';
import { asOf } from './format.ts';
import { MODEL } from './lib/model.ts';
import { readKey, writeKey } from './lib/overrides.ts';
import { Scoreboard } from './views/Scoreboard.tsx';
import { MatchupView } from './views/Matchup.tsx';
import { TeamView } from './views/Team.tsx';

type Route =
  | { name: 'scoreboard'; period?: number }
  | { name: 'matchup'; period: number; matchupId: number }
  | { name: 'team'; teamId: number };

function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'week' && parts[2] === 'matchup') return { name: 'matchup', period: +parts[1], matchupId: +parts[3] };
  if (parts[0] === 'week') return { name: 'scoreboard', period: +parts[1] };
  if (parts[0] === 'team') return { name: 'team', teamId: +parts[1] };
  return { name: 'scoreboard' };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(() => readKey('fmp:theme'));
  const sysDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme ? theme === 'dark' : sysDark;
  const toggle = () => {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writeKey('fmp:theme', next);
    setTheme(next);
  };
  return (
    <button class="icon-btn" type="button" onClick={toggle} aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}>
      {isDark ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor" /><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></g></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor" /></svg>
      )}
    </button>
  );
}

function Header({ core }: { core: Core | null }) {
  const generated = core?.meta.generatedAt;
  const ageH = generated ? (Date.now() - Date.parse(generated)) / 3_600_000 : 0;
  return (
    <>
      <header class="site-header">
        <div class="wrap header-row">
          <a class="brand" href="#/">
            <span class="brand-mark" aria-hidden="true" />
            <span>
              <span class="brand-title">Matchup Projector</span>
              {core && <span class="brand-sub">{core.meta.leagueName}</span>}
            </span>
          </a>
          <div class="header-right">
            {generated && (
              <span class="asof">
                Data as of <time dateTime={generated}>{asOf(generated)}</time>
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      {generated && ageH > MODEL.staleHours && (
        <div class="wrap">
          <p class="banner warn" role="status">
            Data hasn't updated since {asOf(generated)}; the nightly job may have failed.
          </p>
        </div>
      )}
    </>
  );
}

function App() {
  const route = useRoute();
  const [core, setCore] = useState<Core | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadCore().then(setCore, (e) => setError(String(e.message ?? e)));
  }, []);

  let body;
  if (error) body = <p class="banner warn">Couldn't load league data: {error}</p>;
  else if (!core) body = <p class="loading">Loading league…</p>;
  else if (route.name === 'matchup') body = <MatchupView core={core} period={route.period} matchupId={route.matchupId} />;
  else if (route.name === 'team') body = <TeamView core={core} teamId={route.teamId} />;
  else body = <Scoreboard core={core} period={route.period ?? core.meta.currentMatchupPeriod} />;

  return (
    <>
      <a class="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <Header core={core} />
      <main id="main" tabIndex={-1} class="wrap">{body}</main>
      <footer class="wrap site-footer">
        Points from ESPN. Projections: points so far + Σ play probability × FP/G for games left. Win probability from
        {' '}{MODEL.trials.toLocaleString()} simulations. Not affiliated with ESPN.
      </footer>
    </>
  );
}

render(<App />, document.getElementById('app')!);
