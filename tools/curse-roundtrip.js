// Why would a BCX curse "undo changes" when nothing changed? Because the item that comes back from the server
// differs from the one the curse saved. For every extended item (and crafted, coloured variants): wear it with
// non-default options, then load the appearance back the way an echo does, and compare with BCX's own rules
// (curses.ts: properties outside CURSE_IGNORED_PROPERTIES with isEqual, colours, the validated craft).
// usage: node tools/curse-roundtrip.js <er|noer> [echo]
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const LIVE = 'https://www.bondageprojects.elementfx.com/R134/BondageClub/';
const MODSDK = 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1.2.0/dist/bcmodsdk.js';
const ECHO = 'https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js';
const [mode, withEcho] = process.argv.slice(2);

(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	if (mode === 'er') await page.evaluateOnNewDocument(fs.readFileSync(process.env.ER_FILE || path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(LIVE, { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && !!Player, { timeout: 120000 });
	await page.evaluate((v) => { window.ServerSend = () => {}; window.__variants = v; }, (process.env.VARIANTS || 'plain,crafted').split(','));
	if ((await page.evaluate(() => typeof bcModSdk)) === 'undefined') await page.addScriptTag({ url: MODSDK });
	const vanillaCount = await page.evaluate(() => Asset.length);
	if (withEcho) {
		await page.evaluate((s) => { const el = document.createElement('script'); el.type = 'module'; el.src = s; document.head.appendChild(el); }, ECHO);
		await page.waitForFunction((n) => Asset.length > n + 1000, { timeout: 60000 }, vanillaCount);
		await new Promise((r) => setTimeout(r, 3000));
	}
	const res = await page.evaluate((vanillaCount) => {
		const IGNORED = new Set([...(window.ValidationModifiableProperties || []), ...(window.CraftingPropertyExclude || [])]);
		const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (typeof CommonDeepEqual === 'function' && CommonDeepEqual(a, b));
		const saved = (p) => { const r = {}; for (const [k, v] of Object.entries(p || {})) { if (k === 'Effect') { const e = (v || []).filter((x) => x !== 'Lock'); if (e.length) r.Effect = e; } else if (!IGNORED.has(k) && v !== undefined) r[k] = JSON.parse(JSON.stringify(v)); } return r; };
		const diffProps = (a, b) => {
			const out = [];
			for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
				if (k === 'Effect') { const x = (a.Effect || []).slice().sort(), y = (b.Effect || []).slice().sort(); if (!isEqual(x, y)) out.push(`Effect ${JSON.stringify(x)} -> ${JSON.stringify(y)}`); continue; }
				if (a[k] === undefined && b[k] === undefined) continue;
				if (typeof a[k] !== typeof b[k] || !isEqual(a[k], b[k])) out.push(`${k} ${JSON.stringify(a[k])?.slice(0, 60)} -> ${JSON.stringify(b[k])?.slice(0, 60)}`);
			}
			return out;
		};
		// BCX 1.1.25's own craft check: CraftingValidate in place, partial, kept unless it is a critical error.
		const vcd = (craft, asset) => {
			if (craft === undefined || craft === null) return undefined;
			const c = JSON.parse(JSON.stringify(craft));
			try { return CraftingValidate(c, asset, false, false, true) > CraftingStatusType.CRITICAL_ERROR ? c : undefined; } catch (e) { return 'threw ' + e.message; }
		};
		const C = CharacterLoadNPC('NPC_Curse');
		CharacterAppearanceSetDefault(C);
		const results = { tested: 0, unstable: [] };
		const assets = Asset.filter((a) => (a.Archetype === 'typed' || a.Archetype === 'modular' || a.Archetype === 'vibrating' || a.Archetype === 'text' || a.Archetype === 'variableheight') && !a.DynamicScriptDraw);
		let n = 0;
		for (const asset of assets) {
			for (const variant of (window.__variants || ['plain', 'crafted'])) {
				try {
					InventoryRemove(C, asset.Group.Name, false);
					InventoryWear(C, asset.Name, asset.Group.Name);
					const item = InventoryGet(C, asset.Group.Name);
					if (!item || item.Asset !== asset) continue;
					// Non-default options.
					if (asset.Archetype === 'modular') {
						const data = ExtendedItemGetData(asset, ExtendedArchetype.MODULAR);
						const want = {};
						for (const m of data?.modules || []) if (m.Options.length > 1) want[m.Key] = m.Options.length - 1;
						if (Object.keys(want).length) ExtendedItemSetOptionByRecord(C, item, want, { push: false, refresh: false });
					} else if (asset.Archetype === 'typed') {
						const data = ExtendedItemGetData(asset, ExtendedArchetype.TYPED);
						if (data && data.options.length > 1) ExtendedItemSetOption(data, C, item, data.options[data.options.length - 1], data.options[0], false, false);
					}
					// A colour of our own on every colourable layer.
					if (asset.ColorableLayerCount > 0) item.Color = Array(asset.ColorableLayerCount).fill('#3366AA');
					if (variant === 'crafted') {
						item.Craft = { Name: 'Curse test', MemberName: 'Rose', MemberNumber: 424242, Description: 'craft', Property: 'Normal', Lock: '', Private: false, Color: '#3366AA', Item: asset.Name, ItemProperty: {}, TypeRecord: item.Property?.TypeRecord ?? null };
					}
					CharacterRefresh(C, false, false);
					const mine = InventoryGet(C, asset.Group.Name);
					const curse = { Property: saved(mine.Property), Color: JSON.parse(JSON.stringify(mine.Color ?? null)), Craft: vcd(mine.Craft, asset) };
					// The echo: the same appearance, bundled and loaded back onto a character.
					const other = CharacterLoadOnline({ ID: 'c' + n, Name: 'O', Nickname: 'O', MemberNumber: 6000 + n, AssetFamily: 'Female3DCG', Appearance: [...ServerAppearanceBundle(C.Appearance)], Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: {}, ArousalSettings: {}, Game: {}, Inventory: [] }, 6000 + n);
					n++;
					const back = InventoryGet(other, asset.Group.Name);
					results.tested++;
					const problems = [];
					if (!back) problems.push('item gone');
					else {
						problems.push(...diffProps(curse.Property, saved(back.Property)));
						const curseColor = curse.Color ? ServerParseColor(asset, curse.Color, asset.Group.ColorSchema) : [...asset.DefaultColor];
						if (typeof itemColorsEquals === 'function' ? !itemColorsEquals(curseColor, back.Color, asset, asset) : !isEqual(curseColor, back.Color)) problems.push(`Color ${JSON.stringify(curseColor).slice(0, 50)} -> ${JSON.stringify(back.Color).slice(0, 50)}`);
						const strip = (o) => o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) : o;
						const c2 = vcd(back.Craft, asset);
						if (!isEqual(strip(curse.Craft), strip(c2))) problems.push(`Craft ${JSON.stringify(strip(curse.Craft)).slice(0, 60)} -> ${JSON.stringify(strip(c2)).slice(0, 60)}`);
					}
					if (problems.length && results.unstable.length < 60) results.unstable.push(`${variant} ${asset.Group.Name}/${asset.Name}${Asset.indexOf(asset) >= vanillaCount ? ' (add-on)' : ''}: ${problems.join('; ')}`);
				} catch (e) {
					if (results.unstable.length < 60) results.unstable.push(`${variant} ${asset.Group.Name}/${asset.Name}: threw ${e.message}`);
				}
			}
		}
		return results;
	}, vanillaCount);
	console.log(mode, withEcho ? '+Echo' : '', `tested ${res.tested}, unstable ${res.unstable.length}`);
	for (const l of res.unstable) console.log('  ', l);
	await browser.close();
})();
