import React from 'react';
import {
  GENDERS, PROVINCES, betterThanPercent, formatMonth, formatNumber,
  latestChange, nearbyPlayers, personalBest, rivalGroup, yearChange,
} from '../data';
import GrowthMatches from './GrowthMatches';
import RatingJourney from './RatingJourney';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const GROWTH_MAX_AGE = 13; // "Players who grew like you" is for U13 players
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

function YearTile({ change }) {
  if (!change) return null;
  const { delta } = change;
  const up = delta > 0;
  return (
    <div className="tile tile--year">
      <div className="tile__label"><span aria-hidden="true">📅</span> {change.sinceStart ? 'Since first rated' : 'Past 12 months'}</div>
      <div className={`tile__value ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`}>
        {delta === 0 ? '±0' : `${up ? '+' : '−'}${formatNumber(Math.abs(delta))}`}
      </div>
      <div className="tile__sub">since {formatMonth(change.since)}</div>
    </div>
  );
}

function NearbyPlayers({ group, player, onSelect }) {
  const rows = nearbyPlayers(group.players, player);
  if (rows.length < 2) return null;
  return (
    <div className="nearby">
      <h3><span aria-hidden="true">👋</span> Players near you</h3>
      <p className="muted small">Ranked just above and below in {group.label}</p>
      <ol className="nearby__list">
        {rows.map(({ player: p, rank, isSelf }) => {
          const diff = p.rating - player.rating;
          return (
            <li key={p.id} className={isSelf ? 'is-self' : undefined}>
              <span className="nearby__rank">#{formatNumber(rank)}</span>
              {isSelf ? <span className="nearby__name">{p.name}</span> : (
                <button type="button" className="player-link nearby__name" onClick={() => onSelect(p)}>{p.name}</button>
              )}
              <span className="nearby__rating">{formatNumber(p.rating)}</span>
              <span className="nearby__diff">
                {isSelf ? 'you' : diff === 0 ? 'tied' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function PlayerCard({
  player, standing, activeLabel, history, allPlayers, playersById, activeFilter, isMobile, onClose, onSelect,
}) {
  const ready = history.status === 'ready';
  const change = ready ? latestChange(history.data) : null;
  const best = ready ? personalBest(history.data) : null;
  // the scraper's 12-month change matches the Fastest climbers table; fall back for newer players
  const pastYear = player.growth != null
    ? { delta: player.growth, since: player.growthSince, sinceStart: false }
    : ready ? yearChange(history.data, player.rating) : null;
  const group = rivalGroup(allPlayers, player, activeFilter);
  const canada = standing.scopes[0];
  const better = standing.inPool ? betterThanPercent(canada.rank, canada.total) : null;
  const meta = [
    PROVINCES[player.province] || player.province,
    GENDERS[player.gender],
    player.age != null ? `Age ${player.age}` : null,
    `Last played ${formatMonth(player.lastPlayed)}`,
  ].filter(Boolean);
  const first = ready && history.data.length ? history.data[0] : null;
  const facts = first
    ? `First rated ${formatMonth(first.date)} · ${formatNumber(history.data.length)} rating ${history.data.length === 1 ? 'period' : 'periods'} on record`
    : null;


  return (
    <section className="card player-card" aria-labelledby="player-name">
      <header className="player-card__head">
        <div>
          <h2 id="player-name">{player.name}</h2>
          <p className="muted">{meta.join(' · ')}</p>
          {facts && <p className="muted small player-card__facts">{facts}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close player">×</button>
      </header>

      <div className="tiles">
        <div className="tile tile--hero">
          <div className="tile__label">
            <span aria-hidden="true">🏓</span> Rating
            {player.provisional && <span className="badge" title="TTCAN marks this rating as temporary until more matches are played">Provisional</span>}
          </div>
          <div className="tile__value">{formatNumber(player.rating)}</div>
          <Change change={change} />
        </div>

        <YearTile change={pastYear} />

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

      <NearbyPlayers group={group} player={player} onSelect={onSelect} />

      {ready && history.data.length > 0 && (player.age != null && player.age <= GROWTH_MAX_AGE
        ? <GrowthMatches player={player} history={history.data} playersById={playersById} onSelect={onSelect} compact={isMobile} />
        : <RatingJourney history={history.data} compact={isMobile} />)}

      {history.status === 'error' && <p className="notice notice--error" role="alert">Couldn’t load rating history. {history.error}</p>}
    </section>
  );
}
