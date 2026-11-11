const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prerender } = require('./prerender.cjs');

function fixture(t, change = x => x) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttcan-seo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><title>TTCAN</title></head><body><div id="root"></div><script src="app.js"></script></body></html>');
  const doc = change({ period: '428', generatedAt: '2026-11-05T22:27:20Z', players: [
    { id: '3', name: 'Third', province: 'QC', rating: 900 },
    { id: '2', name: 'Second', province: 'BC', rating: 1000 },
    { id: '1', name: 'First', province: 'ON', rating: 1000 },
  ] });
  fs.writeFileSync(path.join(dir, 'data/players.json'), JSON.stringify(doc));
  return dir;
}

test('build produces visible rankings with tie-aware ranks, metadata and a canonical-only sitemap', t => {
  const dir = fixture(t);
  prerender(dir);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /<h1>TTCAN Rankings &amp; Player Ratings<\/h1>/);
  assert.match(html, /Rating period 428/);
  assert.match(html, /2026-11-05/);
  assert.match(html, /<td[^>]*>1<\/td>.*First/);
  assert.match(html, /<td[^>]*>1<\/td>.*Second/);
  assert.match(html, /<td[^>]*>3<\/td>.*Third/);
  assert.ok(html.indexOf('First') < html.indexOf('Second'));
  assert.match(html, /<script src="app.js"><\/script>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/yipeng-wang.github.io\/ttcan_rating\/"/);
  assert.match(html, /<meta name="description" content="Search TTCAN/);
  assert.match(html, /<title>TTCAN Rankings &amp; Player Ratings \| Canadian Table Tennis<\/title>/);
  assert.match(html, /Not an official TTCAN site/);
  const sitemap = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8');
  assert.equal((sitemap.match(/<loc>/g) || []).length, 1);
  assert.match(sitemap, /<loc>https:\/\/yipeng-wang.github.io\/ttcan_rating\/<\/loc>/);
  assert.ok(!sitemap.match(/<loc>(.*?)<\/loc>/)[1].includes('?'));
});

test('escapes source text and limits the snapshot to ten players', t => {
  const dir = fixture(t, doc => ({ ...doc, players: Array.from({ length: 12 }, (_, i) => ({
    id: String(i), name: i === 0 ? '<script>alert("x")</script> & player' : `Player ${i}`,
    province: '<ON>', rating: 2000 - i,
  })) }));
  prerender(dir);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>alert'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;ON&gt;/);
  assert.ok(!html.includes('Player 10'));
  assert.match(html, /12 players/);
});

test('rejects malformed data instead of publishing misleading rankings', t => {
  for (const change of [doc => ({ ...doc, players: [] }), doc => ({ ...doc, period: '' }),
    doc => ({ ...doc, generatedAt: 'unknown' }),
    doc => ({ ...doc, players: [{ id: '1', name: 'Bad', rating: 'unknown' }] })]) {
    const dir = fixture(t, change);
    const original = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.throws(() => prerender(dir));
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), original);
    assert.ok(!fs.existsSync(path.join(dir, 'sitemap.xml')));
  }
});

test('fails when the expected empty application root is missing', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body>changed template</body></html>');
  assert.throws(() => prerender(dir), /root/);
});

test('preserves account verification tags while replacing existing metadata once', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</head>',
    '<meta name="google-site-verification" content="test-token"/><meta name="msvalidate.01" content="bing-token"/><meta name="description" content="old"/><link rel="canonical" href="https://old.example/"/></head>'));
  prerender(dir);
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /name="google-site-verification" content="test-token"/);
  assert.match(html, /name="msvalidate.01" content="bing-token"/);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(!html.includes('https://old.example/'));
});
