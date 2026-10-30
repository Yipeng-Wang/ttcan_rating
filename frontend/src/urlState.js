// Keeps the selected player, comparison and filters in the address bar so a view can be shared.

const KEYS = ['page', 'player', 'province', 'gender', 'age', 'active'];

export function readUrlState(search = window.location.search) {
  const params = new URLSearchParams(search);
  const state = {};
  for (const key of KEYS) state[key] = params.get(key) || '';
  return state;
}

export function writeUrlState(state) {
  const params = new URLSearchParams(window.location.search);
  for (const key of KEYS) {
    if (state[key]) params.set(key, state[key]);
    else params.delete(key);
  }
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', url);
  }
}
