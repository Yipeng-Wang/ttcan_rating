import React, { useEffect, useState } from 'react';
import { GENDERS, formatMonth, formatNumber } from '../data';

const PAGE = 10; // rows shown before "Show more"
const MEDALS = { 1: ['🥇', '1st place'], 2: ['🥈', '2nd place'], 3: ['🥉', '3rd place'] };

function Row({ player, rank, selected, onSelect }) {
  return (
    <tr className={selected ? 'is-selected' : undefined} aria-current={selected ? 'true' : undefined}>
      <td className="num rank">{MEDALS[rank] ? <span className="medal" role="img" aria-label={MEDALS[rank][1]}>{MEDALS[rank][0]}</span> : rank}</td>
      <td className="name">
        <button type="button" className="player-link" onClick={() => onSelect(player)}>{player.name}</button>
        <span className="row-meta">
          {[player.province, GENDERS[player.gender]?.[0], player.age != null ? `age ${player.age}` : null].filter(Boolean).join(' · ')}
          {' · '}{formatMonth(player.lastPlayed)}
        </span>
      </td>
      <td className="col-wide">{player.province || '—'}</td>
      <td className="col-wide">{GENDERS[player.gender] || '—'}</td>
      <td className="col-wide num">{player.age ?? '—'}</td>
      <td className="col-wide">{formatMonth(player.lastPlayed)}</td>
      <td className="num rating">{formatNumber(player.rating)}</td>
    </tr>
  );
}

export default function Leaderboard({ players, ranks, selectedId, description, onSelect }) {
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [players]);

  const visible = players.slice(0, shown);
  const selectedIndex = selectedId ? players.findIndex(p => p.id === selectedId) : -1;
  const pinned = selectedIndex >= shown ? players[selectedIndex] : null;

  return (
    <section className="card" aria-labelledby="board-title">
      <div className="card__head">
        <h2 id="board-title"><span aria-hidden="true">🏆</span> Top players</h2>
        <p className="muted">{description}</p>
      </div>
      {players.length === 0 ? (
        <p className="muted chart-empty">No players match these filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="board" aria-labelledby="board-title">
            <thead>
              <tr>
                <th className="num">#</th><th>Name</th>
                <th className="col-wide">Province</th><th className="col-wide">Gender</th>
                <th className="col-wide num">Age</th><th className="col-wide">Last played</th>
                <th className="num">Rating</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p, i) => <Row key={p.id} player={p} rank={ranks[i]} selected={p.id === selectedId} onSelect={onSelect} />)}
              {pinned && (
                <>
                  <tr className="gap" aria-hidden="true"><td colSpan={7}>⋯</td></tr>
                  <Row player={pinned} rank={ranks[selectedIndex]} selected onSelect={onSelect} />
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
      {shown < players.length && (
        <div className="board__more">
          <button type="button" className="button" onClick={() => setShown(s => s + PAGE * 2)}>Show more players</button>
          <span className="muted small">Showing {formatNumber(shown)} of {formatNumber(players.length)}</span>
        </div>
      )}
    </section>
  );
}
