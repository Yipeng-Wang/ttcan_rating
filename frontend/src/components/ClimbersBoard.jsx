import React, { useEffect, useMemo, useState } from 'react';
import { GENDERS, formatMonth, formatNumber } from '../data';

const PAGE = 25;
const MEDALS = { 1: ['🥇', '1st place'], 2: ['🥈', '2nd place'], 3: ['🥉', '3rd place'] };

/** Players ranked by rating gained over the last 12 months (precomputed by the scraper). */
export function rankClimbers(players) {
  const climbers = players
    .filter(p => p.growth != null && !p.provisional)
    .sort((a, b) => b.growth - a.growth || b.rating - a.rating || a.name.localeCompare(b.name));
  const ranks = [];
  climbers.forEach((p, i) => ranks.push(i > 0 && p.growth === climbers[i - 1].growth ? ranks[i - 1] : i + 1));
  return { climbers, ranks };
}

function signed(n) {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${formatNumber(Math.abs(n))}`;
}

function Row({ player, rank, selected, onSelect }) {
  return (
    <tr className={selected ? 'is-selected' : undefined} aria-current={selected ? 'true' : undefined}>
      <td className="num rank">{MEDALS[rank] ? <span className="medal" role="img" aria-label={MEDALS[rank][1]}>{MEDALS[rank][0]}</span> : rank}</td>
      <td className="name">
        <button type="button" className="player-link" onClick={() => onSelect(player)}>{player.name}</button>
        <span className="row-meta">
          {[player.province, GENDERS[player.gender]?.[0], player.age != null ? `age ${player.age}` : null].filter(Boolean).join(' · ')}
          {' · '}{formatNumber(player.rating - player.growth)} → {formatNumber(player.rating)}
        </span>
      </td>
      <td className="col-wide">{player.province || '—'}</td>
      <td className="col-wide num">{player.age ?? '—'}</td>
      <td className="col-wide num">{formatNumber(player.rating - player.growth)}</td>
      <td className="col-wide num">{formatNumber(player.rating)}</td>
      <td className={`num growth-cell ${player.growth > 0 ? 'is-up' : player.growth < 0 ? 'is-down' : ''}`}>{signed(player.growth)}</td>
    </tr>
  );
}

export default function ClimbersBoard({ players, scope, selectedId, onSelect }) {
  const { climbers, ranks } = useMemo(() => rankClimbers(players), [players]);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [players]);

  const since = climbers.reduce((s, p) => (p.growthSince > s ? p.growthSince : s), '');
  const visible = climbers.slice(0, shown);
  const selectedIndex = selectedId ? climbers.findIndex(p => p.id === selectedId) : -1;
  const pinned = selectedIndex >= shown ? climbers[selectedIndex] : null;

  return (
    <section className="card" aria-labelledby="climbers-title">
      <div className="card__head">
        <h2 id="climbers-title"><span aria-hidden="true">🚀</span> Fastest climbers</h2>
        <p className="muted">
          Biggest rating gains in the last 12 months{since ? ` (since about ${formatMonth(since)})` : ''} · {scope} · {formatNumber(climbers.length)} ranked
        </p>
        <p className="muted small">Counts players rated for at least 18 months who played this year. Provisional ratings aren’t ranked.</p>
      </div>
      {climbers.length === 0 ? (
        <p className="muted chart-empty">No one to rank with these filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="board" aria-labelledby="climbers-title">
            <thead>
              <tr>
                <th className="num">#</th><th>Name</th>
                <th className="col-wide">Province</th><th className="col-wide num">Age</th>
                <th className="col-wide num">A year ago</th><th className="col-wide num">Now</th>
                <th className="num">Change</th>
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
      {shown < climbers.length && (
        <div className="board__more">
          <button type="button" className="button" onClick={() => setShown(s => s + PAGE * 2)}>Show more climbers</button>
          <span className="muted small">Showing {formatNumber(shown)} of {formatNumber(climbers.length)}</span>
        </div>
      )}
    </section>
  );
}
