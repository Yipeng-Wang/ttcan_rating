import React from 'react';
import { GENDERS, PROVINCES, RANGE_OPTIONS, formatMonth, formatNumber, latestChange, topPercent } from '../data';
import HistoryChart from './HistoryChart';
import PlayerSearch from './PlayerSearch';
import { Segmented } from './Filters';

function Delta({ change }) {
  if (!change || change.delta === 0) {
    return change ? <span className="delta">No change since {formatMonth(change.since)}</span> : null;
  }
  const up = change.delta > 0;
  return (
    <span className={`delta ${up ? 'delta--up' : 'delta--down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {up ? '+' : '−'}{Math.abs(change.delta)}
      <span className="delta__since"> since {formatMonth(change.since)}</span>
    </span>
  );
}

export default function PlayerCard({
  player, standing, activeLabel, history, compare, players, range, isMobile,
  onClose, onCompare, onClearCompare, onRange,
}) {
  const change = history.status === 'ready' ? latestChange(history.data) : null;
  const canada = standing.scopes[0];
  const percent = standing.inPool ? topPercent(canada.rank, canada.total) : null;
  const meta = [
    PROVINCES[player.province] || player.province,
    GENDERS[player.gender],
    player.age != null ? `Age ${player.age}` : null,
    `Last played ${formatMonth(player.lastPlayed)}`,
  ].filter(Boolean);

  const series = history.status === 'ready' && history.data.length
    ? [{ name: player.name, history: history.data },
       ...(compare && compare.history.status === 'ready' && compare.history.data.length
         ? [{ name: compare.player.name, history: compare.history.data }] : [])]
    : null;

  return (
    <section className="card player-card" aria-labelledby="player-name">
      <header className="player-card__head">
        <div>
          <h2 id="player-name">{player.name}</h2>
          <p className="muted">{meta.join(' · ')}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close player">×</button>
      </header>

      <div className="tiles">
        <div className="tile tile--hero">
          <div className="tile__label">Rating</div>
          <div className="tile__value">{formatNumber(player.rating)}</div>
          <Delta change={change} />
        </div>
        {standing.inPool ? standing.scopes.map(s => (
          <div className="tile" key={s.id}>
            <div className="tile__label">Rank · {s.label}</div>
            <div className="tile__value">#{formatNumber(s.rank)}</div>
            <div className="tile__sub">of {formatNumber(s.total)}</div>
          </div>
        )) : (
          <div className="tile tile--note">
            <div className="tile__label">Rank</div>
            <div className="tile__sub">Not ranked: hasn’t played in the last {activeLabel}.</div>
          </div>
        )}
        {percent != null && (
          <div className="tile">
            <div className="tile__label">Percentile</div>
            <div className="tile__value">Top {percent}%</div>
            <div className="tile__sub">of players in Canada</div>
          </div>
        )}
      </div>
      {activeLabel && standing.inPool && <p className="muted small">Ranks count players who played in the last {activeLabel}.</p>}

      <div className="history">
        <div className="history__head">
          <h3>Rating history</h3>
          <Segmented label="Show" options={RANGE_OPTIONS} value={range} onChange={onRange} />
        </div>

        {history.status === 'loading' && <p className="muted chart-empty">Loading history…</p>}
        {history.status === 'error' && <p className="notice notice--error" role="alert">Couldn’t load rating history. {history.error}</p>}
        {history.status === 'ready' && !history.data.length && <p className="muted chart-empty">No rating history since 2011.</p>}
        {series && <HistoryChart series={series} range={range} compact={isMobile} />}

        <div className="compare">
          {compare ? (
            <p className="compare__current">
              Comparing with <strong>{compare.player.name}</strong>
              {compare.history.status === 'loading' && ' (loading…)'}
              {compare.history.status === 'ready' && !compare.history.data.length && ' (no history)'}
              <button type="button" className="link-button" onClick={onClearCompare}>Remove</button>
            </p>
          ) : (
            <PlayerSearch players={players} onSelect={onCompare} size="small" placeholder="Compare with another player" />
          )}
          {compare?.history.status === 'error' && <p className="notice notice--error" role="alert">Couldn’t load {compare.player.name}’s history. {compare.history.error}</p>}
        </div>
      </div>
    </section>
  );
}
