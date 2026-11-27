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
			for (const id of ['room-space', 'info-sheet', 'online-profile', 'room-admin', 'controller', 'bcx-curse-loop', 'fetch-request', 'baseline-options', 'saved-settings', 'option-rules', 'missing-property', 'activity-buttons', 'extension-pages', 'wce-arousal', 'image-addresses', 'minigame-return', 'late-masks', 'default-color', 'arousal-active', 'item-header', 'view-rebuild']) check(`${id} treated`, chart[id] === 'treated', chart[id]);
			// BC hot-fixed these on live R134 (20 Nov 2026): ER's probes see it and stand down.
			for (const id of ['stacking-init', 'default-color-compare', 'portal-code']) check(`${id} not needed (the game fixed it)`, chart[id] === 'healthy', chart[id]);
			// The game shipped these in R134 Beta 2, so ER's copies stand down.
			for (const id of ['chat-width', 'modular-options']) check(`${id} is gone from ER (the game has it)`, !(id in chart), chart[id]);
			const space = await page.evaluate(() => {
				ChatRoomData = { Space: 'M', Game: 'LARP' };
				const inRoom = [ChatRoomSpace, ChatRoomGame];
				ChatRoomData = null;
				ChatSearchSpace = 'Asylum';
				return { inRoom, lobby: ChatRoomSpace };
			});
			const portal = await page.evaluate(() => {
				CharacterAppearanceSetDefault(Player);
				InventoryWear(Player, 'PortalTablet', 'ItemHandheld');
				const inits = [1, 2].map(() => ExtendedItemInit(Player, InventoryGet(Player, 'ItemHandheld'), false, false));
				const entry = PropertyData.PortalLinkCode;
				const out = { inits, empty: entry.validate('', undefined, '').status, good: entry.validate('0a1b2c3d', undefined, '').status, bad: entry.validate('zz', undefined, '').status };
				InventoryRemove(Player, 'ItemHandheld', false);
				return out;
			});
			check('a Portal Tablet with no link code stops resending', portal.inits.every((r) => r === false) && portal.empty === 'ok', portal);
			check('Portal Tablet codes are still checked (good ok, bad refused)', portal.good === 'ok' && portal.bad !== 'ok', portal);
			const noProp = await page.evaluate(() => {
				// BCAR's ear wiggle: wear ears without a refresh, set the saved Property (undefined), refresh, then draw the vibrator effect.
				CharacterAppearanceSetDefault(Player);
				const ears = InventoryWear(Player, 'KittenEars1', 'HairAccessory2', 'Default', undefined, undefined, undefined, false);
				ears.Property = undefined;
				CharacterRefresh(Player, false);
				const old = Player.ArousalSettings.VFXVibrator;
				Player.ArousalSettings.VFXVibrator = 'VFXVibratorAnimated';
				let err = null;
				try { ChatRoomVibrationScreenFilter(0, 1000, 1000, Player); } catch (e) { err = e.message; }
				// Same again with the Property cleared after the refresh (only the draw hook can catch it).
				InventoryGet(Player, 'HairAccessory2').Property = undefined;
				try { ChatRoomVibrationScreenFilter(0, 1000, 1000, Player); } catch (e) { err = err || e.message; }
				Player.ArousalSettings.VFXVibrator = old;
				InventoryRemove(Player, 'HairAccessory2', false);
				return { err };
			});
			check('an item with no Property does not crash the vibrator screen effect (BCAR ear wiggle)', noProp.err === null, noProp);
			const menu = await page.evaluate(async () => {
				// Echo's plushie activities threw from their CreateForActivity hook, and one failed button left the
				// whole activity menu empty on every later open. A stand-in add-on throws for one activity (and reads
				// a held item's Property the way Echo does); the menu must still show every activity.
				window.ActivityAllowed = () => true;
				Player.SavedExpressions = Player.SavedExpressions || [];
				const C = CharacterLoadNPC('NPC_ERActivities');
				C.MemberNumber = 3003;
				C.AllowItem = true;
				C.ArousalSettings = JSON.parse(JSON.stringify(Player.ArousalSettings || {}));
				C.ArousalSettings.Active = 'Hybrid';
				const held = InventoryWear(C, 'Plushie', 'ItemHandheld', 'Default', undefined, undefined, undefined, false);
				if (held) held.Property = undefined;
				const mod = bcModSdk.registerMod({ name: 'ERTestBrokenButtons', fullName: 'ER test', version: '1' });
				let first = null;
				let propertyRead = null;
				mod.hookFunction('ElementButton.CreateForActivity', 0, (args, next) => {
					const plushie = args[2].Appearance.find((i) => i.Asset.Name === 'Plushie');
					if (plushie) propertyRead = typeof plushie.Property;
					first ??= args[1].Activity.Name;
					if (args[1].Activity.Name === first) throw new TypeError('broken add-on button');
					return next(args);
				});
				const out = {};
				for (const label of ['first', 'again']) {
					CharacterSetCurrent(C);
					C.FocusGroup = AssetGroupGet('Female3DCG', 'ItemArms');
					DialogChangeMode('activities');
					await new Promise((r) => setTimeout(r, 500));
					out[label] = { list: DialogActivity.length, buttons: document.getElementById('dialog-activity-grid')?.children.length ?? -1 };
					DialogLeave();
					await new Promise((r) => setTimeout(r, 300));
				}
				mod.unload();
				out.propertyRead = propertyRead;
				return out;
			});
			check('a broken add-on activity button does not empty the activity menu', menu.first.list > 0 && menu.first.buttons === menu.first.list && menu.again.buttons === menu.again.list, menu);
			check('a held item with no Property has one by the time add-ons draw activity buttons', menu.propertyRead === 'object', menu);
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
			const pages = await page.evaluate(async () => {
				// 30 add-ons with a settings page: R134 fits 21 (3 x 7), so ER splits them into pages.
				for (let i = 1; i <= 30; i++) PreferenceRegisterExtensionSetting({ Identifier: 'ERTestExt' + i, ButtonText: 'ER test ' + i, Image: 'Icons/Preference.png', load() {}, run() {}, click() {}, exit() {} });
				const shown = () => [...document.querySelectorAll('#preference-extensions-grid > button')].filter((b) => b.offsetParent).length;
				await PreferenceOpenSubscreen('Extensions');
				const first = [shown(), document.getElementById('er-ext-page')?.textContent];
				document.getElementById('er-ext-next')?.click();
				const second = [shown(), document.getElementById('er-ext-page')?.textContent];
				await PreferenceOpenSubscreen('Main');
				for (let i = 1; i <= 30; i++) delete PreferenceExtensionsSettings['ERTestExt' + i];
				await CommonSetScreen('Character', 'Login');
				return { first, second };
			});
			check('31 extensions show as pages of 21 (1/2, then 2/2 with 10)', pages.first[0] === 21 && pages.first[1] === '1/2' && pages.second[0] === 10 && pages.second[1] === '2/2', pages);
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
			const hello = await page.evaluate(() => {
				// The ER mark: another ER user's hidden hello is answered to them only, with this ER's version.
				const sent = [];
				const real = window.ServerSend;
				window.ServerSend = (m, d) => sent.push([m, d]);
				try {
					ChatRoomMessage({ Type: 'Hidden', Content: 'ER', Sender: 5555, Dictionary: [{ er: '1.0.0', reply: true }] });
				} catch (e) {
					/* the game may have nothing to do with it outside a room */
				}
				window.ServerSend = real;
				const answer = sent.find((x) => x[0] === 'ChatRoomChat' && x[1].Content === 'ER');
				return answer ? { to: answer[1].Target, version: answer[1].Dictionary[0].er } : null;
			});
			check('another ER user is answered with this version (the ER mark)', hello && hello.to === 5555 && /^\d+\.\d+\.\d+$/.test(hello.version), hello);
			const colours = await page.evaluate(() => PropertyData.DefaultColor.isSubset(['#2A2929', '#472C20', 'Default'], ['#2A2929', '#472C20', 'Default'], {}));
			check('two equal DefaultColor lists match (Oculus Nihili weapons stop resending)', colours === true, colours);
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
			const curses = await page.evaluate(() => {
				// A stand-in for BCX's mod API: each group's curse, as getCurseInfo hands it out.
				const held = {};
				window.bcx = { getModApi: () => ({ getCurseInfo: (g) => (held[g] ? { active: true, asset: AssetGet('Female3DCG', g, held[g].Name), curseProperty: !!held[g].curseProperty, property: held[g].Property, craft: held[g].Craft, color: undefined } : null) }) };
				window.BCX_Loaded = true;
				Player.MemberNumber = 1001;
				Player.Name = 'Rose';
				const echo = () => ServerAppearanceLoadFromBundle(Player, 'Female3DCG', ServerAppearanceBundle(Player.Appearance), 1001);
				const full = { Item: 'PaddedBeltCollar', Name: 'Collar of Remembrance', Description: '', Color: '#3596FF,#F1B800,#B7B6B6,#030303,#000000,#C2A218', Lock: '', Private: true, ItemProperty: {}, TypeRecord: null, Effects: { Comfy: 1 }, MemberNumber: 2002, MemberName: 'lily', Partial: false };
				const partial = { Name: full.Name, MemberName: full.MemberName, MemberNumber: full.MemberNumber, Description: full.Description, Effects: { Comfy: 1 }, Private: true };
				const out = {};
				const wearCollar = (craft) => {
					CharacterAppearanceSetDefault(Player);
					InventoryWear(Player, 'PaddedBeltCollar', 'ItemNeck');
					InventoryGet(Player, 'ItemNeck').Craft = JSON.parse(JSON.stringify(craft));
				};
				// The curse holds the full craft; the server sends a partial one back: the item gets the full craft.
				held.ItemNeck = { Name: 'PaddedBeltCollar', Craft: full };
				wearCollar(full);
				echo();
				out.fullCurse = CommonDeepEqual(InventoryGet(Player, 'ItemNeck').Craft, full);
				// The curse holds the partial craft (saved after a relog): the item keeps the partial one.
				held.ItemNeck = { Name: 'PaddedBeltCollar', Craft: partial };
				wearCollar(full);
				echo();
				out.partialCurse = CommonDeepEqual(InventoryGet(Player, 'ItemNeck').Craft, partial);
				// A curse holding another craft is left alone.
				held.ItemNeck = { Name: 'PaddedBeltCollar', Craft: { ...full, Name: 'Another collar' } };
				wearCollar(full);
				echo();
				out.otherCraft = InventoryGet(Player, 'ItemNeck').Craft.Name === full.Name && InventoryGet(Player, 'ItemNeck').Craft.Item === undefined;
				delete held.ItemNeck;
				// Clothing: a curse that saved Difficulty 0 keeps it through a reload; one that did not, does not get it.
				const shoes = (curseProps) => {
					held.ClothOuter = { Name: 'JacketHoodie', curseProperty: true, Property: curseProps };
					CharacterAppearanceSetDefault(Player);
					InventoryWear(Player, 'JacketHoodie', 'ClothOuter');
					InventoryGet(Player, 'ClothOuter').Property.Difficulty = 0;
					echo();
					const item = InventoryGet(Player, 'ClothOuter');
					return { difficulty: item?.Property?.Difficulty, changed: ExtendedItemInit(Player, item, false, false) };
				};
				out.zeroKept = shoes({ Difficulty: 0 });
				out.zeroNotCursed = shoes({});
				delete held.ClothOuter;
				delete window.BCX_Loaded;
				out.plain = shoes({ Difficulty: 0 });
				return out;
			});
			check('BCX curse fix: a curse holding the full craft gets it back after the server sends a partial one', curses.fullCurse === true, curses);
			check('BCX curse fix: a curse holding the partial craft keeps the item partial (no endless resend)', curses.partialCurse === true, curses);
			check('BCX curse fix: a curse holding another craft is left alone', curses.otherCraft === true, curses);
			check('BCX curse fix keeps a cursed difficulty of 0 on clothing through a reload', curses.zeroKept.difficulty === 0 && curses.zeroKept.changed === false, curses);
			check('BCX curse fix adds no 0 the curse does not hold', curses.zeroNotCursed.difficulty === undefined, curses);
			check('without BCX the game drops that 0 as before', curses.plain.difficulty === undefined, curses);
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
			const fixedLscg = await page.evaluate(() => {
				// LSCG 0.9.19 fixed its hook itself: ER's view fix stands down and says so.
				const map = ChatRoomViews.Map;
				const activate = map.Activate;
				let built = 0;
				map.Activate = () => { built++; };
				const before = ChatRoomActiveView;
				ChatRoomActiveView = map;
				const lscg = bcModSdk.registerMod({ name: 'LSCG', fullName: 'LSCG', version: '0.9.19' });
				lscg.hookFunction('ChatRoomActivateView', 1, (args, next) => { if (ChatRoomActiveView != ChatRoomViews[args[0]]) next(args); });
				ChatRoomActivateView('Map');
				map.Activate = activate;
				ChatRoomActiveView = before;
				ER.open();
				const text = document.getElementById('er-panel').textContent;
				document.getElementById('er-panel').remove();
				lscg.unload();
				return { built, says: /not needed: LSCG 0\.9\.19 fixed this itself/.test(text) };
			});
			check('an extension version that fixed the problem itself stands ER down (LSCG 0.9.19)', fixedLscg.built === 0 && fixedLscg.says, fixedLscg);
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
			const watched = await page.evaluate(async () => {
				// /er watch: a curse-style change and a reload while it records show up in the report.
				CharacterAppearanceSetDefault(Player);
				InventoryWear(Player, 'PaddedBeltCollar', 'ItemNeck');
				const consoleWas = console.warn;
				const running = Commands.find((c) => c.Tag === 'er').Action('watch');
				const report = ER.watch(1.5);
				setTimeout(() => {
					InventoryGet(Player, 'ItemNeck').Color = ['#ff0000'];
					console.warn('Sanitizing invalid appearance test');
					ServerAppearanceLoadFromBundle(Player, 'Female3DCG', ServerAppearanceBundle(Player.Appearance), Player.MemberNumber);
				}, 400);
				await new Promise((r) => setTimeout(r, 21000));
				const text = await report;
				const box = document.querySelector('#er-panel .er-report');
				const out = { second: text, shown: !!box, restored: console.warn === consoleWas, first: box ? box.value : null };
				document.getElementById('er-panel')?.remove();
				return out;
			});
			check('/er watch records a changed item, the reload and the warning, then shows the report', watched.shown && watched.second === null && /== ItemNeck/.test(watched.first) && /after a reload|seen/.test(watched.first) && /appearance reloads: [1-9]/.test(watched.first) && /Sanitizing invalid appearance test/.test(watched.first) && watched.restored, watched);
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
