import React, { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMonth, formatNumber, niceTicks, yearTicks } from '../data';

function JourneyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__date">{formatMonth(row.t)}</div>
      <div className="chart-tooltip__row">
        <span className="line-key" style={{ background: 'var(--series-1)' }} />
        <strong>{formatNumber(row.rating)}</strong>
      </div>
    </div>
  );
}

/** A player's own rating over time, shown when "Players who grew like you" isn't (over U13). */
export default function RatingJourney({ history, compact }) {
  const data = history;
  const best = useMemo(() => data.reduce((b, e) => (e.rating > b.rating ? e : b), data[0]), [data]);
  if (data.length < 2) {
    return (
      <div className="journey">
        <h3><span aria-hidden="true">📈</span> Rating journey</h3>
        <p className="muted chart-empty">Only one rating on record so far: {formatNumber(data[0].rating)} in {formatMonth(data[0].t)}.</p>
      </div>
    );
  }
  const values = data.map(e => e.rating);
  const { domain, ticks } = niceTicks(Math.min(...values), Math.max(...values), compact ? 4 : 5);
  const xTicks = yearTicks(data[0].t, data[data.length - 1].t, compact ? 4 : 7);
  const last = data[data.length - 1];

  return (
    <div className="journey">
      <h3><span aria-hidden="true">📈</span> Rating journey</h3>
      <p className="muted small">
        From {formatNumber(data[0].rating)} in {formatMonth(data[0].t)} to {formatNumber(last.rating)} in {formatMonth(last.t)}
        {best.rating > last.rating ? ` · best ever ${formatNumber(best.rating)} in ${formatMonth(best.t)} (★)` : ''}
      </p>
      <div className="chart" style={{ height: compact ? 220 : 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
              ticks={xTicks} tickFormatter={t => new Date(t).getUTCFullYear()}
              stroke="var(--axis)" tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            />
            <YAxis domain={domain} ticks={ticks} tickFormatter={formatNumber} width={48} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            <Tooltip content={<JourneyTooltip />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
            <Line
              dataKey="rating" type="linear" stroke="var(--series-1)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
              dot={false} activeDot={{ r: 6, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false}
            />
            {best.rating > last.rating && (
              <ReferenceDot x={best.t} y={best.rating} r={6} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2}
                label={{ value: '★', position: 'top', fill: 'var(--text-secondary)', fontSize: 14 }} />
            )}
            <ReferenceDot x={last.t} y={last.rating} r={6} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="table-view">
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Period</th><th className="num">Rating</th></tr></thead>
            <tbody>
              {[...data].reverse().map(e => (
                <tr key={e.t}><td>{formatMonth(e.t)}</td><td className="num">{formatNumber(e.rating)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
