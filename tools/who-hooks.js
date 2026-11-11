// Which FUSAM add-ons hook or patch a game function. usage: node tools/who-hooks.js <FunctionName>
const name = process.argv[2];
async function get(u) { try { const r = await fetch(u); return r.ok ? r.text() : ''; } catch { return ''; } }
async function collect(u, seen, d = 0) {
	if (seen.has(u) || d > 3) return;
	const t = await get(u); seen.set(u, t);
	for (const m of t.matchAll(/(?:import\s*\(\s*|from\s*|import\s*)["'`](\.{1,2}\/[^"'`]+\.m?js)["'`]/g)) await collect(new URL(m[1], u).href, seen, d + 1);
}
(async () => {
	const manifest = await (await fetch('https://sidiousious.gitlab.io/bc-addon-loader/manifest.json')).json();
	for (const a of manifest.addons || manifest) {
		const v = (a.versions || []).find((x) => x.distribution === 'stable') || (a.versions || [])[0];
		if (!v || !v.source) continue;
		const seen = new Map(); await collect(v.source, seen);
		const all = [...seen.values()].join('\n');
		const re = new RegExp(String.raw`(hookFunction|patchFunction|hook|patch)\w*\(\s*["'` + '`' + String.raw`]${name}["'` + '`' + String.raw`]\s*,\s*(-?\d+|\{)?`, 'g');
		const hits = [...all.matchAll(re)].map((m) => m[1] + (m[2] ? ' p=' + m[2] : ''));
		if (hits.length) console.log(a.id.padEnd(16), hits.join(', '));
	}
})();
