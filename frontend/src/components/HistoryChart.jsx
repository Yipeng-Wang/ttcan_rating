import React, { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { RANGE_OPTIONS, formatMonth, formatNumber, mergeHistories, niceTicks, yearTicks } from '../data';

const SERIES = [
  { key: 'a', now: 'aNow', color: 'var(--series-1)' },
  { key: 'b', now: 'bNow', color: 'var(--series-2)' },
];

function ChartTooltip({ active, payload, label, names }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__date">{formatMonth(label)}</div>
      {SERIES.map((s, i) => names[i] && row[s.now] != null && (
        <div className="chart-tooltip__row" key={s.key}>
          <span className="line-key" style={{ background: s.color }} />
          <strong>{formatNumber(row[s.now])}</strong>
          <span className="chart-tooltip__name">{names[i]}</span>
        </div>
      ))}
    </div>
  );
}

function EndDot({ data, dataKey, color }) {
  let last = -1;
  data.forEach((row, i) => { if (row[dataKey] != null) last = i; });
  // eslint-disable-next-line react/display-name
  return props => {
    if (props.index !== last) return null;
    return <circle cx={props.cx} cy={props.cy} r={6} fill={color} stroke="var(--surface)" strokeWidth={2} key={`end-${dataKey}`} />;
  };
}

export default function HistoryChart({ series, range, compact }) {
  const [main, other] = series;
  const fromTime = useMemo(() => {
    const option = RANGE_OPTIONS.find(o => o.id === range);
    if (!option?.years) return -Infinity;
    const now = new Date();
    return Date.UTC(now.getFullYear() - option.years, now.getMonth(), 1);
  }, [range]);

  const data = useMemo(() => mergeHistories(main.history, other?.history, fromTime), [main.history, other, fromTime]);
  const values = data.flatMap(r => [r.a, r.b]).filter(v => v != null);
  const { domain, ticks } = niceTicks(Math.min(...values), Math.max(...values), compact ? 4 : 5);
  const xTicks = data.length ? yearTicks(data[0].t, data[data.length - 1].t, compact ? 4 : 7) : [];
  const names = [main.name, other?.name];

  if (!data.length) return <p className="muted chart-empty">No rating history in this time range.</p>;
  if (!other && main.history.length === 1) {
    const only = main.history[0];
    return <p className="muted chart-empty">Only one rating on record: {formatNumber(only.rating)} in {formatMonth(only.t)}.</p>;
  }

  return (
    <>
      <div className="chart" style={{ height: compact ? 240 : 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
              ticks={xTicks} tickFormatter={t => new Date(t).getUTCFullYear()}
              stroke="var(--axis)" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickLine={false}
            />
            <YAxis
              domain={domain} ticks={ticks} tickFormatter={formatNumber} width={48}
              axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            />
            <Tooltip content={<ChartTooltip names={names} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
            {SERIES.slice(0, other ? 2 : 1).map(s => (
              <Line
                key={s.key} dataKey={s.key} name={s.key} connectNulls type="linear"
                stroke={s.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
                dot={EndDot({ data, dataKey: s.key, color: s.color })}
                activeDot={{ r: 6, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {other && (
        <ul className="legend" aria-label="Legend">
          {series.map((s, i) => (
            <li key={s.name + i}><span className="line-key" style={{ background: SERIES[i].color }} />{s.name}</li>
          ))}
        </ul>
      )}
      <details className="table-view">
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Period</th>{names.filter(Boolean).map((n, i) => <th key={i} className="num">{n}</th>)}</tr></thead>
            <tbody>
              {[...data].reverse().map(r => (
                <tr key={r.t}>
                  <td>{formatMonth(r.t)}</td>
                  <td className="num">{r.a != null ? formatNumber(r.a) : '—'}</td>
                  {other && <td className="num">{r.b != null ? formatNumber(r.b) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
