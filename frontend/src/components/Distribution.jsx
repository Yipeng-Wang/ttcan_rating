import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber, histogram, niceTicks } from '../data';

const BIN = 100;

function BinTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const bin = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__date">Rating {formatNumber(bin.start)}–{formatNumber(bin.end)}</div>
      <div className="chart-tooltip__row"><strong>{formatNumber(bin.count)}</strong><span className="chart-tooltip__name">players</span></div>
    </div>
  );
}

export default function Distribution({ players, selected, description, compact }) {
  const bins = useMemo(() => histogram(players, BIN).map(b => ({ ...b, mid: b.start + BIN / 2 })), [players]);
  if (!bins.length) return null;
  const max = bins[bins.length - 1].end + 1;
  const xTicks = [];
  for (let v = 0; v <= max; v += max > 2500 ? 1000 : 500) xTicks.push(v);
  const { domain, ticks } = niceTicks(0, Math.max(...bins.map(b => b.count)), 4);
  const selectedBin = selected ? Math.floor(selected.rating / BIN) : -1;
  const showMarker = selected && players.some(p => p.id === selected.id);

  return (
    <section className="card" aria-labelledby="dist-title">
      <div className="card__head">
        <h2 id="dist-title"><span aria-hidden="true">📊</span> Where does everyone fit?</h2>
        <p className="muted">{description}{showMarker ? ` · the pin shows ${selected.name}` : ''}</p>
      </div>
      <div className="chart" style={{ height: compact ? 200 : 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: showMarker ? 24 : 8, right: 16, bottom: 4, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="mid" type="number" domain={[0, max]} ticks={xTicks} tickFormatter={formatNumber}
              stroke="var(--axis)" tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            />
            <YAxis domain={domain} ticks={ticks} tickFormatter={formatNumber} width={48} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            <Tooltip content={<BinTooltip />} cursor={{ fill: 'var(--hover-wash)' }} isAnimationActive={false} />
            <Bar dataKey="count" maxBarSize={24} radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {bins.map((b, i) => (
                <Cell key={b.start} fill={showMarker && i !== selectedBin ? 'var(--deemphasis)' : 'var(--series-1)'} />
              ))}
            </Bar>
            {showMarker && (
              <ReferenceLine
                x={selected.rating} stroke="var(--text-primary)" strokeWidth={2}
                label={{
                  value: `📍 ${formatNumber(selected.rating)}`,
                  // keep the label on the chart when the pin is near either edge
                  position: selected.rating > max * 0.88 ? 'insideTopRight' : selected.rating < max * 0.08 ? 'insideTopLeft' : 'top',
                  fill: 'var(--text-primary)', fontSize: 13, fontWeight: 700,
                }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="table-view">
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Rating</th><th className="num">Players</th></tr></thead>
            <tbody>
              {bins.filter(b => b.count).map(b => (
                <tr key={b.start}><td>{formatNumber(b.start)}–{formatNumber(b.end)}</td><td className="num">{formatNumber(b.count)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
