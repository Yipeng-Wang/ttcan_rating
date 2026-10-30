import React, { useId, useMemo, useRef, useState } from 'react';
import { formatNumber, searchPlayers } from '../data';

/** Accessible combobox for picking a player by name. */
export default function PlayerSearch({ players, onSelect, placeholder = 'Search for a player', label, autoFocus, size = 'large' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef(null);

  const results = useMemo(() => searchPlayers(players, query), [players, query]);
  const showList = open && query.trim().length > 0;

  const choose = player => {
    onSelect(player);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && showList && results[active]) { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className={`search search--${size}`}>
      {label && <label className="search__label" htmlFor={`${listId}-input`}>{label}</label>}
      <div className="search__field">
        <svg className="search__icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" /></svg>
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList && (
        <ul className="search__list" id={listId} role="listbox">
          {results.length === 0 && <li className="search__empty">No one called “{query}” yet. Check the spelling?</li>}
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`search__option${i === active ? ' is-active' : ''}`}
              onMouseDown={e => { e.preventDefault(); choose(p); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="search__name">{p.name}</span>
              <span className="search__meta">
                {[p.province, p.age != null ? `age ${p.age}` : null].filter(Boolean).join(' · ')}
              </span>
              <span className="search__rating">{formatNumber(p.rating)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
