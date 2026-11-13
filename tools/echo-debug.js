// Focused look at single Echo items on a build, with or without ER. usage: node tools/echo-debug.js <live|beta> <er|noer>
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BUILDS = { live: 'https://www.bondageprojects.elementfx.com/R133/BondageClub/', beta: 'https://www.bondageprojects.elementfx.com/R133/2684902840521/' };
const [build, mode] = process.argv.slice(2);
(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	if (mode === 'er') await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(BUILDS[build], { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && typeof Player !== 'undefined' && !!Player, { timeout: 120000 });
	await page.evaluate(() => { window.ServerSend = () => {}; });
	const before = await page.evaluate(() => Asset.length);
	await page.evaluate(() => { const el = document.createElement('script'); el.type = 'module'; el.src = 'https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js'; document.head.appendChild(el); });
	await page.waitForFunction((n) => Asset.length > n + 1000, { timeout: 60000 }, before);
	await new Promise((r) => setTimeout(r, 3000));
	const res = await page.evaluate(() => {
		const out = {};
		const C = CharacterLoadNPC('NPC_ERDebug');
		CharacterAppearanceSetDefault(C);
		// 1. The logo marking that still loses options
		{
			const a = Asset.find((x) => x.Group.Name === 'BodyMarkings' && x.Name === '标志纹饰');
			InventoryWear(C, a.Name, a.Group.Name);
			const item = InventoryGet(C, a.Group.Name);
			const data = ExtendedItemGetData(a, ExtendedArchetype.MODULAR);
			out.modules = data.modules.map((m) => `${m.Key}:${m.Options.length}`).join(' ');
			const want = { p: 17, b: 1 };
			ExtendedItemSetOptionByRecord(C, item, want, { push: false, refresh: false });
			out.logoPB = JSON.stringify(InventoryGet(C, a.Group.Name).Property.TypeRecord);
			ExtendedItemSetOptionByRecord(C, InventoryGet(C, a.Group.Name), { p: 17 }, { push: false, refresh: false });
			out.logoP = JSON.stringify(InventoryGet(C, a.Group.Name).Property.TypeRecord);
			const opt = data.modules.find((m) => m.Key === 'p').Options[17];
			out.p17 = JSON.stringify({ prereq: opt.Prerequisite, prop: opt.Property, hasSub: !!opt.ArchetypeData });
			out.validate = JSON.stringify(PropertyData.TypeRecord.validate?.({ p: 17, b: 1 }, { asset: a, C }) ?? 'n/a');
			InventoryRemove(C, a.Group.Name, false);
		}
		// 2. The womb tattoo item that throws with ER
		{
			const a = Asset.find((x) => x.Group.Name === 'ItemPelvis' && x.Name === '淫纹');
			try {
				InventoryWear(C, a.Name, a.Group.Name);
				out.tattooWorn = JSON.stringify({ color: InventoryGet(C, a.Group.Name).Color, prop: InventoryGet(C, a.Group.Name).Property });
				const item = InventoryGet(C, a.Group.Name);
				const data = ExtendedItemGetData(a, a.Archetype === 'modular' ? ExtendedArchetype.MODULAR : ExtendedArchetype.TYPED);
				const want = {};
				for (const m of data.modules ?? []) if (m.Options.length > 1) want[m.Key] = m.Options.length - 1;
				out.tattooWant = JSON.stringify(want);
				ExtendedItemSetOptionByRecord(C, item, want, { push: false, refresh: false });
				out.tattooAfter = JSON.stringify(InventoryGet(C, a.Group.Name).Property);
				const bundle = ServerAppearanceBundle(C.Appearance).find((b) => b.Group === 'ItemPelvis');
				out.tattooBundle = JSON.stringify(bundle);
				CharacterLoadOnline({ ID: 'o1', Name: 'O', Nickname: 'O', MemberNumber: 3001, AssetFamily: 'Female3DCG', Appearance: ServerAppearanceBundle(C.Appearance), Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: {}, ArousalSettings: {}, Game: {}, Inventory: [] }, 3001);
				out.tattoo = 'ok';
			} catch (e) {
				out.tattoo = e.stack.split('\n').slice(0, 8).join(' | ');
			}
		}
		return out;
	});
	console.log(build, mode, JSON.stringify(res, null, 1));
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
