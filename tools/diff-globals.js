// Lists the game's top-level names (var/let/const/function/class) that exist on one build but not the other,
// and functions whose parameter lists changed. usage: node tools/diff-globals.js <out.json>
const fs = require('fs');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BUILDS = { live: 'https://www.bondageprojects.elementfx.com/R133/BondageClub/', beta: 'https://www.bondageprojects.elementfx.com/R133/1970510968540/' };

async function scan(browser, base) {
	const page = await browser.newPage();
	await page.goto(base, { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000, { timeout: 120000 });
	return page.evaluate(async () => {
		const srcs = [...document.scripts].map((s) => s.src).filter((s) => s && s.startsWith(location.origin));
		// Screens are loaded lazily; take every screen script the game knows about too.
		const names = new Set();
		const decl = /^(?:var|let|const|function\*?|async function|class)\s+([A-Za-z_$][\w$]*)/gm;
		const texts = await Promise.all(srcs.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
		for (const t of texts) for (const m of t.matchAll(decl)) names.add(m[1]);
		const out = {};
		for (const n of names) {
			let v;
			try { v = (0, eval)(n); } catch { out[n] = { missing: true }; continue; }
			const t = typeof v;
			out[n] = { type: t, kind: t === 'function' ? (/^class\b/.test(Function.prototype.toString.call(v)) ? 'class' : 'function') : undefined, len: t === 'function' ? v.length : undefined, onWindow: n in window };
			if (t === 'function') {
				const src = Function.prototype.toString.call(v);
				const m = src.match(/^[^(]*\(([^)]*)\)/);
				out[n].params = m ? m[1].replace(/\s+/g, ' ').trim() : '';
			}
		}
		return { version: GameVersion, scripts: srcs.length, names: out };
	});
}

(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const [live, beta] = await Promise.all([scan(browser, BUILDS.live), scan(browser, BUILDS.beta)]);
	const removed = [];
	const changed = [];
	const windowLost = [];
	for (const [n, l] of Object.entries(live.names)) {
		if (l.missing) continue;
		const b = beta.names[n];
		let bv = b;
		if (!b) bv = { missing: true };
		if (bv.missing) removed.push({ name: n, was: l.type, params: l.params });
		else {
			if (l.type === 'function' && bv.type === 'function' && l.params !== bv.params) changed.push({ name: n, live: l.params, beta: bv.params });
			if (l.onWindow && !bv.onWindow) windowLost.push(n);
		}
	}
	const added = Object.keys(beta.names).filter((n) => !beta.names[n].missing && !live.names[n]);
	const res = { live: live.version, beta: beta.version, removed, changed, windowLost, added };
	fs.writeFileSync(process.argv[2], JSON.stringify(res, null, 1));
	console.log(`live ${live.version} (${Object.keys(live.names).length} names, ${live.scripts} scripts) vs beta ${beta.version}: removed ${removed.length}, params changed ${changed.length}, no longer on window ${windowLost.length}, added ${added.length}`);
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
