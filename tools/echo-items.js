// Every Echo item with options: pick a non-default option in each module (or the last typed option), then
// check it survives to another player. Compares the build with and without ER.
// usage: node tools/echo-items.js <live|beta> <er|noer> [early]
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BUILDS = { live: 'https://www.bondageprojects.elementfx.com/R133/BondageClub/', beta: 'https://www.bondageprojects.elementfx.com/R133/1970510968540/' };
const [build, mode, early] = process.argv.slice(2);
const ECHO = ['https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js', 'https://sugarchain-studio.github.io/echo-activity-ext/bc-activity.js'];
const MODSDK = 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1.2.0/dist/bcmodsdk.js';

(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
	// "early" = ER the way the userscript loads it (before the page); otherwise ER is added after Echo, like a late start.
	if (mode === 'er' && early) await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(BUILDS[build], { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && typeof Player !== 'undefined' && !!Player, { timeout: 120000 });
	await page.evaluate(() => { window.ServerSend = () => {}; });
	if (typeof (await page.evaluate(() => typeof bcModSdk)) === 'string' && (await page.evaluate(() => typeof bcModSdk)) === 'undefined') await page.addScriptTag({ url: MODSDK });
	const before = await page.evaluate(() => Asset.length);
	for (const src of ECHO) await page.evaluate((s) => { const el = document.createElement('script'); el.type = 'module'; el.src = s; document.head.appendChild(el); }, src);
	await page.waitForFunction((n) => Asset.length > n + 1000, { timeout: 60000 }, before);
	await new Promise((r) => setTimeout(r, 3000));
	if (mode === 'er' && !early) await page.addScriptTag({ path: path.join(__dirname, '..', 'er.js') });
	await new Promise((r) => setTimeout(r, 1500));
	const res = await page.evaluate((before) => {
		const echo = Asset.slice(before).filter((a) => a.Archetype === 'modular' || a.Archetype === 'typed');
		const C = CharacterLoadNPC('NPC_ERTest');
		CharacterAppearanceSetDefault(C);
		const out = { tested: 0, ok: 0, lostMine: [], lostTheirs: [], errors: [] };
		for (const asset of echo) {
			try {
				InventoryWear(C, asset.Name, asset.Group.Name);
				const item = InventoryGet(C, asset.Group.Name);
				if (!item || item.Asset !== asset) continue;
				const data = ExtendedItemGetData(asset, asset.Archetype === 'modular' ? ExtendedArchetype.MODULAR : ExtendedArchetype.TYPED);
				if (!data) continue;
				/** @type {Record<string, number>} */
				const want = {};
				if (asset.Archetype === 'modular') {
					for (const m of data.modules) if (m.Options.length > 1) want[m.Key] = m.Options.length - 1;
				} else if (data.options.length > 1) {
					want[data.name ?? 'typed'] = data.options.length - 1;
				}
				if (!Object.keys(want).length) continue;
				if (asset.Archetype === 'modular') ExtendedItemSetOptionByRecord(C, item, want, { push: false, refresh: false });
				else ExtendedItemSetOption(data, C, item, data.options[data.options.length - 1], data.options[0], false, false);
				const mine = InventoryGet(C, asset.Group.Name)?.Property?.TypeRecord ?? {};
				const bundle = ServerAppearanceBundle(C.Appearance).filter((b) => b.Group === asset.Group.Name);
				const other = CharacterLoadOnline({ ID: 'o' + out.tested, Name: 'O', Nickname: 'O', MemberNumber: 3000 + out.tested, AssetFamily: 'Female3DCG', Appearance: [...ServerAppearanceBundle(C.Appearance)], Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: {}, ArousalSettings: {}, Game: {}, Inventory: [] }, 3000 + out.tested);
				const theirs = InventoryGet(other, asset.Group.Name)?.Property?.TypeRecord ?? {};
				out.tested++;
				const expect = asset.Archetype === 'modular' ? want : null;
				const okMine = expect ? Object.entries(expect).every(([k, v]) => mine[k] === v) : Object.values(mine).some((v) => v > 0);
				const okTheirs = expect ? Object.entries(expect).every(([k, v]) => theirs[k] === v) : Object.values(theirs).some((v) => v > 0);
				if (okMine && okTheirs) out.ok++;
				if (!okMine) out.lostMine.push(`${asset.Group.Name}/${asset.Name} want ${JSON.stringify(want)} got ${JSON.stringify(mine)}`);
				else if (!okTheirs) out.lostTheirs.push(`${asset.Group.Name}/${asset.Name} mine ${JSON.stringify(mine)} theirs ${JSON.stringify(theirs)} bundle ${JSON.stringify(bundle.map((b) => b.Property))}`);
				InventoryRemove(C, asset.Group.Name, false);
			} catch (e) {
				out.errors.push(`${asset.Group.Name}/${asset.Name}: ${e.message}`);
			}
		}
		out.er = window.ER ? ER.chart().filter((c) => c.status !== 'healthy').map((c) => c.status + ':' + c.id) : null;
		return out;
	}, before);
	console.log(`${build} ${mode}${early ? ' early' : ''}: tested ${res.tested}, ok ${res.ok}, lost on wearer ${res.lostMine.length}, lost for others ${res.lostTheirs.length}, errors ${res.errors.length}`);
	console.log('  ER:', JSON.stringify(res.er));
	for (const l of [...res.lostMine.slice(0, 6), ...res.lostTheirs.slice(0, 6), ...res.errors.slice(0, 6)]) console.log('  ', l.slice(0, 400));
	console.log('  page errors:', errors.slice(0, 5));
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
