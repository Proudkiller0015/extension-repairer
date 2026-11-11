// Prints the code around each use of the given names in one add-on (and the chunks it imports).
// usage: node tools/context.js <url> <name,name,...> [chars]
const [url, names, width = '110'] = process.argv.slice(2);
const w = Number(width);
async function get(u) { try { const r = await fetch(u); return r.ok ? r.text() : ''; } catch { return ''; } }
async function collect(u, seen, d = 0) {
	if (seen.has(u) || d > 3) return;
	const t = await get(u); seen.set(u, t);
	for (const m of t.matchAll(/(?:import\s*\(\s*|from\s*|import\s*)["'`](\.{1,2}\/[^"'`]+\.m?js)["'`]/g)) await collect(new URL(m[1], u).href, seen, d + 1);
}
(async () => {
	const seen = new Map(); await collect(url, seen);
	for (const [u, t] of seen) for (const n of names.split(',')) {
		const re = new RegExp(`(?<![\w$.'"])${n}(?![\w$'"])`, 'g');
		for (const m of t.matchAll(re)) console.log(`${n} @${u.split('/').pop()}: ${t.slice(Math.max(0, m.index - w), m.index + n.length + w).replace(/\s+/g, ' ')}\n`);
	}
})();
