import React from 'react';
import { ACTIVITY_OPTIONS, AGE_GROUPS, GENDER_GROUPS, PROVINCES } from '../data';

function Select({ label, value, onChange, children }) {
  return (
    <label className="filter">
      <span className="filter__label">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="filter">
      <span className="filter__label" id={`seg-${label}`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={value === o.id ? 'is-selected' : ''}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Filters({ filters, provinces, onChange }) {
  const set = key => value => onChange({ ...filters, [key]: value });
  const anySet = filters.province || filters.gender || filters.age || filters.active;
  return (
    <div className="filters" role="group" aria-label="Filters">
      <Select label="Province" value={filters.province} onChange={set('province')}>
        <option value="">All provinces</option>
        {provinces.map(code => <option key={code} value={code}>{PROVINCES[code] || code}</option>)}
      </Select>
      <Select label="Who" value={filters.gender} onChange={set('gender')}>
        <option value="">Everyone</option>
        {Object.entries(GENDER_GROUPS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </Select>
      <Select label="Age group" value={filters.age} onChange={set('age')}>
        <option value="">All ages</option>
        {AGE_GROUPS.map(g => <option key={g.id} value={g.id}>{g.label} (age {g.max} or under)</option>)}
      </Select>
      <Segmented label="Played in the last" options={ACTIVITY_OPTIONS} value={filters.active} onChange={set('active')} />
      {anySet && (
        <button type="button" className="link-button filters__reset" onClick={() => onChange({ province: '', gender: '', age: '', active: '' })}>
          Reset filters
        </button>
      )}
    </div>
  );
}
