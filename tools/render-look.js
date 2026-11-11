// Draws an exported look (WCE /exportlooks JSON) on a build with Echo loaded, with or without ER.
// usage: node tools/render-look.js <look.json> <live|beta> <er|noer> <out.png>
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BUILDS = { live: 'https://www.bondageprojects.elementfx.com/R133/BondageClub/', beta: 'https://www.bondageprojects.elementfx.com/R133/1970510968540/' };
const [lookFile, build, mode, out] = process.argv.slice(2);
const look = JSON.parse(fs.readFileSync(lookFile, 'utf8'));
const ECHO = ['https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js', 'https://sugarchain-studio.github.io/echo-activity-ext/bc-activity.js'];
(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
	page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load|404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
	const failed = [];
	const imgs = [];
	page.on('response', (r) => {
		const u = decodeURIComponent(r.url());
		if (/前发|单马尾|渐变|广袖|眼睛12|披肩短/.test(u)) imgs.push(r.status() + ' ' + u.slice(0, 220));
		if (r.status() >= 400 && /\.png/.test(u)) failed.push(r.status() + ' ' + u.slice(0, 200));
	});
	page.on('requestfailed', (r) => failed.push('FAIL ' + decodeURIComponent(r.url()).slice(0, 200)));
	await page.evaluateOnNewDocument(() => {
		window.__imgErr = [];
		const orig = console.error;
		console.error = (...a) => {
			try {
				if (String(a[0]).startsWith('Failed to load image') && window.__imgErr.length < 3) {
					const e = a[1] && a[1].err;
					window.__imgErr.push(String(a[0]).slice(0, 120) + ' :: ' + (e ? (e.stack || e.message) : JSON.stringify(a[1])).slice(0, 900));
				}
			} catch {}
			return orig.apply(console, a);
		};
	});
	if (mode === 'er') await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(BUILDS[build], { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && typeof Player !== 'undefined' && !!Player, { timeout: 120000 });
	await page.evaluate(() => { window.ServerSend = () => {}; });
	const before = await page.evaluate(() => Asset.length);
	for (const src of ECHO) await page.evaluate((s) => { const el = document.createElement('script'); el.type = 'module'; el.src = s; document.head.appendChild(el); }, src);
	await page.waitForFunction((n) => Asset.length > n + 1000, { timeout: 60000 }, before);
	await new Promise((r) => setTimeout(r, 4000));
	await page.evaluate(() => {
		window.__trace = [];
		const m = bcModSdk.registerMod({ name: 'ERTrace', fullName: 'trace', version: '1' });
		const log = (s) => { if (window.__trace.length < 60) window.__trace.push(s); };
		m.hookFunction('AssetBaseURL', -1000, (a, n) => { const r = n(a); if (/Luzi/.test(String(a[2]))) log('BaseURL ' + a[2] + ' layer=' + (a[4]?.Name) + ' -> ' + r); return r; });
		m.hookFunction('GLDrawImage', -1000, (a, n) => { if (/Luzi/.test(decodeURIComponent(String(a[0])))) log('GLDrawImage ' + decodeURIComponent(String(a[0])).slice(0, 160)); return n(a); });
		m.hookFunction('DrawImageEx', -1000, (a, n) => { if (/Luzi/.test(decodeURIComponent(String(a[0])))) log('DrawImageEx ' + decodeURIComponent(String(a[0])).slice(0, 160)); return n(a); });
		m.hookFunction('CommonDrawMarkDrawnAsset', -1000, (a, n) => { if (/Luzi/.test(decodeURIComponent(String(a[1])))) log('Mark ' + decodeURIComponent(String(a[1])).slice(0, 160)); return n(a); });
	});
	const info = await page.evaluate((look) => {
		const C = CharacterLoadOnline({ ID: 'look', Name: 'Look', Nickname: 'Look', MemberNumber: 4242, AssetFamily: 'Female3DCG', Appearance: look, Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: {}, ArousalSettings: {}, Game: {}, Inventory: [] }, 4242);
		window.__look = C;
		const got = C.Appearance.map((i) => `${i.Asset.Group.Name}/${i.Asset.Name}`);
		const missing = look.filter((l) => !got.includes(`${l.Group}/${l.Name}`)).map((l) => `${l.Group}/${l.Name}`);
		const op = C.Appearance.filter((i) => i.Property && i.Property.OverridePriority !== undefined).map((i) => `${i.Asset.Name}=${JSON.stringify(i.Property.OverridePriority)}`);
		return { worn: got.length, missing, overridePriority: op };
	}, look);
	await new Promise((r) => setTimeout(r, 6000));
	await page.evaluate(() => CharacterRefresh(window.__look, false));
	await new Promise((r) => setTimeout(r, 6000));
	const png = await page.evaluate(() => {
		const C = window.__look;
		CharacterRefresh(C, false);
		const c = document.createElement('canvas');
		c.width = 500;
		c.height = 1000;
		const ctx = c.getContext('2d');
		ctx.fillStyle = '#222';
		ctx.fillRect(0, 0, 500, 1000);
		ctx.drawImage(C.Canvas, 0, 0, 500, 1000);
		return c.toDataURL('image/png');
	});
	fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
	const layers = await page.evaluate(() => {
		const C = window.__look;
		const byGroup = {};
		for (const l of C.AppearanceLayers || []) { const g = l.Asset.Group.Name; byGroup[g] = (byGroup[g] || 0) + 1; }
		const hidden = C.Appearance.filter((i) => !byGroup[i.Asset.Group.Name]).map((i) => i.Asset.Group.Name + '/' + i.Asset.Name);
		const sample = C.Appearance.find((i) => i.Asset.Group.Name === '新前发_Luzi');
		const vis = sample ? { visible: CharacterAppearanceVisible(C, sample.Asset.Name, sample.Asset.Group.Name), groupDrawn: sample.Asset.Group.Drawable ?? null, layers: sample.Asset.Layer.map((l) => l.Name + ':' + (CharacterAppearanceIsLayerVisible ? CharacterAppearanceIsLayerVisible(C, l, sample.Asset, sample.Property?.TypeRecord) : '?')) } : null;
		return { hidden, vis, bodyStyle: InventoryGet(C, 'BodyStyle')?.Asset.Name };
	});
	console.log(build, mode, 'errors:', errors.slice(0, 5));
	console.log('echo image responses:', imgs.length); for (const l of imgs.slice(0, 8)) console.log('  ', l);
	console.log('cache:', JSON.stringify(await page.evaluate(() => {
		const u = 'https://cdn.jsdelivr.net/gh/SugarChain-Studio/echo-clothing-ext@091d2f4e1dfc8df571a396a6304746dfafa68dbf/resources/Assets/Female3DCG/新后发_Luzi/单马尾1b_左侧.png';
		const gl = typeof GLDrawImageCache !== 'undefined' && GLDrawImageCache;
		const d = typeof DrawImageCache !== 'undefined' && DrawImageCache;
		const keys = gl ? [...gl.cache.keys()].filter((k) => /Luzi/.test(decodeURIComponent(k))).slice(0, 3).map((k) => k.slice(0, 140) + ' ' + gl.cache.get(k).state) : [];
		return { glExists: !!gl, glHas: gl && gl.has(u), glState: gl && gl.cache.get(u)?.state, dHas: d && d.has(u), dState: d && d.cache.get(u)?.state, glKeys: keys, glSize: gl && gl.cache.size, glCanvas: !!window.GLDrawCanvas, webgl: !!(window.GLDrawCanvas && GLDrawCanvas.GL) };
	})));
	console.log('imgErr:'); for (const l of await page.evaluate(() => window.__imgErr)) console.log('  ', l);
	console.log('trace:'); for (const l of await page.evaluate(() => window.__trace)) console.log('  ', l);
	console.log('failed:', failed.length); for (const l of failed.filter((f) => /Luzi|前发|单马尾|渐变|广袖|眼睛|披肩/.test(f)).slice(0, 8)) console.log('  ', l);
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
