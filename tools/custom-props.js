// Settings the game has no rules for (AEE's Free Draw CustomDraw on DrawingBoard, Echo's 渐变叠加 sliders):
// save, load as another player, compare.   usage: node tools/custom-props.js <er|noer>
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const LIVE = 'https://www.bondageprojects.elementfx.com/R133/BondageClub/';
const ECHO = 'https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js';
const AEE = 'https://awdrrawd.github.io/BC-AEE/assets/main.js';
const MODSDK = 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1.2.0/dist/bcmodsdk.js';
const mode = process.argv[2] || 'noer';
(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	if (mode === 'er') await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(LIVE, { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && typeof Player !== 'undefined' && !!Player, { timeout: 120000 });
	await page.evaluate(() => { window.ServerSend = () => {}; });
	if ((await page.evaluate(() => typeof bcModSdk)) === 'undefined') await page.addScriptTag({ url: MODSDK });
	const before = await page.evaluate(() => Asset.length);
	await page.evaluate((s) => { const el = document.createElement('script'); el.type = 'module'; el.src = s; document.head.appendChild(el); }, ECHO);
	await page.waitForFunction((n) => Asset.length > n + 1000, { timeout: 60000 }, before);
	await page.evaluate((s) => { const el = document.createElement('script'); el.type = 'module'; el.src = s; document.head.appendChild(el); }, AEE);
	const aee = await page.waitForFunction(() => !!AssetGet('Female3DCG', 'ItemCanvas1', 'DrawingBoard'), { timeout: 30000 }).then(() => true, () => false);
	console.log('AEE DrawingBoard loaded:', aee);
	await new Promise((r) => setTimeout(r, 3000));
	const res = await page.evaluate(() => {
		const C = CharacterLoadNPC('NPC_Props');
		CharacterAppearanceSetDefault(C);
		const cases = [];
		for (const a of Asset.filter((a) => a.Name === 'DrawingBoard')) cases.push([a, { CustomDraw: 'AEE-test-drawing-' + 'x'.repeat(50), CustomDrawSPS: 'sps-test' }]);
		for (const a of Asset.filter((x) => x.Name === '身体论文')) cases.push([a, { Text1: 'Property of Mistress', Text2: 'Slut! 💋', Text3: 'third line' }]);
		const g = AssetGet('Female3DCG', '额外头发_Luzi', '渐变叠加');
		if (g) cases.push([g, { upperBound: 222, gradientSize: 77, rotation: 90 }]);
		const out = [];
		let n = 0;
		for (const [a, props] of cases) {
			InventoryWear(C, a.Name, a.Group.Name);
			const item = InventoryGet(C, a.Group.Name);
			if (item) Object.assign(item.Property ??= {}, props);
			// AEE's boards are not worn through InventoryWear; what matters is loading a saved one, so bundle it by hand.
			// Through the game's own bundling, as a real save or echo does; an item InventoryWear refuses (AEE's board) is put on by hand.
			const worn = item || AppearanceItem.fromAsset(a, { property: { ...props } });
			const appearance = ServerAppearanceBundle(C.Appearance).filter((b) => b.Group !== a.Group.Name);
			appearance.push(ServerAppearanceBundle([worn])[0]);
			const other = CharacterLoadOnline({ ID: 'p' + n, Name: 'O', Nickname: 'O', MemberNumber: 5000 + n, AssetFamily: 'Female3DCG', Appearance: appearance, Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: {}, ArousalSettings: {}, Game: {}, Inventory: [] }, 5000 + n);
			n++;
			const t = InventoryGet(other, a.Group.Name);
			const kept = Object.keys(props).filter((k) => t && t.Property && t.Property[k] === props[k]);
			out.push(`${a.Group.Name}/${a.Name}: ${kept.length}/${Object.keys(props).length} kept${kept.length < Object.keys(props).length ? ' -> ' + JSON.stringify(Object.fromEntries(Object.keys(props).map((k) => [k, t?.Property?.[k]]))).slice(0, 120) : ''}`);
			InventoryRemove(C, a.Group.Name, false);
		}
		return { version: GameVersion, out };
	});
	console.log(res.version, mode);
	for (const l of res.out) console.log(' ', l);
	await browser.close();
})();
