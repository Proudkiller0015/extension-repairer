// Draws one Echo item on a plain character with each option of one module, side by side, on live, with or without ER.
// usage: node tools/render-item.js <Group> <Name> <moduleKey> <er|noer> <out.png>
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const LIVE = 'https://www.bondageprojects.elementfx.com/R134/BondageClub/';
const ECHO = ['https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js', 'https://sugarchain-studio.github.io/echo-activity-ext/bc-activity.js'];
const [group, name, key, mode, out] = process.argv.slice(2);
(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
	page.on('console', (m) => { if (m.type() === 'error' || /mask|stocking/i.test(m.text())) errors.push(m.type() + ' ' + m.text().slice(0, 200)); });
	page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + decodeURIComponent(r.url()).slice(0, 220)); });
	if (mode === 'er') await page.evaluateOnNewDocument(fs.readFileSync(process.env.ER_FILE || path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(LIVE, { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && typeof Player !== 'undefined' && !!Player, { timeout: 120000 });
	await page.evaluate(() => { window.ServerSend = () => {}; });
	const before = await page.evaluate(() => Asset.length);
	for (const src of ECHO) await page.evaluate((s) => { const el = document.createElement('script'); el.type = 'module'; el.src = s; document.head.appendChild(el); }, src);
	await page.waitForFunction((n) => Asset.length > n + 1000, { timeout: 60000 }, before);
	await new Promise((r) => setTimeout(r, 4000));
	await page.evaluate(() => {
		window.__ml = [];
		const m = bcModSdk.registerMod({ name: 'MaskTrace', fullName: 'MaskTrace', version: '1' });
		const log = (tag, list) => { window.__ml.push(tag + ' t' + Math.round(performance.now() / 10000) * 10 + 's ' + list.map((x) => { let st = '?'; try { st = DrawImageCache.get(x.Url).state; } catch (e) {} return st + ' ' + x.Mode + ' p' + x.Priority + ' ' + decodeURIComponent(x.Url).slice(0, 60); }).join(' | ')); };
		m.hookFunction('GLDrawLoadTextureAlphaMask', -1000, (a, n) => { if (Array.isArray(a[5]) && a[5].length) log('GL', a[5]); const r = n(a); return r; });
		window.__raw = [];
		const orig = DrawImageCache.get.bind(DrawImageCache);
		DrawImageCache.get = function (url) {
			if (typeof url === 'string' && /mmask/.test(url) && !/^(https?:|blob:)/.test(url) && window.__raw.length < 6) window.__raw.push(decodeURIComponent(url).slice(-40) + ' <- ' + new Error().stack.split(String.fromCharCode(10)).slice(2, 7).map((l) => l.trim().replace(/https?:\/\/[^ )]*\//g, '')).join(' < '));
			return orig(url);
		};
		m.hookFunction('DrawApplyTextureAlphaMask', -1000, (a, n) => { if (Array.isArray(a[3]) && a[3].length) log('2D', a[3]); return n(a); });
	});
	if (process.env.WAIT_BEFORE_MS) {
		// Draw every option once on a throwaway character, so anything loaded on first use is ready, then wait.
		await page.evaluate((group, name, key) => {
			const a = AssetGet('Female3DCG', group, name);
			const mod = ExtendedItemGetData(a, ExtendedArchetype.MODULAR).modules.find((m) => m.Key === key);
			mod.Options.forEach((o, i) => {
				const W = CharacterLoadNPC('NPC_Warm' + i);
				CharacterAppearanceSetDefault(W);
				InventoryWear(W, name, group);
				ExtendedItemSetOptionByRecord(W, InventoryGet(W, group), { [key]: i }, { push: false, refresh: false });
				CharacterRefresh(W, false, false);
			});
		}, group, name, key);
		await new Promise((r) => setTimeout(r, Number(process.env.WAIT_BEFORE_MS)));
	}
	const count = await page.evaluate((group, name, key) => {
		const a = AssetGet('Female3DCG', group, name);
		const data = ExtendedItemGetData(a, ExtendedArchetype.MODULAR);
		window.__chars = [];
		const mod = data.modules.find((m) => m.Key === key);
		mod.Options.forEach((o, i) => {
			const C = CharacterLoadNPC('NPC_R' + i);
			CharacterAppearanceSetDefault(C);
			for (const it of [...C.Appearance]) if (it.Asset.Group.Category === 'Appearance' && it.Asset.Group.AllowNone && !/^(Hair|Eyes|Mouth|Nipples|Pussy|BodyUpper|BodyLower|Head|Hands|Eyebrows|Fluids|Blush|Emoticon|Height|BodyStyle|Pronouns|EyeShadow)/.test(it.Asset.Group.Name)) InventoryRemove(C, it.Asset.Group.Name, false);
			InventoryWear(C, name, group);
			ExtendedItemSetOptionByRecord(C, InventoryGet(C, group), { [key]: i }, { push: false, refresh: false });
			CharacterRefresh(C, false, false);
			window.__chars.push(C);
			// Record who asks for a redraw of this character, and for which picture.
			window.__redraws ??= [];
			let must = C.MustDraw;
			Object.defineProperty(C, 'MustDraw', {
				configurable: true,
				get: () => must,
				set: (v) => {
					if (v && !must) {
						const st = new Error().stack;
						const from = /_refreshCharactersForImage|wrapped/.test(st) ? (/wrapped/.test(st) ? 'ER late-masks' : 'game image refresh') : 'other';
						window.__redraws.push(`${C.Name.slice(-2)} ${from}`);
					}
					must = v;
				},
			});
		});
		return mod.Options.length;
	}, group, name, key);
	await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS || 8000)));
	const res = await page.evaluate((process_env_FORCE) => {
		const W = 500, H = 1000;
		const c = document.createElement('canvas');
		c.width = W * window.__chars.length;
		c.height = H;
		const ctx = c.getContext('2d');
		ctx.fillStyle = '#888';
		ctx.fillRect(0, 0, c.width, H);
		const datas = [];
		// Whether anything asked for a redraw while we waited, then the game's own redraw of those characters.
		const mustDraw = window.__chars.map((C) => !!C.MustDraw);
		CharacterLoadCanvasAll();
		window.__chars.forEach((C, i) => {
			if (process_env_FORCE) CharacterRefresh(C, false, false);
			ctx.drawImage(C.Canvas, i * W, 0, W, H);
			const one = document.createElement('canvas');
			one.width = W; one.height = H;
			one.getContext('2d').drawImage(C.Canvas, 0, 0, W, H);
			datas.push(one.getContext('2d').getImageData(0, 0, W, H).data);
		});
		const diff = datas.map((d) => { let n = 0; for (let j = 0; j < d.length; j += 4) if (Math.abs(d[j] - datas[0][j]) + Math.abs(d[j + 3] - datas[0][j + 3]) > 30) n++; return n; });
		const tr = window.__chars.map((C) => JSON.stringify(InventoryGet(C, C.Appearance.find((x) => x.Asset.Name === '马油袜')?.Asset.Group.Name ?? 'Suit')?.Property?.TypeRecord));
		return { png: c.toDataURL('image/png'), diff, tr, mustDraw };
	}, !!process.env.FORCE);
	fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
	console.log(mode, 'options', count, 'pixels different from option 0:', res.diff.join(', '), 'records', res.tr.join(' '), 'redraw asked', JSON.stringify(res.mustDraw));
	console.log('errors:', [...new Set(errors)].filter((e) => !/404|Failed to load resource|Dialog_NPC|favicon/.test(e)).slice(0, 12));
	console.log('redraw requests:', JSON.stringify(await page.evaluate(() => { const c = {}; for (const l of window.__redraws || []) c[l] = (c[l] || 0) + 1; return c; })));
	console.log('raw piece requests:', JSON.stringify(await page.evaluate(() => window.__raw), null, 1));
	console.log('mask calls:', JSON.stringify(await page.evaluate(() => { const c = {}; for (const l of window.__ml) { const k = l.replace(/blob:[^ |]*/g, 'blob'); c[k] = (c[k] || 0) + 1; } return c; }), null, 1));
	await browser.close();
})();
