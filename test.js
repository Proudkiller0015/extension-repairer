// ER in the real game, headless, never logged in. R134 went live on 18 Nov 2026, so the checks that were run
// on the beta run on live now; there is no R133 left to check that ER leaves alone. Run: node test.js
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const BUILDS = {
	live: 'https://www.bondageprojects.elementfx.com/R134/BondageClub/',
};
const MODSDK = 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1.2.0/dist/bcmodsdk.js';
let failed = 0;
const check = (name, ok, got) => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` (got ${JSON.stringify(got)})`}`);
	if (!ok) failed++;
};

async function open(browser, base) {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));
	await page.goto(base, { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && typeof Player !== 'undefined' && !!Player, { timeout: 120000 });
	await page.evaluate(() => { window.ServerSend = () => {}; });
	await page.addScriptTag({ url: MODSDK });
	await page.addScriptTag({ path: path.join(__dirname, 'er.js') });
	await page.waitForFunction(() => window.ER && window.ER.chart().length >= 11, { timeout: 15000 });
	return { page, errors };
}

/** Wears a modular item, picks a non-default option in a later module, and reads it back after a round trip. */
const roundTrip = () => {
	const out = {};
	Player.MemberNumber = 1001;
	CharacterAppearanceSetDefault(Player);
	for (const [group, name, key] of [['ItemDevices', 'BarStool', 'd'], ['ItemHead', 'HypnoticVisor', 'd']]) {
		if (!AssetGet('Female3DCG', group, name)) continue;
		InventoryWear(Player, name, group);
		const item = InventoryGet(Player, group);
		const data = ExtendedItemGetData(item.Asset, ExtendedArchetype.MODULAR);
		const mod = data.modules.find((m) => m.Key === key);
		ExtendedItemSetOption(data, Player, item, mod.Options[2], mod.Options[0], false, true);
		const bundle = ServerAppearanceBundle(Player.Appearance);
		const other = CharacterLoadOnline({ ID: 'x' + name, Name: 'Other', Nickname: 'Other', MemberNumber: 2002, AssetFamily: 'Female3DCG', Appearance: bundle, Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: {}, ArousalSettings: {}, Game: {}, Inventory: [] }, 2002);
		out[name] = { mine: InventoryGet(Player, group).Property?.TypeRecord?.[key], theirs: InventoryGet(other, group)?.Property?.TypeRecord?.[key] };
	}
	return out;
};

(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	try {
		// Live R134: it removed things add-ons use.
		{
			const { page, errors } = await open(browser, BUILDS.live);
			const chart = await page.evaluate(() => Object.fromEntries(ER.chart().map((c) => [c.id, c.status])));
			check('every fix runs without failing', Object.values(chart).every((s) => s !== 'failed'), chart);
			for (const id of ['room-space', 'info-sheet', 'online-profile', 'room-admin', 'controller', 'bcx-curse-loop', 'fetch-request', 'baseline-options', 'saved-settings', 'stacking-init', 'option-rules', 'wce-arousal', 'image-addresses', 'minigame-return', 'late-masks', 'default-color', 'arousal-active', 'item-header', 'view-rebuild']) check(`${id} treated`, chart[id] === 'treated', chart[id]);
			// The game shipped these in R134 Beta 2, so ER's copies stand down.
			for (const id of ['chat-width', 'modular-options']) check(`${id} is gone from ER (the game has it)`, !(id in chart), chart[id]);
			const space = await page.evaluate(() => {
				ChatRoomData = { Space: 'M', Game: 'LARP' };
				const inRoom = [ChatRoomSpace, ChatRoomGame];
				ChatRoomData = null;
				ChatSearchSpace = 'Asylum';
				return { inRoom, lobby: ChatRoomSpace };
			});
			check('ChatRoomSpace/ChatRoomGame follow the room', space.inRoom[0] === 'M' && space.inRoom[1] === 'LARP', space);
			check('ChatRoomSpace follows the lobby outside a room', space.lobby === 'Asylum', space);
			check('InformationSheetSecondScreenRun can be hooked', await page.evaluate(() => {
				const m = bcModSdk.registerMod({ name: 'ERTestHook', fullName: 'x', version: '1' });
				m.hookFunction('InformationSheetSecondScreenRun', 0, (a, n) => n(a));
				return true;
			}), false);
			check('PreferenceArousalIsActive() with no character works', await page.evaluate(() => typeof PreferenceArousalIsActive() === 'boolean'), false);
			const debounce = await page.evaluate(async () => {
				let calls = 0;
				const old = CommonDebounce(() => calls++);
				old(30); old(30); old(30);
				await new Promise((r) => setTimeout(r, 120));
				let calls2 = 0;
				const now = CommonDebounce(30, () => calls2++);
				now(); now();
				await new Promise((r) => setTimeout(r, 120));
				return [calls, calls2];
			});
			check('CommonDebounce old and new forms both debounce', debounce[0] === 1 && debounce[1] === 1, debounce);
			const trip = await page.evaluate(roundTrip);
			check('Bar Stool decal survives to another player', trip.BarStool && trip.BarStool.mine === 2 && trip.BarStool.theirs === 2, trip);
			check('Hypnotic Visor option survives to another player', trip.HypnoticVisor.mine === 2 && trip.HypnoticVisor.theirs === 2, trip);
			const custom = await page.evaluate(() => {
				// An add-on's own setting (AEE Free Draw's CustomDraw, Echo's gradient sliders) on a game item, loaded by another player.
				const a = Asset.find((x) => x.Group.Name === 'Hat' && !x.Extended);
				const bundle = [{ Group: a.Group.Name, Name: a.Name, Property: { CustomDraw: 'drawing', upperBound: 222 } }];
				const other = CharacterLoadOnline({ ID: 'xcustom', Name: 'Other', Nickname: 'Other', MemberNumber: 2003, AssetFamily: 'Female3DCG', Appearance: bundle, Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: {}, ArousalSettings: {}, Game: {}, Inventory: [] }, 2003);
				const p = InventoryGet(other, a.Group.Name)?.Property ?? {};
				return { CustomDraw: p.CustomDraw, upperBound: p.upperBound };
			});
			check('add-on settings on an item survive to another player', custom.CustomDraw === 'drawing' && custom.upperBound === 222, custom);
			const mini = await page.evaluate(async () => {
				// LSCG's sleepy drink: a minigame whose return function is given by name, as before R134.
				window.ERTestGameRun = () => {};
				window.ERTestGameClick = () => {};
				window.ERTestGameLoad = () => {};
				window.ERTestEnd = () => { window.__erEnded = true; };
				const before = CurrentScreen;
				await MiniGameStart('ERTestGame', 5, 'ERTestEnd');
				let error = null;
				try { MiniGameEnd(); } catch (e) { error = e.message; }
				await CommonSetScreen('Character', before === 'Login' ? 'Login' : before);
				return { ended: !!window.__erEnded, error };
			});
			check('a minigame return given by name runs (LSCG sleepy drink)', mini.ended && !mini.error, mini);
			const rules = await page.evaluate(() => {
				// Echo's batons: an option allows an activity the game does not have; R134 strips it and the option puts it back.
				const C = CharacterLoadNPC('NPC_ERRules');
				CharacterAppearanceSetDefault(C);
				const asset = Asset.find((a) => a.Archetype === 'typed' && a.Group.AllowNone && a.Group.Category === 'Item' && (ExtendedItemGetData(a, 'typed')?.options || []).length > 1);
				InventoryWear(C, asset.Name, asset.Group.Name);
				const item = InventoryGet(C, asset.Group.Name);
				const option = ExtendedItemGatherOptions(item)[0];
				option.Property = { ...option.Property, AllowActivity: ['ERTestNoSuchActivity'] };
				item.Property = { ...item.Property, AllowActivity: ['ERTestNoSuchActivity'] };
				ExtendedItemInit(C, item, false, false);
				const again = [1, 2, 3].map(() => ExtendedItemInit(C, item, false, false));
				return { item: asset.Group.Name + '/' + asset.Name, again, kept: item.Property.AllowActivity };
			});
			check('an item whose option names an unknown activity stops counting as changed (Echo batons)', rules.again.every((x) => !x) && rules.kept?.[0] === 'ERTestNoSuchActivity', rules);
			const arousal = await page.evaluate(() => {
				// WCE's Alternate arousal: an activity raises its enjoyment multiplier; the decay tick must set it back to 1.
				const before = { flag: Player.BCEArousal, enjoyment: Player.BCEEnjoyment, settings: JSON.stringify(Player.ArousalSettings) };
				Player.ArousalSettings = { ...(Player.ArousalSettings || {}), Active: 'Hybrid', Progress: 0, ProgressTimer: 0, OrgasmTimer: 0 };
				Player.BCEArousal = true;
				Player.BCEEnjoyment = 6;
				ActivityDecayCharacter(Player);
				const reset = Player.BCEEnjoyment;
				ActivitySetArousalTimer(Player, null, 'ItemArms', 25);
				const timer = Player.ArousalSettings.ProgressTimer;
				Player.BCEArousal = before.flag;
				Player.BCEEnjoyment = before.enjoyment;
				Player.ArousalSettings = JSON.parse(before.settings);
				return { reset, timer };
			});
			check("WCE's Alternate arousal multiplier resets at the decay tick and activities stop at 20", arousal.reset === 1 && arousal.timer === 20, arousal);
			const pictures = await page.evaluate(async () => {
				// Echo's @nomap mark and an encoded space before data: reaching the picture cache directly.
				const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
				const load = (u) => new Promise((res) => { DrawImageCache.get(u); let n = 0; const t = setInterval(() => { const st = DrawImageCache.get(u).state; if (st === 'loaded' || st === 'failed' || ++n > 50) { clearInterval(t); res(st); } }, 100); });
				return { nomap: await load('@nomap/Assets/Female3DCG/Eyes/Eyes1.png'), space: await load('%20' + png) };
			});
			check('pictures marked @nomap or with %20 before data: load', pictures.nomap === 'loaded' && pictures.space === 'loaded', pictures);
			const saved = await page.evaluate(() => {
				// Saving: R134 only bundles names on its allowed list; an add-on's own setting must still go out.
				const a = Asset.find((x) => x.Group.Name === 'Hat' && !x.Extended);
				const item = AppearanceItem.fromAsset(a, { property: { CustomDraw: 'drawing', Text2: 'not for a hat' } });
				const bundle = ServerAppearanceBundle([item])[0];
				return { CustomDraw: bundle.Property?.CustomDraw, Text2: bundle.Property?.Text2 };
			});
			check('an add-on setting is saved; a game setting the game left out of a game item stays out', saved.CustomDraw === 'drawing' && saved.Text2 === undefined, saved);
			const stack = await page.evaluate(() => {
				// R134 added an option's Difficulty / HeightModifier again on every item init.
				const C = CharacterLoadNPC('NPC_ERStack');
				CharacterAppearanceSetDefault(C);
				InventoryWear(C, 'HempRope', 'ItemFeet');
				const rope = InventoryGet(C, 'ItemFeet');
				const first = rope.Property.Difficulty;
				for (let i = 0; i < 3; i++) ExtendedItemInit(C, rope, false, false);
				return { first, after: rope.Property.Difficulty };
			});
			check('an item difficulty no longer grows when it is initialised again', stack.after === stack.first, stack);
			const craft = await page.evaluate(() => {
				window.BCX_Loaded = true;
				Player.MemberNumber = 1001;
				Player.Name = 'Rose';
				CharacterAppearanceSetDefault(Player);
				InventoryWear(Player, 'LeatherCollar', 'ItemNeck');
				const full = { Name: 'Cursed collar', MemberName: 'Rose', MemberNumber: 1001, Description: 'test', Property: 'Secure', Lock: '', Color: '#ff0000', Item: 'LeatherCollar', Private: false, ItemProperty: {} };
				InventoryGet(Player, 'ItemNeck').Craft = { ...full };
				const bundle = ServerAppearanceBundle(Player.Appearance).map((b) => (b.Group === 'ItemNeck' ? { ...b, Craft: { Name: full.Name, MemberName: full.MemberName, MemberNumber: full.MemberNumber, Description: full.Description, Private: false } } : b));
				ServerAppearanceLoadFromBundle(Player, 'Female3DCG', bundle, 1001);
				const after = InventoryGet(Player, 'ItemNeck')?.Craft;
				delete window.BCX_Loaded;
				return { property: after?.Property, item: after?.Item, worn: InventoryGet(Player, 'ItemNeck')?.Asset?.Name ?? null, after: after ?? null, sent: bundle.find((b) => b.Group === 'ItemNeck')?.Craft ?? null, chart: ER.chart().find((c) => c.id === 'bcx-curse-loop') };
			});
			check('BCX curse fix keeps the full craft when the server echoes a partial one', craft.property === 'Secure' && craft.item === 'LeatherCollar', craft);
			// LSCG's hook skips the game when the view is already open; R134 rebuilds the view's buttons there.
			const views = await page.evaluate(() => {
				const map = ChatRoomViews.Map;
				const activate = map.Activate;
				let built = 0;
				map.Activate = () => { built++; };
				const before = ChatRoomActiveView;
				ChatRoomActiveView = map;
				const out = {};
				ChatRoomActivateView('Map');
				out.plain = built;
				const lscg = bcModSdk.registerMod({ name: 'LSCGTest', fullName: 'LSCG-like test', version: '1.0.0' });
				lscg.hookFunction('ChatRoomActivateView', 1, (args, next) => { if (ChatRoomActiveView != ChatRoomViews[args[0]]) next(args); });
				built = 0;
				ChatRoomActivateView('Map');
				out.lscg = built;
				lscg.unload();
				map.Activate = activate;
				ChatRoomActiveView = before;
				return out;
			});
			check('the open map view rebuilds once without LSCG', views.plain === 1, views);
			check('the open map view rebuilds once behind an LSCG-style hook', views.lscg === 1, views);
			const sw = await page.evaluate(() => {
				const out = {};
				const call = () => { try { return typeof PreferenceArousalIsActive(); } catch (e) { return 'throws'; } };
				out.auto = call();
				// A WCE newer than the tested one: ER pauses its WCE fixes by itself.
				bcModSdk.registerMod({ name: 'WCE', fullName: 'WCE', version: '9.9.9' });
				out.paused = call();
				out.pausedVerdict = ER.chart().find((c) => c.id === 'arousal-active').status;
				return out;
			});
			check('a fix runs on Auto', sw.auto === 'boolean', sw);
			check('a newer extension pauses its fixes on Auto', sw.paused === 'throws', sw);
			check('the panel opens', await page.evaluate(() => { ER.open(); return !!document.getElementById('er-panel'); }), false);
			check('the panel shows the pause', await page.evaluate(() => /paused by ER: WCE updated to 9\.9\.9/.test(document.getElementById('er-panel').textContent)), false);
			const echoNewer = await page.evaluate(() => {
				// An Echo newer than the tested ones: its fixes check for the problem themselves, so they keep running.
				bcModSdk.registerMod({ name: '服装拓展', fullName: 'Echo-like test', version: '9.9.9' });
				ER.open();
				return document.getElementById('er-panel').textContent;
			});
			check('self-checking fixes keep running when their extension updates', /checks for the problem itself each time, so it keeps running \(Echo's Clothing Mod updated to 9\.9\.9/.test(echoNewer), echoNewer.slice(0, 300));
			check('ER is in Preferences > Extensions', await page.evaluate(() => !!PreferenceExtensionsSettings.ER), false);
			const forcedOn = await page.evaluate(() => {
				const box = [...document.querySelectorAll('#er-panel .er-ext')].find((b) => b.querySelector('.er-ext-name').textContent === 'WCE');
				[...box.querySelector('.er-ext-head .er-seg').children].find((b) => b.textContent === 'On').click();
				let r;
				try { r = typeof PreferenceArousalIsActive(); } catch { r = 'throws'; }
				return { r, saved: localStorage.getItem('ER.settings') };
			});
			check('forcing an extension On overrides the pause', forcedOn.r === 'boolean' && /"WCE":"on"/.test(forcedOn.saved), forcedOn);
			const forcedOff = await page.evaluate(() => {
				const box = [...document.querySelectorAll('#er-panel .er-ext')].find((b) => b.querySelector('.er-ext-name').textContent === 'WCE');
				[...box.querySelector('.er-ext-head .er-seg').children].find((b) => b.textContent === 'Off').click();
				let r;
				try { r = typeof PreferenceArousalIsActive(); } catch { r = 'throws'; }
				localStorage.removeItem('ER.settings');
				return r;
			});
			check('forcing an extension Off stops its fixes at once', forcedOff === 'throws', forcedOff);
			await page.evaluate(() => document.getElementById('er-panel').remove());
			check('/er is registered',await page.waitForFunction(() => Commands.some((c) => c.Tag === 'er'), { timeout: 5000 }).then(() => true, () => false), false);
			check('no page errors', errors.length === 0, errors);
			await page.close();
		}
	} finally {
		await browser.close();
	}
	console.log(failed ? `${failed} FAILED` : 'ALL PASS');
	process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
