// ER survey: loads FUSAM add-ons into a BC build as a fake logged-in player and records what goes wrong.
// usage: node tools/survey.js <live|beta> <outdir> <addonId[:dist]> [...]
// Each add-on runs in its own fresh page: ModSDK, the add-on, a fake login, the main hall, a fake chat room,
// a few frames of drawing, opening the player's dialog. Errors, ModSDK warnings and stuck init are recorded.
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const BUILDS = {
	live: 'https://www.bondageprojects.elementfx.com/R133/BondageClub/',
	beta: 'https://www.bondageprojects.elementfx.com/R133/2684902840521/',
};
const MANIFEST = 'https://sidiousious.gitlab.io/bc-addon-loader/manifest.json';
const MODSDK = 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1.2.0/dist/bcmodsdk.js';
const [build, outDir, ...wanted] = process.argv.slice(2);
const BASE = process.env.ER_BASE || BUILDS[build];
// Noise that every run has with or without add-ons: missing art, blocked sockets, the headless GPU.
const NOISE = /Failed to load (resource|image)|status of 404|WebSocket|ERR_NAME_NOT_RESOLVED|net::ERR|socket\.io|GPU stall|Server connection lost|favicon|Autoplay|play\(\) failed|AudioContext|\[object Object\]$|preload/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(browser, addon, dist) {
	const version = addon.versions.find((v) => v.distribution === dist) || addon.versions[0];
	const page = await browser.newPage();
	await page.setViewport({ width: 2000, height: 1000 });
	const logs = [];
	const push = (kind, text) => {
		text = String(text).replace(/\s+/g, ' ').slice(0, 500);
		if (!NOISE.test(text)) logs.push(`${kind} ${text}`);
	};
	page.on('console', (m) => {
		const t = m.text();
		if (m.type() === 'error' || m.type() === 'warn' || m.type() === 'warning' || /ModSDK|unsupported|incompatib|not supported|outdated/i.test(t)) push(m.type(), t);
	});
	page.on('pageerror', (e) => push('pageerror', String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
	const result = { id: addon.id, dist: version.distribution, source: version.source, type: addon.type };
	try {
		await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
		await page.waitForFunction(() => typeof Asset !== 'undefined' && Asset.length > 1000 && typeof Player !== 'undefined' && !!Player, { timeout: 120000 });
		result.game = await page.evaluate(() => GameVersion);
		// Nothing may reach the real server.
		await page.evaluate(() => {
			window.erSent = [];
			window.ServerSend = (msg, data) => window.erSent.push([msg, data]);
			ServerSocket.disconnect?.();
			ServerSocket.emit = (...a) => window.erSent.push(a);
		});
		await page.addScriptTag({ url: MODSDK });
		if (process.env.ER_FILE) {
			await page.addScriptTag({ path: process.env.ER_FILE });
			await page.waitForFunction(() => window.ER && window.ER.chart().length > 6, { timeout: 15000 }).catch(() => push('harness', 'ER did not start'));
		}
		const before = new Set(await page.evaluate(() => Object.keys(window)));
		// FUSAM's three loader types.
		if (version.source) {
			if (addon.type === 'eval') {
				const code = await (await fetch(version.source)).text();
				await page.evaluate((c) => { (0, eval)(c); }, code).catch((e) => push('loaderror', e.message));
			} else {
				await page.evaluate((src, mod) => new Promise((res) => {
					const s = document.createElement('script');
					if (mod) s.type = 'module';
					s.src = src;
					s.crossOrigin = 'anonymous';
					s.onload = () => res();
					s.onerror = () => res(console.error('ER: script failed to load ' + src));
					document.head.appendChild(s);
				}), version.source, addon.type === 'module');
			}
		}
		for (const extra of (process.env.ER_EXTRA || '').split(',').filter(Boolean)) {
			await page.evaluate((src) => new Promise((res) => { const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = s.onerror = () => res(); document.head.appendChild(s); }), extra);
		}
		await sleep(4000);
		// A fake login, the same shape the server sends.
		await page.evaluate(() => {
			const dummy = CharacterLoadSimple?.('ERDummy') ?? CharacterLoadNPC('NPC_ERDummy');
			CharacterAppearanceSetDefault(dummy);
			const appearance = ServerAppearanceBundle(dummy.Appearance);
			LoginResponse({
				ID: 'er-test', Name: 'Rose', AccountName: 'ERTEST', MemberNumber: 424242, Creation: Date.now() - 864e5 * 400,
				Money: 100, Owner: '', Title: 'None', Nickname: '', Description: '', AssetFamily: 'Female3DCG',
				Appearance: appearance, Inventory: {}, Log: [], Lovership: [], Ownership: null, Reputation: [], Skill: [],
				WhiteList: [], BlackList: [], FriendList: [], GhostList: [], ItemPermission: 2, ArousalSettings: {},
				OnlineSettings: {}, OnlineSharedSettings: {}, GraphicsSettings: {}, ChatSettings: {}, VisualSettings: {},
				AudioSettings: {}, ControllerSettings: {}, GameplaySettings: {}, ImmersionSettings: {}, RestrictionSettings: {},
				ExtensionSettings: {}, Game: {}, LabelColor: '#ff66cc', Difficulty: { Level: 1, LastChange: 0 },
			});
		}).catch((e) => push('loginerror', e.message));
		await sleep(8000);
		// Main hall frames, then a fake chat room with a second player, then the player's item dialog.
		const step = async (label, fn) => {
			try { await page.evaluate(fn); } catch (e) { push(`step:${label}`, e.message); }
			for (let i = 0; i < 6; i++) {
				await page.evaluate(() => { try { GameRun(performance.now()); } catch (e) { console.error('ER frame: ' + e.message); } }).catch(() => {});
				await sleep(150);
			}
		};
		await step('mainhall', () => { if (CurrentScreen !== 'MainHall') CommonSetScreen('Room', 'MainHall'); });
		if (process.env.ER_SHOT) {
			await sleep(4000);
			for (let i = 0; i < 4; i++) { await page.evaluate(() => { try { GameRun(performance.now()); } catch (e) { console.error('ER frame: ' + e.message); } }); await sleep(300); }
			await page.screenshot({ path: path.join(outDir, `${build}-${addon.id}-mainhall.png`) });
		}
		if (process.env.ER_INFO) {
			await page.evaluate(() => InformationSheetLoadCharacter(Player)).catch((e) => push('step:info', e.message));
			await sleep(3000);
			const infoScreen = await page.evaluate(() => CurrentScreen);
			push('info', 'screen ' + infoScreen);
			for (let i = 0; i < 4; i++) {
				await page.evaluate(() => { try { MainCanvas.fillStyle = '#ccc'; MainCanvas.fillRect(0, 0, 2000, 1000); InformationSheetRun(); } catch (e) { console.error('ER frame: ' + e.message); } });
				await sleep(400);
			}
			push('info', 'MainCanvas is the real one: ' + await page.evaluate(() => MainCanvas === document.getElementById('MainCanvas')?.getContext('2d') || MainCanvas?.canvas?.id));
			await page.screenshot({ path: path.join(outDir, `${build}-${addon.id}-info.png`) });
			await page.evaluate(() => { try { InformationSheetExit(); } catch {} });
		}
		await step('chatroom', () => {
			const other = CharacterLoadOnline({ ID: 'g', Name: 'Gangriel', Nickname: 'Gangriel', MemberNumber: 2002, AssetFamily: 'Female3DCG', Appearance: ServerAppearanceBundle(Player.Appearance), Title: '', Ownership: null, Lovership: [], ItemPermission: 1, BlockItems: [], LimitedItems: [], FavoriteItems: [], WhiteList: [], BlackList: [], OnlineSharedSettings: { GameVersion }, ArousalSettings: {}, Game: {}, Inventory: [] }, 2002);
			ChatRoomData = { Name: 'ER', Description: '', Admin: [Player.MemberNumber], Whitelist: [], Ban: [], BlockCategory: [], Character: [], Limit: 10, Background: 'MainHall', Space: '', Visibility: ['All'], Access: ['All'], Language: 'EN', Custom: {}, MapData: { Type: 'Never' } };
			ChatRoomCharacter = [Player, other];
			CommonSetScreen('Online', 'ChatRoom');
			ChatRoomMessage({ Sender: 2002, Content: 'hello', Type: 'Chat', Dictionary: [] });
			ChatRoomMessage({ Sender: 2002, Content: 'Beep', Type: 'Emote', Dictionary: [] });
		});
		if (process.env.ER_PANEL) {
			const r = await page.evaluate(() => {
				const out = { hasCmd: Commands.some((c) => c.Tag === 'er'), hasPref: !!PreferenceExtensionsSettings?.ER, pause: ER.chart().filter((c) => c.ext === 'Echo').map((c) => c.status) };
				try { CommandParse('/er'); } catch (e) { out.err = e.message; }
				out.panel = !!document.getElementById('er-panel');
				return out;
			});
			push('panel', JSON.stringify(r));
			await sleep(500);
			await page.screenshot({ path: path.join(outDir, `${build}-${addon.id}-panel.png`) });
			await page.evaluate(() => document.getElementById('er-panel')?.remove());
		}
		if (process.env.ER_EVAL) {
			await sleep(1500);
			const r = await page.evaluate(process.env.ER_EVAL).catch((e) => 'eval error: ' + e.message);
			push('eval', typeof r === 'string' ? r : JSON.stringify(r));
			await sleep(2500);
			await page.screenshot({ path: path.join(outDir, `${build}-${addon.id}-eval.png`) });
		}
		await step('dialog', () => { ChatRoomFocusCharacter?.(Player) ?? DialogLoad?.(Player); });
		await step('wardrobe', () => { DialogLeave?.(); CharacterAppearanceLoadCharacter?.(Player); });
		result.globals = (await page.evaluate(() => Object.keys(window))).filter((k) => !before.has(k)).slice(0, 30);
		result.mods = await page.evaluate(() => (window.bcModSdk?.getModsInfo?.() || []).map((m) => `${m.name}@${m.version}`));
		result.patched = await page.evaluate(() => {
			const info = window.bcModSdk?.getPatchingInfo?.();
			if (!info) return [];
			return [...info.values()].map((p) => ({ name: p.name, hooked: p.hookedByMods?.length ?? null, patched: p.patchedByMods?.length ?? null, hash: p.originalHash }));
		});
		result.er = await page.evaluate(() => window.ER ? window.ER.chart().map((c) => `${c.status} ${c.id}${c.detail ? ' ' + c.detail : ''}`) : null);
		result.sent = await page.evaluate(() => [...new Set(window.erSent.map((s) => s[0]))]);
	} catch (e) {
		push('harness', e.message);
	}
	result.logs = [...new Set(logs)];
	await page.close();
	return result;
}

(async () => {
	const manifest = await (await fetch(MANIFEST)).json();
	const addons = manifest.addons || manifest;
	fs.mkdirSync(outDir, { recursive: true });
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
	for (const w of wanted) {
		const [id, dist = 'stable'] = w.split(':');
		const addon = id === 'none' ? { id: 'none', type: 'script', versions: [{ distribution: 'stable', source: null }] } : addons.find((a) => a.id === id);
		if (!addon) { console.log(`unknown ${id}`); continue; }
		const r = await runOne(browser, addon, dist);
		fs.writeFileSync(path.join(outDir, `${build}-${id}-${r.dist}.json`), JSON.stringify(r, null, 1));
		console.log(`${build} ${id}:${r.dist} logs=${r.logs.length} mods=${(r.mods || []).join(',')}`);
	}
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
