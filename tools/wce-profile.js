// WCE's rich profile and notes on R134's profile screen, with or without ER.
// usage: node tools/wce-profile.js <er|noer> [out.png]
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const LIVE = 'https://www.bondageprojects.elementfx.com/R133/BondageClub/';
const MODSDK = 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1.2.0/dist/bcmodsdk.js';
const WCE = 'https://wce.netlify.app/wce.js';
const [mode, out] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	const page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 800 });
	const errors = [];
	page.on('console', (m) => { if (m.type() === 'warning' && /ER|WCE/.test(m.text())) errors.push('warn ' + m.text().slice(0, 300)); });
	page.on('console', (m) => { if (/WCE|FBC|fbc|bce|initializ/i.test(m.text()) && m.type() !== 'error') errors.push('log ' + m.text().slice(0, 160)); });
	page.on('pageerror', (e) => errors.push('pageerror ' + String(e.message).split('\n')[0]));
	page.on('console', async (m) => { if (m.type() === 'error' && !/Failed to load (resource|image)|404/.test(m.text())) { let extra = ''; try { extra = (await Promise.all(m.args().map((a) => a.evaluate((v) => (v && v.stack) ? v.stack : String(v))))).join(' | '); } catch {} errors.push((m.text() + ' ' + extra).slice(0, 900)); } });
	if (mode === 'er') await page.evaluateOnNewDocument(fs.readFileSync(process.env.ER_FILE || path.join(__dirname, '..', 'er.js'), 'utf8'));
	await page.goto(LIVE, { waitUntil: 'load', timeout: 120000 });
	await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && !!Player, { timeout: 120000 });
	await page.evaluate(() => {
		window.ServerSend = () => {};
		ServerSocket.disconnect?.();
		ServerSocket.emit = () => {};
	});
	if ((await page.evaluate(() => typeof bcModSdk)) === 'undefined') await page.addScriptTag({ url: MODSDK });
	// The real WCE cannot finish starting without a real account, so its profile code is loaded as a copy.
	if (process.env.REAL_WCE) await page.evaluate((src) => new Promise((res) => { const s = document.createElement('script'); s.type = 'module'; s.src = src; s.crossOrigin = 'anonymous'; s.onload = s.onerror = () => res(); document.head.appendChild(s); }), WCE);
	else await page.addScriptTag({ path: path.join(__dirname, 'wce-profile-stub.js') });
	await sleep(4000);
	await page.evaluate(() => {
		const dummy = CharacterLoadSimple?.('ERDummy') ?? CharacterLoadNPC('NPC_ERDummy');
		CharacterAppearanceSetDefault(dummy);
		LoginResponse({
			ID: 'er-test', Name: 'Rose', AccountName: 'ERTEST', MemberNumber: 424242, Creation: Date.now() - 864e5 * 400,
			Money: 100, Owner: '', Title: 'None', Nickname: '', Description: 'Hello! My page: https://example.com/page and a picture https://i.imgur.com/abcd.png end.', AssetFamily: 'Female3DCG',
			Appearance: ServerAppearanceBundle(dummy.Appearance), Inventory: {}, Log: [], Lovership: [], Ownership: null, Reputation: [], Skill: [],
			WhiteList: [], BlackList: [], FriendList: [], GhostList: [], ItemPermission: 2, ArousalSettings: {},
			OnlineSettings: {}, OnlineSharedSettings: {}, GraphicsSettings: {}, ChatSettings: {}, VisualSettings: {},
			AudioSettings: {}, ControllerSettings: {}, GameplaySettings: {}, ImmersionSettings: {}, RestrictionSettings: {},
			ExtensionSettings: {}, Game: {}, LabelColor: '#ff66cc', Difficulty: { Level: 1, LastChange: 0 },
		});
	});
	const frames = async (n) => { for (let i = 0; i < n; i++) { await page.evaluate(() => { try { GameRun(performance.now()); } catch (e) { console.error('frame: ' + e.message); } }); await sleep(120); } };
	await page.evaluate(() => { window.ServerIsConnected = true; if (CurrentScreen !== 'MainHall') CommonSetScreen('Room', 'MainHall'); });
	for (let i = 0; i < 12; i++) { await frames(6); }
	console.log('wce ready:', await page.evaluate(() => ({ note: !!document.getElementById('bceNoteInput'), keys: Object.keys(window).filter((k) => /^(fbc|bce)/i.test(k)).length })));
	await page.evaluate(() => { InformationSheetLoadCharacter(Player); });
	await frames(3);
	console.log('start:', await page.evaluate(async () => { try { OnlineProfile.mode = 'description'; await CommonSetScreen('Character', 'OnlineProfile'); return 'ok ' + CurrentScreen; } catch (e) { return 'threw ' + (e && e.stack || e).toString().slice(0, 600); } }));
	await frames(8);
	const state = () => page.evaluate(() => {
		const rich = document.getElementById('bceRichOnlineProfile');
		const area = document.getElementById('online-profile-description-input');
		const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && !el.hidden && el.getBoundingClientRect().width > 0;
		return {
			wce: (bcModSdk.getModsInfo() || []).filter((m) => /WCE|ER/.test(m.name)).map((m) => m.name + ' ' + m.version).join(', '),
			screen: CurrentScreen,
			rich: !!rich, richInScreen: !!rich && !!rich.closest('#online-profile-screen'), richVisible: vis(rich),
			richLinks: rich ? rich.querySelectorAll('a').length : 0, richImgs: rich ? rich.querySelectorAll('img').length : 0,
			richWidth: rich ? Math.round(rich.getBoundingClientRect().width) : 0, textareaVisible: vis(area),
			buttons: ['er-wce-toggle', 'er-wce-notes', 'er-wce-note-save', 'er-wce-note-close', 'online-profile-save-button', 'online-profile-cancel-button'].map((id) => `${id}:${vis(document.getElementById(id)) ? 'shown' : 'hidden'}`),
			notesOpen: !!document.getElementById('bceNoteInput') && !document.getElementById('bceNoteInput').classList.contains('bce-hidden'),
		};
	});
	console.log('dom:', JSON.stringify(await page.evaluate(() => ({
		standIn: !!document.getElementById('DescriptionInput'), standInParent: document.getElementById('DescriptionInput')?.parentElement?.id,
		erButtons: ['er-wce-toggle', 'er-wce-notes', 'er-wce-note-save'].map((id) => id + ':' + !!document.getElementById(id)),
		noteInput: !!document.getElementById('bceNoteInput'),
		wceSettings: Object.keys(window).filter((k) => /fbc|bce|wce/i.test(k)).slice(0, 15),
		erChart: window.ER ? ER.chart().filter((c) => c.id === 'wce-profile').map((c) => c.status + ' ' + (c.detail || '')) : null,
	}))));
	const result = { opened: await state() };
	if (out) await page.screenshot({ path: out });
	if (mode === 'er') {
		await page.evaluate(() => document.getElementById('er-wce-toggle')?.click());
		await frames(3);
		result.afterToggle = await state();
		await page.evaluate(() => document.getElementById('er-wce-toggle')?.click());
		await frames(3);
		result.toggledBack = await state();
		await page.evaluate(() => document.getElementById('er-wce-notes')?.click());
		await frames(4);
		result.notes = await state();
		if (out) await page.screenshot({ path: out.replace(/\.png$/, '-notes.png') });
		await page.evaluate(() => document.getElementById('er-wce-note-close')?.click());
		await frames(4);
		result.notesClosed = await state();
	}
	console.log(mode, JSON.stringify(result, null, 1));
	console.log('errors:', [...new Set(errors)].slice(0, 8));
	await browser.close();
})();
