// Static scan: which add-ons use game names that R134 removed or whose parameters changed.
// Fetches every FUSAM source (all distributions) and the chunks they import, then counts references.
// usage: node tools/scan.js <globals.json> <out.json> [extra urls...]
const fs = require('fs');
const [globalsFile, outFile, ...extra] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(globalsFile, 'utf8'));
// Names too generic to be meaningful as a text match are skipped.
const removed = g.removed.map((r) => r.name).filter((n) => n.length > 8);
const changed = g.changed.map((c) => c.name);

async function get(url) {
	try {
		const r = await fetch(url, { headers: { 'user-agent': 'ER-scan' } });
		return r.ok ? await r.text() : '';
	} catch {
		return '';
	}
}

async function collect(url, seen, depth = 0) {
	if (seen.has(url) || depth > 3) return;
	const text = await get(url);
	seen.set(url, text);
	const imports = [...text.matchAll(/(?:import\s*\(\s*|from\s*|import\s*)["'`](\.{1,2}\/[^"'`]+\.m?js)["'`]/g)].map((m) => new URL(m[1], url).href);
	for (const i of imports) await collect(i, seen, depth + 1);
}

(async () => {
	const manifest = await (await fetch('https://sidiousious.gitlab.io/bc-addon-loader/manifest.json')).json();
	const targets = [];
	for (const a of manifest.addons || manifest) for (const v of a.versions || []) if (v.source) targets.push({ id: `${a.id}:${v.distribution}`, url: v.source });
	for (const u of extra) targets.push({ id: u, url: u });
	const result = {};
	for (const t of targets) {
		const seen = new Map();
		await collect(t.url, seen);
		const all = [...seen.values()].join('\n');
		const hits = {};
		for (const n of [...removed, ...changed]) {
			const re = new RegExp(`(?<![\\w$.'"])${n}(?![\\w$'"])`, 'g');
			const c = (all.match(re) || []).length;
			if (c) hits[n] = c;
		}
		result[t.id] = { url: t.url, files: seen.size, bytes: all.length, removed: Object.fromEntries(Object.entries(hits).filter(([n]) => removed.includes(n))), changed: Object.fromEntries(Object.entries(hits).filter(([n]) => changed.includes(n))) };
		const r = result[t.id];
		console.log(`${t.id.padEnd(28)} ${String(r.bytes).padStart(8)}B removed: ${JSON.stringify(r.removed)} changed: ${JSON.stringify(r.changed)}`);
	}
	fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
})();
