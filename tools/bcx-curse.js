// BCX curses on live R134: does a cursed item keep "undoing changes" when nothing changed?
// Fake login with BCX, wear a mix of items, curse them through BCX's own query, then let BCX tick while every
// appearance update it sends comes back the way the server echoes it (crafts cut down to their partial form).
// usage: node tools/bcx-curse.js <er|noer> [echo]   (ER_FILE=<path> for another ER build; "echo" loads Echo too)
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const LIVE = 'https://www.bondageprojects.elementfx.com/R134/BondageClub/';
const MODSDK = 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1.2.0/dist/bcmodsdk.js';
const BCX = process.env.BCX_URL || 'https://jomshir98.github.io/bondage-club-extended/devel/bcx.js';
const ECHO = 'https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js';
const [mode, withEcho] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	const logs = [];
	page.on('console', (m) => { if (/BCX|curse|ER/i.test(m.text()) && m.type() !== 'debug') logs.push(m.type() + ' ' + m.text().slice(0, 220)); });
	page.on('pageerror', (e) => logs.push('pageerror ' + String(e.message).split('\n')[0]));
	if (mode === 'er') await page.evaluateOnNewDocument(fs.readFileSync(process.env.ER_FILE || path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(LIVE, { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && !!Player, { timeout: 120000 });
	await page.evaluate(() => {
		window.erSent = [];
		window.ServerSend = (msg, data) => window.erSent.push([msg, JSON.parse(JSON.stringify(data ?? null))]);
		ServerSocket.disconnect?.();
		ServerSocket.emit = (...a) => window.erSent.push(a);
	});
	if ((await page.evaluate(() => typeof bcModSdk)) === 'undefined') await page.addScriptTag({ url: MODSDK });
	if (withEcho) {
		const before = await page.evaluate(() => Asset.length);
		await page.evaluate((s) => { const el = document.createElement('script'); el.type = 'module'; el.src = s; document.head.appendChild(el); }, ECHO);
		await page.waitForFunction((n) => Asset.length > n + 1000, { timeout: 60000 }, before);
	}
	await page.addScriptTag({ url: BCX });
	await sleep(4000);
	await page.evaluate(() => {
		const dummy = CharacterLoadSimple?.('ERDummy') ?? CharacterLoadNPC('NPC_ERDummy');
		CharacterAppearanceSetDefault(dummy);
		LoginResponse({
			ID: 'er-test', Name: 'Rose', AccountName: 'ERTEST', MemberNumber: 424242, Creation: Date.now() - 864e5 * 400,
			Money: 100, Owner: '', Title: 'None', Nickname: '', Description: '', AssetFamily: 'Female3DCG',
			Appearance: ServerAppearanceBundle(dummy.Appearance), Inventory: {}, Log: [], Lovership: [], Ownership: null, Reputation: [], Skill: [],
			WhiteList: [], BlackList: [], FriendList: [], GhostList: [], ItemPermission: 2, ArousalSettings: {},
			OnlineSettings: {}, OnlineSharedSettings: {}, GraphicsSettings: {}, ChatSettings: {}, VisualSettings: {},
			AudioSettings: {}, ControllerSettings: {}, GameplaySettings: {}, ImmersionSettings: {}, RestrictionSettings: {},
			ExtensionSettings: {}, Game: {}, LabelColor: '#ff66cc', Difficulty: { Level: 1, LastChange: 0 },
		});
	});
	await sleep(8000);
	const setup = await page.evaluate((withEcho) => {
		window.ServerIsConnected = true;
		ChatRoomData = { Name: 'ER', Description: '', Admin: [Player.MemberNumber], Whitelist: [], Ban: [], BlockCategory: [], Character: [], Limit: 10, Background: 'MainHall', Space: '', Visibility: ['All'], Access: ['All'], Language: 'EN', Custom: {}, MapData: { Type: 'Never' } };
		ChatRoomCharacter = [Player];
		CommonSetScreen('Online', 'ChatRoom');
		const worn = [];
		const wear = (group, name, extra) => {
			const a = AssetGet('Female3DCG', group, name);
			if (!a) return worn.push(`${group}/${name}: missing`);
			InventoryWear(Player, name, group);
			const item = InventoryGet(Player, group);
			if (extra) extra(item, a);
			worn.push(`${group}/${name}`);
		};
		// A crafted collar (the R133 partial-craft echo case).
		wear('ItemNeck', 'LeatherCollar', (item) => {
			item.Craft = { Name: 'Curse test', MemberName: 'Rose', MemberNumber: 424242, Description: 'craft', Property: 'Secure', Lock: '', Private: false, Color: '#AA2222', Item: 'LeatherCollar', ItemProperty: {}, TypeRecord: null };
		});
		// Plain clothing with its own colours.
		wear('Cloth', 'CollegeOutfit1', (item) => { item.Color = ['#123456', '#654321']; });
		// A typed restraint on a non-default option.
		wear('ItemArms', 'HempRope', (item, a) => {
			const data = ExtendedItemGetData(a, ExtendedArchetype.TYPED);
			if (data) ExtendedItemSetOption(data, Player, item, data.options[2] ?? data.options[1], data.options[0], false, false);
		});
		// A modular item on non-default options.
		wear('ItemMouth', 'BallGag', (item, a) => {
			const data = ExtendedItemGetData(a, ExtendedArchetype.TYPED) ?? ExtendedItemGetData(a, ExtendedArchetype.MODULAR);
			if (data && data.options) ExtendedItemSetOption(data, Player, item, data.options[1], data.options[0], false, false);
		});
		if (withEcho) {
			wear('额外头发_Luzi', '渐变叠加', (item) => { Object.assign(item.Property ??= {}, { upperBound: 222, gradientSize: 77, rotation: 90 }); item.Color = ['#00FF00', '#FF00FF']; });
			const mark = Asset.find((x) => x.Name === '标志纹饰');
			if (mark) wear(mark.Group.Name, mark.Name, (item, a) => {
				const data = ExtendedItemGetData(a, ExtendedArchetype.MODULAR);
				if (data) ExtendedItemSetOptionByRecord(Player, item, { p: 3 }, { push: false, refresh: false });
			});
		}
		CharacterRefresh(Player, false, false);
		const groups = worn.filter((w) => !/missing/.test(w)).map((w) => w.split('/')[0]);
		window.__groups = groups;
		// BCX's own chat commands, as the player would type them.
		const replies = [];
		const input = document.getElementById('InputChat') || ElementCreateTextArea?.('InputChat');
		for (const cmd of ['/curses curseworn items', '/curses curseworn clothes']) {
			try { CommandParse(cmd); } catch (e) { replies.push('command error ' + e.message); }
		}
		const tags = (window.Commands || []).map((c) => c.Tag);
		return { worn, groups, bcx: !!window.bcx, er: window.ER ? window.ER.version : null, cursesCmd: tags.includes('curses'), bcxTags: tags.filter((t) => /curse|bcx|help/i.test(t)).slice(0, 10), commandsKey: window.CommandsKey, replies };
	}, !!withEcho);
	console.log(mode, withEcho ? '+Echo' : '', JSON.stringify(setup));
	await sleep(3000);
	console.log('chat log:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#TextAreaChatLog > *')].map((e) => e.textContent.trim().slice(0, 200)).slice(-8))));
	console.log('sent so far:', JSON.stringify(await page.evaluate(() => window.erSent.map(([m, d]) => m + ' ' + JSON.stringify(d).slice(0, 120)).slice(-8))));
	// The server's echo: every appearance update comes back, crafts cut down to the keys a partial craft keeps.
	const PARTIAL = ['Name', 'MemberName', 'MemberNumber', 'Description', 'Effects', 'Private'];
	const result = await page.evaluate(async (PARTIAL) => {
		const start = window.erSent.length;
		let echoed = 0;
		const perGroup = {};
		const changes = [];
		const snap = () => JSON.stringify(ServerAppearanceBundle(Player.Appearance).filter((b) => window.__groups.includes(b.Group)));
		for (let t = 0; t < 30; t++) {
			const before = snap();
			await new Promise((r) => setTimeout(r, 1000));
			const after = snap();
			if (before !== after) {
				const a = JSON.parse(before), b = JSON.parse(after);
				for (const g of window.__groups) {
					const x = JSON.stringify(a.find((i) => i.Group === g)), y = JSON.stringify(b.find((i) => i.Group === g));
					if (x !== y && changes.length < 12) changes.push(`${g}: ${String(x).slice(0, 160)}  ->  ${String(y).slice(0, 160)}`);
				}
			}
			// Echo updates sent since the last pass.
			const sent = window.erSent.slice(start);
			const updates = sent.filter(([m]) => m === 'ChatRoomCharacterUpdate').slice(echoed);
			for (const [, data] of updates) {
				echoed++;
				const bundle = (data.Appearance || []).map((b) => b.Craft ? { ...b, Craft: Object.fromEntries(Object.entries(b.Craft).filter(([k]) => PARTIAL.includes(k))) } : b);
				ServerAppearanceLoadFromBundle(Player, 'Female3DCG', bundle, Player.MemberNumber);
				CharacterRefresh(Player, false, false);
			}
		}
		const msgs = window.erSent.slice(start).filter(([m, d]) => m === 'ChatRoomChat' && d && d.Type === 'Action').map(([, d]) => (d.Dictionary || []).map((x) => x.Text || '').join(' ') || d.Content);
		for (const m of msgs) { const k = m.replace(/Rose/g, '').slice(0, 90); perGroup[k] = (perGroup[k] || 0) + 1; }
		return { updatesSent: window.erSent.slice(start).filter(([m]) => m === 'ChatRoomCharacterUpdate').length, echoed, curseMessages: perGroup, changes };
	}, PARTIAL);
	console.log(JSON.stringify(result, null, 1));
	console.log('logs:', logs.filter((l) => !/Failed to load|404/.test(l)).slice(0, 12));
	await browser.close();
})();
