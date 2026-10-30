import React from 'react';
import {
  GENDERS, PROVINCES, RANGE_OPTIONS, betterThanPercent, formatMonth, formatNumber,
  latestChange, nextMilestone, personalBest,
} from '../data';
import HistoryChart from './HistoryChart';
import PlayerSearch from './PlayerSearch';
import { Segmented } from './Filters';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const SCOPE_ICONS = { canada: '🍁', province: '📍', gender: '🏓', age: '⭐' };

function Change({ change }) {
  if (!change) return null;
  if (change.delta === 0) return <span className="change">Same as {formatMonth(change.since)}</span>;
  const up = change.delta > 0;
  return (
    <span className={`change ${up ? 'change--up' : 'change--down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {' '}{up ? 'Up' : 'Down'} {Math.abs(change.delta)} since {formatMonth(change.since)}{up ? ' 🎉' : ''}
    </span>
  );
}

function Milestone({ rating }) {
  const { goal, toGo, progress } = nextMilestone(rating);
  return (
    <div className="tile tile--goal">
      <div className="tile__label"><span aria-hidden="true">🎯</span> Next goal</div>
      <div className="tile__value">{formatNumber(goal)}</div>
      <div className="meter" role="meter" aria-valuemin={goal - 100} aria-valuemax={goal} aria-valuenow={rating} aria-label={`${toGo} points to ${goal}`}>
        <div className="meter__fill" style={{ width: `${Math.max(4, progress * 100)}%` }} />
      </div>
      <div className="tile__sub">{toGo} {toGo === 1 ? 'point' : 'points'} to go</div>
    </div>
  );
}

export default function PlayerCard({
  player, standing, activeLabel, history, compare, players, range, isMobile,
  onClose, onCompare, onClearCompare, onRange,
}) {
  const ready = history.status === 'ready';
  const change = ready ? latestChange(history.data) : null;
  const best = ready ? personalBest(history.data) : null;
  const canada = standing.scopes[0];
  const better = standing.inPool ? betterThanPercent(canada.rank, canada.total) : null;
  const meta = [
    PROVINCES[player.province] || player.province,
    GENDERS[player.gender],
    player.age != null ? `Age ${player.age}` : null,
    `Last played ${formatMonth(player.lastPlayed)}`,
  ].filter(Boolean);

  const series = ready && history.data.length
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
          <div className="tile__label"><span aria-hidden="true">🏓</span> Rating</div>
          <div className="tile__value">{formatNumber(player.rating)}</div>
          <Change change={change} />
        </div>

        <Milestone rating={player.rating} />

        {best && (
          <div className="tile tile--best">
            <div className="tile__label"><span aria-hidden="true">🏆</span> Best ever</div>
            <div className="tile__value">{formatNumber(best.rating)}</div>
            <div className="tile__sub">{best.rating === player.rating ? 'That’s right now!' : `in ${formatMonth(best.date)}`}</div>
          </div>
        )}

        {better != null && (
          <div className="tile tile--better">
            <div className="tile__label"><span aria-hidden="true">💪</span> Better than</div>
            <div className="tile__value">{better}%</div>
            <div className="tile__sub">of players in Canada</div>
          </div>
        )}
      </div>

      <h3 className="ranks__title">Rankings</h3>
      {standing.inPool ? (
        <ul className="ranks">
          {standing.scopes.map(s => (
            <li key={s.id} className={`rank-chip rank-chip--${s.id}`}>
              <span className="rank-chip__icon" aria-hidden="true">{MEDALS[s.rank] || SCOPE_ICONS[s.id]}</span>
              <span className="rank-chip__rank">#{formatNumber(s.rank)}</span>
              <span className="rank-chip__scope">in {s.label} <span className="muted">of {formatNumber(s.total)}</span></span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Not ranked right now: hasn’t played in the last {activeLabel}.</p>
      )}
      {activeLabel && standing.inPool && <p className="muted small">Counting players who played in the last {activeLabel}.</p>}

      <div className="history">
        <div className="history__head">
          <h3><span aria-hidden="true">📈</span> Rating over time</h3>
          <Segmented label="Show" options={RANGE_OPTIONS} value={range} onChange={onRange} />
        </div>

        {history.status === 'loading' && <p className="muted chart-empty">Loading history…</p>}
        {history.status === 'error' && <p className="notice notice--error" role="alert">Couldn’t load rating history. {history.error}</p>}
        {ready && !history.data.length && <p className="muted chart-empty">No rating history yet.</p>}
        {series && <HistoryChart series={series} range={range} compact={isMobile} />}

        <div className="compare">
          {compare ? (
            <p className="compare__current">
              <span aria-hidden="true">🤝</span> Comparing with <strong>{compare.player.name}</strong>
              {compare.history.status === 'loading' && ' (loading…)'}
              {compare.history.status === 'ready' && !compare.history.data.length && ' (no history yet)'}
              <button type="button" className="link-button" onClick={onClearCompare}>Remove</button>
            </p>
          ) : (
            <PlayerSearch players={players} onSelect={onCompare} size="small" placeholder="Compare with a friend or rival…" />
          )}
          {compare?.history.status === 'error' && <p className="notice notice--error" role="alert">Couldn’t load {compare.player.name}’s history. {compare.history.error}</p>}
        </div>
      </div>
    </section>
  );
}
