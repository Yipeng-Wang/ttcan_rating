import React, { useMemo, useState } from 'react';
import { formatNumber } from '../data';
import {
  RULES_URL, exchangeTable, leavesTemporary, matchPoints, temporaryRating,
} from '../rating';
import PlayerSearch from './PlayerSearch';
import { Segmented } from './Filters';

const STAR_OPTIONS = [1, 2, 3, 4].map(n => ({ id: String(n), label: '★'.repeat(n) }));
const MODE_OPTIONS = [
  { id: 'rated', label: 'I have a rating' },
  { id: 'new', label: 'I’m new' },
];
const STATUS_LABELS = { rated: 'Rated', temporary: 'Temporary (T)', unrated: 'Unrated' };

let nextKey = 1;
const newMatch = () => ({ key: nextKey++, name: '', id: null, rating: '', status: 'rated', won: true });

function parseRating(text) {
  const n = Number(String(text).replace(/[^\d]/g, ''));
  return String(text).trim() !== '' && Number.isFinite(n) && n > 0 && n < 5000 ? n : null;
}

function signed(n) {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${formatNumber(Math.abs(n))}`;
}

function OpponentRow({ match, index, players, myRating, stars, mode, onChange, onRemove, canRemove }) {
  const rating = parseRating(match.rating);
  const ready = match.status === 'unrated' || rating != null;
  const result = mode === 'rated' && myRating != null && ready
    ? matchPoints({ myRating, opponentRating: rating ?? 0, won: match.won, stars, opponentStatus: match.status })
    : null;

  return (
    <li className="calc-match">
      <div className="calc-match__num" aria-hidden="true">{index + 1}</div>
      <div className="calc-match__who">
        {match.name ? (
          <p className="calc-match__name">
            <strong>{match.name}</strong>
            <button type="button" className="link-button" onClick={() => onChange({ name: '', id: null })}>change</button>
          </p>
        ) : (
          <PlayerSearch
            players={players}
            size="small"
            placeholder="Opponent’s name (optional)"
            onSelect={p => onChange({ name: p.name, id: p.id, rating: String(p.rating), status: p.provisional ? 'temporary' : 'rated' })}
          />
        )}
        <div className="calc-match__fields">
          <label className="filter">
            <span className="filter__label">Their rating</span>
            <input
              className="calc-input" inputMode="numeric" placeholder="e.g. 1450"
              value={match.rating} disabled={match.status === 'unrated'}
              onChange={e => onChange({ rating: e.target.value })}
              aria-label={`Match ${index + 1} opponent rating`}
            />
          </label>
          <label className="filter">
            <span className="filter__label">Their rating is</span>
            <select value={match.status} onChange={e => onChange({ status: e.target.value })} aria-label={`Match ${index + 1} opponent status`}>
              {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <div className="filter">
            <span className="filter__label" id={`result-${match.key}`}>Result</span>
            <div className="segmented segmented--result" role="radiogroup" aria-labelledby={`result-${match.key}`}>
              <button type="button" role="radio" aria-checked={match.won} className={match.won ? 'is-selected is-win' : ''} onClick={() => onChange({ won: true })}>I won</button>
              <button type="button" role="radio" aria-checked={!match.won} className={!match.won ? 'is-selected is-loss' : ''} onClick={() => onChange({ won: false })}>I lost</button>
            </div>
          </div>
        </div>
      </div>
      <div className="calc-match__points" aria-live="polite">
        {result ? (
          <>
            <span className={`calc-points ${result.points > 0 ? 'is-up' : result.points < 0 ? 'is-down' : ''}`}>{signed(result.points)}</span>
            <span className="calc-reason">{result.reason}</span>
          </>
        ) : (
          <span className="calc-reason">
            {mode === 'new' ? (match.won ? 'Win' : 'Loss') : myRating == null ? 'Enter your rating' : 'Enter their rating'}
          </span>
        )}
      </div>
      {canRemove && (
        <button type="button" className="icon-button calc-match__remove" onClick={onRemove} aria-label={`Remove match ${index + 1}`}>×</button>
      )}
    </li>
  );
}

function TableView({ stars }) {
  const label = '★'.repeat(stars);
  const range = r => (r.to === Infinity ? `${r.from}+` : `${r.from}–${r.to}`);
  return (
    <details className="table-view calc-tables">
      <summary>See the points table for {label} events</summary>
      <div className="calc-tables__grid">
        {[['expected', 'Higher-rated player wins (expected)'], ['upset', 'Lower-rated player wins (upset)']].map(([kind, title]) => (
          <table key={kind}>
            <caption>{title}</caption>
            <thead><tr><th>Rating gap</th><th className="num">Winner</th><th className="num">Loser</th></tr></thead>
            <tbody>
              {exchangeTable(stars, kind).map(r => (
                <tr key={r.from}><td>{range(r)}</td><td className="num">{signed(r.winner)}</td><td className="num">{signed(r.loser)}</td></tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </details>
  );
}

export default function Calculator({ players, initialPlayer }) {
  const [mode, setMode] = useState('rated');
  const [me, setMe] = useState(() => (initialPlayer
    ? { name: initialPlayer.name, rating: String(initialPlayer.rating), provisional: initialPlayer.provisional }
    : { name: '', rating: '', provisional: false }));
  const [stars, setStars] = useState('2');
  const [matches, setMatches] = useState(() => [newMatch(), newMatch(), newMatch()]);

  const myRating = parseRating(me.rating);
  const starCount = Number(stars);
  const opponents = useMemo(() => players.filter(p => p.name !== me.name), [players, me.name]);

  const update = (key, patch) => setMatches(ms => ms.map(m => (m.key === key ? { ...m, ...patch } : m)));
  const remove = key => setMatches(ms => ms.filter(m => m.key !== key));

  const counted = matches.filter(m => m.status === 'unrated' || parseRating(m.rating) != null);
  const wins = counted.filter(m => m.won).length;
  const losses = counted.length - wins;

  let summary = null;
  if (mode === 'rated' && myRating != null && counted.length) {
    const total = counted.reduce((sum, m) => sum + matchPoints({
      myRating, opponentRating: parseRating(m.rating) ?? 0, won: m.won, stars: starCount, opponentStatus: m.status,
    }).points, 0);
    summary = { kind: 'rated', total, newRating: myRating + total };
  } else if (mode === 'new') {
    const rated = counted.filter(m => m.status !== 'unrated');
    const t = temporaryRating(
      rated.filter(m => m.won).map(m => parseRating(m.rating)),
      rated.filter(m => !m.won).map(m => parseRating(m.rating)),
    );
    if (t) summary = { kind: 'new', ...t };
  }

  return (
    <div className="calculator">
      <section className="card" aria-labelledby="calc-title">
        <div className="card__head">
          <h2 id="calc-title"><span aria-hidden="true">🧮</span> Rating calculator</h2>
          <p className="muted">Work out how many points you win or lose at a tournament, using the official TTCAN points tables.</p>
        </div>

        <div className="calc-setup">
          <Segmented label="Your rating" options={MODE_OPTIONS} value={mode} onChange={setMode} />

          {mode === 'rated' && (
            <div className="calc-me">
              {me.name ? (
                <p className="calc-match__name">
                  <strong>{me.name}</strong>
                  <button type="button" className="link-button" onClick={() => setMe({ name: '', rating: me.rating, provisional: false })}>change</button>
                </p>
              ) : (
                <PlayerSearch
                  players={players}
                  size="small"
                  placeholder="Find yourself (optional)"
                  onSelect={p => setMe({ name: p.name, rating: String(p.rating), provisional: p.provisional })}
                />
              )}
              <label className="filter">
                <span className="filter__label">Your rating going into the tournament</span>
                <input
                  className="calc-input calc-input--big" inputMode="numeric" placeholder="e.g. 1500"
                  value={me.rating} onChange={e => setMe({ ...me, rating: e.target.value })}
                />
              </label>
              {me.provisional && (
                <p className="muted small">Your rating is temporary (T). Until it becomes regular, TTCAN works it out from your wins and losses, so try “I’m new” too.</p>
              )}
            </div>
          )}
          {mode === 'new' && (
            <p className="muted small calc-new-note">
              New players get a temporary (T) rating worked out from their first results. Enter who you played below.
            </p>
          )}

          <div className="calc-stars">
            <Segmented label="Tournament stars" options={STAR_OPTIONS} value={stars} onChange={setStars} />
            <p className="muted small">Ask the organizer if you’re not sure. Bigger events (more stars) move more points.</p>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="calc-matches-title">
        <div className="card__head">
          <h2 id="calc-matches-title"><span aria-hidden="true">🏓</span> Your matches</h2>
          <p className="muted">Pick an opponent by name to fill in their rating, or type it in.</p>
        </div>
        <ol className="calc-matches">
          {matches.map((m, i) => (
            <OpponentRow
              key={m.key}
              match={m}
              index={i}
              players={opponents}
              myRating={myRating}
              stars={starCount}
              mode={mode}
              onChange={patch => update(m.key, patch)}
              onRemove={() => remove(m.key)}
              canRemove={matches.length > 1}
            />
          ))}
        </ol>
        <button type="button" className="button calc-add" onClick={() => setMatches(ms => [...ms, newMatch()])}>+ Add a match</button>
      </section>

      <section className="card calc-summary" aria-labelledby="calc-summary-title" aria-live="polite">
        <h2 id="calc-summary-title"><span aria-hidden="true">✨</span> Result</h2>
        {!summary && <p className="muted">{mode === 'rated' && myRating == null ? 'Enter your rating to see the result.' : 'Add a match with a rating to see the result.'}</p>}
        {summary?.kind === 'rated' && (
          <div className="tiles">
            <div className={`tile ${summary.total >= 0 ? 'tile--best' : 'tile--better'}`}>
              <div className="tile__label">Points {summary.total >= 0 ? 'won' : 'lost'}</div>
              <div className={`tile__value ${summary.total > 0 ? 'is-up' : summary.total < 0 ? 'is-down' : ''}`}>{signed(summary.total)}</div>
              <div className="tile__sub">{wins} {wins === 1 ? 'win' : 'wins'}, {losses} {losses === 1 ? 'loss' : 'losses'}</div>
            </div>
            <div className="tile tile--hero">
              <div className="tile__label">New rating</div>
              <div className="tile__value">{formatNumber(summary.newRating)}</div>
              <div className="tile__sub">from {formatNumber(myRating)}</div>
            </div>
          </div>
        )}
        {summary?.kind === 'new' && (
          <div className="tiles">
            <div className="tile tile--hero">
              <div className="tile__label">Temporary (T) rating</div>
              <div className="tile__value">{formatNumber(summary.rating)}</div>
              <div className="tile__sub">{summary.reason} (rule {summary.rule})</div>
            </div>
            <div className="tile tile--year">
              <div className="tile__label">Becoming a regular rating</div>
              <div className="tile__value">{leavesTemporary(wins, losses) ? 'Done!' : `${wins}W ${losses}L`}</div>
              <div className="tile__sub">Needs 5 wins and 1 loss, or 15 wins, in total</div>
            </div>
          </div>
        )}
        <p className="muted small calc-footnote">
          Every match uses the ratings going into the tournament. Wins and losses against unrated players don’t count,
          and players can’t lose points to someone with a temporary (T) rating. This is an estimate; the official
          rating comes from TTCAN. <a href={RULES_URL} target="_blank" rel="noreferrer">Read the rules</a>
        </p>
        <TableView stars={starCount} />
      </section>
    </div>
  );
}
