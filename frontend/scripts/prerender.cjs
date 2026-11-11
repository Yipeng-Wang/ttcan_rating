// Generate visible HTML for browsers without JavaScript and the first crawler request.
// React replaces this snapshot with the interactive app; no crawler-specific content.
const fs = require('node:fs');
const path = require('node:path');
const copy = require('../src/siteContent');
const { homepage } = require('../package.json');
const canonical = `${homepage.replace(/\/$/, '')}/`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function prerender(buildDir) {
  const indexPath = path.join(buildDir, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const doc = JSON.parse(fs.readFileSync(path.join(buildDir, 'data/players.json'), 'utf8'));
  if (!/^\d+$/.test(String(doc.period || '')) || !Number.isFinite(Date.parse(doc.generatedAt)) ||
      !Array.isArray(doc.players) || doc.players.length === 0 ||
      doc.players.some(p => !p || !/^\d+$/.test(String(p.id)) || typeof p.name !== 'string' ||
        !p.name.trim() || typeof p.rating !== 'number' || !Number.isFinite(p.rating))) {
    throw new Error('Cannot prerender: invalid published ratings data');
  }
  const root = '<div id="root"></div>';
  if (html.split(root).length !== 2) throw new Error('Expected exactly one empty React root in build/index.html');
  if (!/<title>[^<]*<\/title>/.test(html) || !html.includes('</head>')) {
    throw new Error('Expected an HTML head and title in build/index.html');
  }
  const players = [...doc.players].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  let rank = 0;
  const rows = players.slice(0, 10).map((p, i) => {
    if (i === 0 || p.rating !== players[i - 1].rating) rank = i + 1;
    return `<tr><td class="num">${rank}</td><td>${escape(p.name)}</td><td>${escape(p.province || '—')}</td><td class="num">${escape(p.rating.toLocaleString('en-CA'))}</td></tr>`;
  }).join('\n');
  const updated = new Date(doc.generatedAt).toISOString().slice(0, 10);
  const snapshot = `<div id="root"><div class="page">
<header class="masthead"><div><h1>${escape(copy.heading)}</h1><p>${escape(copy.introduction)}</p>
<p>Rating period ${escape(doc.period)} · Data updated <time datetime="${updated}">${updated}</time></p></div></header>
<main><section class="card" aria-labelledby="snapshot-title"><div class="card__head">
<h2 id="snapshot-title">Top players</h2><p>${escape(players.length.toLocaleString('en-CA'))} players · All listed players, all activity</p>
<p>${escape(copy.explanation)}</p></div><div class="table-scroll"><table class="board" aria-labelledby="snapshot-title">
<thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col">Province</th><th scope="col">Rating</th></tr></thead>
<tbody>${rows}</tbody></table></div></section></main>
<footer class="footer"><p>${escape(copy.attribution)}</p><a href="https://ttcanada.ca/canadian-rankings/">Official Table Tennis Canada rankings</a></footer>
</div></div>`;
  // Replace the existing metadata so the built page has one authoritative value each.
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escape(copy.title)}</title>`)
    .replace(/<meta\b[^>]*\bname="description"[^>]*>/gi, '')
    .replace(/<link\b[^>]*\brel="canonical"[^>]*>/gi, '')
    .replace('</head>', `<meta name="description" content="${escape(copy.description)}"/><link rel="canonical" href="${escape(canonical)}"/></head>`)
    .replace(root, () => snapshot);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(canonical)}</loc></url></urlset>\n`;
  fs.writeFileSync(indexPath, html);
  fs.writeFileSync(path.join(buildDir, 'sitemap.xml'), sitemap);
  console.log(`Prerendered period ${doc.period}: ${players.length} players, top ${Math.min(10, players.length)} in HTML`);
}

if (require.main === module) prerender(path.resolve(__dirname, '../build'));
module.exports = { prerender };
