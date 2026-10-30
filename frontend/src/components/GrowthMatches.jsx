import React, { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber, formatYears, growthPoints, loadPlayerHistory, loadSimilar, niceTicks, ratingAt } from '../data';

const LATER = [1, 2, 3];
const KIND_LABELS = { path: 'Similar climb', level: 'Same rating, same age', near: 'Closest match' };

function useMatches(player) {
  const [state, setState] = useState({ status: 'loading', matches: [] });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', matches: [] });
    loadSimilar(player.id)
      .then(list => Promise.all(list.map(async m => ({ ...m, history: await loadPlayerHistory(m.id) }))))
      .then(
        matches => !cancelled && setState({ status: 'ready', matches }),
        () => !cancelled && setState({ status: 'error', matches: [] }),
      );
    return () => { cancelled = true; };
  }, [player.id]);
  return state;
}

function whoWord(player) {
  return player.gender === 'F' ? 'Girls & women' : player.gender === 'M' ? 'Boys & men' : 'Players';
}

function axisLabel(by, x) {
  return by === 'age' ? `age ${formatYears(x)}` : `${formatYears(x)} years after their first rating`;
}

function GrowthTooltip({ active, payload, label, names, by }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__date">{by === 'age' ? `Age ${formatYears(label)}` : `Year ${formatYears(label)}`}</div>
      {[['a', 'var(--series-1)'], ['b', 'var(--series-2)']].map(([key, color], i) => row[key] != null && (
        <div className="chart-tooltip__row" key={key}>
          <span className="line-key" style={{ background: color }} />
          <strong>{formatNumber(row[key])}</strong>
          <span className="chart-tooltip__name">{names[i]}</span>
        </div>
      ))}
    </div>
  );
}

function GrowthChart({ mine, theirs, now, by, names, compact }) {
  const from = now - 2.5;
  const to = now + 3.25;
  const data = useMemo(() => {
    const xs = [...new Set([...mine, ...theirs].map(p => Math.round(p.x * 100) / 100))]
      .filter(x => x >= from && x <= to).sort((a, b) => a - b);
    return xs.map(x => ({
      x,
      a: mine.find(p => Math.abs(p.x - x) < 0.006)?.rating ?? null,
      b: theirs.find(p => Math.abs(p.x - x) < 0.006)?.rating ?? null,
    }));
  }, [mine, theirs, from, to]);
  const values = data.flatMap(r => [r.a, r.b]).filter(v => v != null);
  const { domain, ticks } = niceTicks(Math.min(...values), Math.max(...values), 4);
  const xTicks = [];
  for (let x = Math.ceil(from); x <= to; x++) xTicks.push(x);

  return (
    <div className="chart" style={{ height: compact ? 220 : 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 20, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="x" type="number" domain={[from, to]} ticks={xTicks} allowDataOverflow
            tickFormatter={x => (by === 'age' ? `Age ${x}` : `Yr ${x}`)}
            stroke="var(--axis)" tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          />
          <YAxis domain={domain} ticks={ticks} tickFormatter={formatNumber} width={48} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
          <Tooltip content={<GrowthTooltip names={names} by={by} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
          <ReferenceLine x={now} stroke="var(--text-muted)" strokeWidth={1} label={{ value: 'Now', position: 'top', fill: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }} />
          <Line dataKey="a" connectNulls stroke="var(--series-1)" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          <Line dataKey="b" connectNulls stroke="var(--series-2)" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: 'var(--series-2)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function GrowthMatches({ player, history, playersById, onSelect, compact }) {
  const { status, matches } = useMatches(player);
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => matches
    .map(m => {
      const other = playersById.get(m.id);
      const theirs = growthPoints(m.history, m.by, other?.birthYear);
      const then = m.rating ?? ratingAt(theirs, m.at);
      if (!other || then == null) return null;
      const later = LATER.map(years => {
        const value = ratingAt(theirs, m.at + years);
        return { years, value, delta: value == null ? null : value - then };
      });
      return { ...m, other, theirs, then, later };
    })
    .filter(Boolean), [matches, playersById]);

  useEffect(() => setOpenId(rows[0]?.id ?? null), [rows]);

  if (status !== 'ready' || !rows.length) return null;
  const open = rows.find(r => r.id === openId) || rows[0];
  const mine = growthPoints(history, open.by, player.birthYear);
  const now = mine.length ? mine[mine.length - 1].x : open.at;
  // slide their path so the matching point lines up with "now"
  const shift = now - open.at;
  const theirsAligned = open.theirs.map(p => ({ ...p, x: p.x + shift }));

  return (
    <div className="growth">
      <h3><span aria-hidden="true">🌱</span> Players who grew like you</h3>
      <p className="muted small">
        {whoWord(player)} who were closest to where you are now, at the same {open.by === 'age' ? 'age' : 'stage'}. Here’s how they kept going.
        Everyone grows differently, so think of it as inspiration, not a prediction.
      </p>

      <div className="growth__list" role="tablist" aria-label="Similar players">
        {rows.map(r => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={r.id === open.id}
            className={`growth__card${r.id === open.id ? ' is-open' : ''}`}
            onClick={() => setOpenId(r.id)}
          >
            <span className="growth__name">{r.other.name}</span>
            <span className="growth__kind">{KIND_LABELS[r.match] || 'Closest match'}</span>
            <span className="growth__then">At {axisLabel(r.by, r.at)}: <strong>{formatNumber(r.then)}</strong></span>
            <span className="growth__later">
              {r.later.every(l => l.value == null) && <span>No later ratings yet</span>}
              {r.later.filter(l => l.value != null).map(l => (
                <span key={l.years} className="growth__step">
                  +{l.years}y <strong>{formatNumber(l.value)}</strong>
                  <span className={l.delta >= 0 ? 'is-up' : 'is-down'}> ({l.delta >= 0 ? '+' : '−'}{formatNumber(Math.abs(l.delta))})</span>
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      <div className="growth__chart" role="tabpanel">
        <GrowthChart mine={mine} theirs={theirsAligned} now={now} by={open.by} names={[player.name, open.other.name]} compact={compact} />
        <ul className="legend" aria-label="Legend">
          <li><span className="line-key" style={{ background: 'var(--series-1)' }} />{player.name}</li>
          <li><span className="line-key" style={{ background: 'var(--series-2)' }} />{open.other.name}</li>
        </ul>
        <button type="button" className="link-button growth__profile" onClick={() => onSelect(open.other)}>
          See {open.other.name}’s full profile
        </button>
      </div>
    </div>
  );
}
