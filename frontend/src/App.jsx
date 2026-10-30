import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  ACTIVITY_OPTIONS, AGE_GROUPS, GENDER_GROUPS, PROVINCES, formatMonth, formatNumber,
  loadPlayerHistory, loadPlayers, matchesFilters, playerStanding, sortByRating,
} from './data';
import { readUrlState, writeUrlState } from './urlState';
import PlayerSearch from './components/PlayerSearch';
import Filters from './components/Filters';
import PlayerCard from './components/PlayerCard';
import Distribution from './components/Distribution';
import Leaderboard from './components/Leaderboard';

function useIsMobile() {
  const query = '(max-width: 640px)';
  const [mobile, setMobile] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return undefined;
    const onChange = e => setMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** Loads one player's history and tracks its status. */
function useHistory(playerId) {
  const [state, setState] = useState({ status: 'idle', data: [] });
  useEffect(() => {
    if (!playerId) { setState({ status: 'idle', data: [] }); return undefined; }
    let cancelled = false;
    setState({ status: 'loading', data: [] });
    loadPlayerHistory(playerId).then(
      data => !cancelled && setState({ status: 'ready', data }),
      err => !cancelled && setState({ status: 'error', data: [], error: err.message }),
    );
    return () => { cancelled = true; };
  }, [playerId]);
  return state;
}

function describe(filters, count) {
  const parts = [filters.gender ? GENDER_GROUPS[filters.gender] : 'Players'];
  if (filters.province) parts.push(`in ${PROVINCES[filters.province] || filters.province}`);
  if (filters.age) parts.push(AGE_GROUPS.find(g => g.id === filters.age)?.label);
  if (filters.active) parts.push(`who played in the last ${ACTIVITY_OPTIONS.find(o => o.id === filters.active)?.label}`);
  return `${parts.join(' ')} · ${formatNumber(count)} ${count === 1 ? 'player' : 'players'}`;
}

function App() {
  const [dataset, setDataset] = useState({ status: 'loading', players: [] });
  const [view, setView] = useState(() => readUrlState());
  const isMobile = useIsMobile();

  useEffect(() => {
    loadPlayers().then(
      d => setDataset({ status: 'ready', ...d }),
      err => setDataset({ status: 'error', players: [], error: err.message }),
    );
  }, []);

  useEffect(() => writeUrlState(view), [view]);

  const update = useCallback(patch => setView(v => ({ ...v, ...patch })), []);
  const { province, gender, age, active } = view;
  const filters = useMemo(() => ({ province, gender, age, active }), [province, gender, age, active]);

  const byId = useMemo(() => new Map(dataset.players.map(p => [p.id, p])), [dataset.players]);
  const player = byId.get(view.player) || null;
  const comparePlayer = byId.get(view.compare) || null;
  const history = useHistory(player?.id);
  const compareHistory = useHistory(player ? comparePlayer?.id : null);

  const provinces = useMemo(
    () => [...new Set(dataset.players.map(p => p.province).filter(Boolean))]
      .sort((a, b) => (PROVINCES[a] || a).localeCompare(PROVINCES[b] || b)),
    [dataset.players],
  );
  const filtered = useMemo(() => sortByRating(dataset.players.filter(p => matchesFilters(p, filters))), [dataset.players, filters]);
  const ranks = useMemo(() => {
    const out = [];
    filtered.forEach((p, i) => out.push(i > 0 && p.rating === filtered[i - 1].rating ? out[i - 1] : i + 1));
    return out;
  }, [filtered]);
  const standing = useMemo(() => (player ? playerStanding(dataset.players, player, active) : null), [dataset.players, player, active]);
  const activeLabel = active ? ACTIVITY_OPTIONS.find(o => o.id === active)?.label : null;
  const description = describe(filters, filtered.length);
  const comparePool = useMemo(() => dataset.players.filter(p => p.id !== view.player), [dataset.players, view.player]);

  const selectPlayer = p => {
    update({ player: p.id, compare: p.id === view.compare ? '' : view.compare });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead__ball" aria-hidden="true">🏓</div>
        <div>
          <h1>TTCAN Ratings</h1>
          <p className="masthead__tagline">Find your rating, see how you’re improving, and cheer on your friends!</p>
          {dataset.period && (
            <p className="muted small">Rating period {dataset.period} · Updated {formatMonth(dataset.generatedAt?.slice(0, 10))}</p>
          )}
        </div>
      </header>

      {dataset.status === 'loading' && <p className="muted loading" role="status">Loading players…</p>}
      {dataset.status === 'error' && (
        <p className="notice notice--error" role="alert">Couldn’t load the ratings ({dataset.error}). Please try again later.</p>
      )}

      {dataset.status === 'ready' && (
        <main>
          <PlayerSearch players={dataset.players} onSelect={selectPlayer} label="Find a player" placeholder="Type a name, like yours!" />

          {player && (
            <PlayerCard
              player={player}
              standing={standing}
              activeLabel={activeLabel}
              history={history}
              compare={comparePlayer ? { player: comparePlayer, history: compareHistory } : null}
              players={comparePool}
              range={view.range}
              isMobile={isMobile}
              onClose={() => update({ player: '', compare: '' })}
              onCompare={p => update({ compare: p.id })}
              onClearCompare={() => update({ compare: '' })}
              onRange={range => update({ range })}
            />
          )}

          <Filters filters={filters} provinces={provinces} onChange={update} />
          <Distribution players={filtered} selected={player} description={description} compact={isMobile} />
          <Leaderboard players={filtered} ranks={ranks} selectedId={player?.id} description={description} onSelect={selectPlayer} />
        </main>
      )}

      <footer className="footer muted small">
        Data from the <a href="http://96.31.42.60/rating.aspx" target="_blank" rel="noreferrer">Table Tennis Canada rating system</a>,
        refreshed when a new rating period is published. Not an official TTCAN site.
      </footer>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) { console.error('UI error', error, info); }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <p className="notice notice--error" role="alert">
            Something went wrong.{' '}
            <button type="button" className="link-button" onClick={() => window.location.reload()}>Reload the page</button>
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AppWithErrorBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>;
}
