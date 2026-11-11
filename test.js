// ER in the real game, headless, never logged in. Checks the beta (where ER treats) and live (where it must
// leave everything alone). Run: node test.js
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const BUILDS = {
	live: 'https://www.bondageprojects.elementfx.com/R133/BondageClub/',
	beta: 'https://www.bondageprojects.elementfx.com/R133/1970510968540/',
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
		// The beta: R134 removed things add-ons use.
		{
			const { page, errors } = await open(browser, BUILDS.beta);
			const chart = await page.evaluate(() => Object.fromEntries(ER.chart().map((c) => [c.id, c.status])));
			check('beta: every fix runs without failing', Object.values(chart).every((s) => s !== 'failed'), chart);
			for (const id of ['room-space', 'info-sheet', 'online-profile', 'room-admin', 'controller', 'infiltration', 'modular-options', 'fetch-request', 'baseline-options', 'default-color', 'arousal-active', 'item-header']) check(`beta: ${id} treated`, chart[id] === 'treated', chart[id]);
			const space = await page.evaluate(() => {
				ChatRoomData = { Space: 'M', Game: 'LARP' };
				const inRoom = [ChatRoomSpace, ChatRoomGame];
				ChatRoomData = null;
				ChatSearchSpace = 'Asylum';
				return { inRoom, lobby: ChatRoomSpace };
			});
			check('beta: ChatRoomSpace/ChatRoomGame follow the room', space.inRoom[0] === 'M' && space.inRoom[1] === 'LARP', space);
			check('beta: ChatRoomSpace follows the lobby outside a room', space.lobby === 'Asylum', space);
			check('beta: InformationSheetSecondScreenRun can be hooked', await page.evaluate(() => {
				const m = bcModSdk.registerMod({ name: 'ERTestHook', fullName: 'x', version: '1' });
				m.hookFunction('InformationSheetSecondScreenRun', 0, (a, n) => n(a));
				return true;
			}), false);
			const infil = await page.evaluate(() => {
				InfiltrationMission = 'CatBurglar';
				InfiltrationTarget = { Type: 'GoldCollar', Name: 'Gold collar' };
				return { state: InfiltrationMissionState, mission: InfiltrationMission, target: InfiltrationTarget?.Type };
			});
			check('beta: old Pandora mission writes land in InfiltrationMissionState', infil.state?.Mission === 'CatBurglar' && infil.state?.Target === 'GoldCollar' && infil.target === 'GoldCollar', infil);
			check('beta: PreferenceArousalIsActive() with no character works', await page.evaluate(() => typeof PreferenceArousalIsActive() === 'boolean'), false);
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
			check('beta: CommonDebounce old and new forms both debounce', debounce[0] === 1 && debounce[1] === 1, debounce);
			const trip = await page.evaluate(roundTrip);
			check('beta: Bar Stool decal survives to another player', trip.BarStool && trip.BarStool.mine === 2 && trip.BarStool.theirs === 2, trip);
			check('beta: Hypnotic Visor option survives to another player', trip.HypnoticVisor.mine === 2 && trip.HypnoticVisor.theirs === 2, trip);
			check('beta: /er is registered', await page.waitForFunction(() => Commands.some((c) => c.Tag === 'er'), { timeout: 5000 }).then(() => true, () => false), false);
			check('beta: no page errors', errors.length === 0, errors);
			await page.close();
		}
		// Live R133: ER must find nothing to do and change nothing.
		{
			const { page, errors } = await open(browser, BUILDS.live);
			const chart = await page.evaluate(() => Object.fromEntries(ER.chart().map((c) => [c.id, c.status])));
			check('live: every check is healthy (nothing treated)', Object.values(chart).every((s) => s === 'healthy'), chart);
			check('live: no stand-ins added', (await page.evaluate(() => ER.standIns())).length === 0, await page.evaluate(() => ER.standIns()));
			const trip = await page.evaluate(roundTrip);
			check('live: Hypnotic Visor option round trip still works', trip.HypnoticVisor.mine === 2 && trip.HypnoticVisor.theirs === 2, trip);
			check('live: no page errors', errors.length === 0, errors);
			await page.close();
		}
	} finally {
		await browser.close();
	}
	console.log(failed ? `${failed} FAILED` : 'ALL PASS');
	process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
