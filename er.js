/**
 * ER - Extension Repairer
 * An emergency room for Bondage Club add-ons: when a game update removes or changes something an add-on
 * still uses, ER puts a compatible stand-in back so the add-on keeps working until its own update lands.
 *
 * Every fix checks the game first and only acts when the game is actually missing or broken, so fixes
 * switch themselves off once the game or the add-on catches up. Nothing here changes how the game talks
 * to the server, and nothing is sent anywhere.
 *
 * Open source: https://github.com/Proudkiller0015/extension-repairer (MIT). Type /er in a chat room for the chart.
 */
(function () {
	"use strict";

	/** ER's version; the loader always fetches the newest copy, so this is what players run. */
	const VERSION = "1.6.0";
	/** Where the source lives. */
	const REPO = "https://github.com/Proudkiller0015/extension-repairer";

	const w = /** @type {any} */ (window);
	// One ER per page; a newer copy that an older one handed over to (see below) may take its place.
	if (w.ER && w.ER.version && w.ER.handoverTo !== VERSION) return;

	/** Where the newest ER is published; GitHub Pages updates within a minute of a push. */
	const NEWEST = "https://proudkiller0015.github.io/extension-repairer/er.js";

	/** "1.10.0" > "1.9.2". @param {string} a @param {string} b */
	const newer = (a, b) => {
		const pa = a.split(".").map(Number);
		const pb = b.split(".").map(Number);
		for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
		return false;
	};

	/**
	 * One line on the chart per fix.
	 * @typedef {{ id: string, ext: string, title: string, why: string, patients: string[], status: "treated" | "healthy" | "failed" | "off", detail?: string }} ChartEntry
	 */

	/**
	 * The extensions ER has fixes for. `mods` are their ModSDK names; `tested` is the version ER's fixes were
	 * checked against. When the player runs a different version, that extension's fixes pause (its author may
	 * have fixed it) until ER is tested again, unless the player keeps them on.
	 * @type {Record<string, { label: string, mods?: string[], tested?: string }>}
	 */
	const EXTENSIONS = {
		game: { label: "Game changes (help every add-on)" },
		Echo: { label: "Echo's Clothing Mod", mods: ["服装拓展"], tested: "1.136.5" },
		ULTRAbc: { label: "ULTRAbc", mods: ["ULTRAbc"], tested: "6.4" },
		WCE: { label: "WCE", mods: ["WCE"], tested: "6.3.20" },
		BCX: { label: "BCX", mods: ["BCX"], tested: "1.1.23" },
	};

	/** Where the player's choices are kept (per browser, read before login so fixes can start early). */
	const SETTINGS_KEY = "ER.settings";

	/**
	 * Per extension and per fix: "auto" (ER decides, the default), "on" (forced on, even while paused) or "off".
	 * A fix's own setting wins over its extension's.
	 * @typedef {"auto" | "on" | "off"} Mode
	 * @typedef {{ mode: Record<string, Mode> }} Settings
	 */

	/** @returns {Settings} */
	function loadSettings() {
		try {
			const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
			/** @type {Record<string, Mode>} */
			const mode = {};
			for (const [k, v] of Object.entries(s.mode && typeof s.mode === "object" ? s.mode : {})) if (v === "on" || v === "off") mode[k] = v;
			return { mode };
		} catch {
			return { mode: {} };
		}
	}

	/** @type {Settings} */
	const settings = loadSettings();

	function saveSettings() {
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
		} catch {
			// Storage full or blocked: the choice still holds until reload.
		}
	}

	/** @param {string} key @returns {Mode} */
	const modeOf = (key) => settings.mode[key] ?? "auto";

	/**
	 * The player's forced choice for a fix, if any: its own, else its extension's.
	 * @param {{ id: string, ext: string }} fix
	 * @returns {Mode}
	 */
	const forced = (fix) => (modeOf(fix.id) !== "auto" ? modeOf(fix.id) : modeOf(fix.ext));

	/**
	 * The version of an extension the player runs, once it has registered with ModSDK.
	 * @param {string} ext
	 * @returns {string | undefined}
	 */
	function installedVersion(ext) {
		const names = EXTENSIONS[ext]?.mods;
		if (!names) return undefined;
		const mod = (w.bcModSdk?.getModsInfo?.() ?? []).find((/** @type {any} */ m) => names.includes(m.name));
		return mod ? String(mod.version) : undefined;
	}

	/** "1.136.5-beta.2" and "1.136.5" are the same release. @param {string} v */
	const baseVersion = (v) => v.split(/[-+]/)[0];

	/**
	 * Why ER pauses an extension's fixes by itself, or null when it does not.
	 * @param {string} ext
	 * @returns {string | null}
	 */
	function pausedReason(ext) {
		const info = EXTENSIONS[ext];
		if (!info?.tested) return null;
		const v = installedVersion(ext);
		if (!v || baseVersion(v) === baseVersion(info.tested)) return null;
		return `${info.label} updated to ${v}; ER's fixes were tested with ${info.tested}`;
	}

	/**
	 * Whether a fix should act right now: the player's forced choice, else ER's own call.
	 * @param {{ id: string, ext: string }} fix
	 */
	const active = (fix) => {
		const f = forced(fix);
		if (f !== "auto") return f === "on";
		return !pausedReason(fix.ext);
	};

	/** @type {ChartEntry[]} */
	const chart = [];

	/** The fix being set up, so hooks it adds can be switched off with it. @type {{ id: string, ext: string } | null} */
	let currentFix = null;

	/**
	 * Records the outcome of one fix.
	 * @param {Omit<ChartEntry, "status">} fix
	 * @param {ChartEntry["status"]} status
	 * @param {string} [detail]
	 */
	function note(fix, status, detail) {
		chart.push({ ...fix, status, detail });
	}

	/**
	 * Runs one fix and never lets it break the game or another fix.
	 * @param {Omit<ChartEntry, "status">} fix
	 * @param {() => boolean | string} treat Returns false when nothing needed doing, a string to add detail.
	 */
	function treat(fix, treat) {
		if (forced(fix) === "off") {
			note(fix, "off");
			return;
		}
		currentFix = fix;
		try {
			const res = treat();
			if (res === false) note(fix, "healthy");
			else note(fix, "treated", typeof res === "string" ? res : undefined);
		} catch (e) {
			note(fix, "failed", String((e && e.message) || e));
			console.warn(`[ER] ${fix.id} failed:`, e);
		} finally {
			currentFix = null;
		}
	}

	/**
	 * Puts a removed global back on window, unless the game (or another add-on) already has one.
	 * @param {string} name
	 * @param {PropertyDescriptor} descriptor
	 * @returns {boolean} Whether the stand-in was added.
	 */
	function standIn(name, descriptor) {
		if (name in w) return false;
		Object.defineProperty(w, name, { configurable: true, enumerable: true, ...descriptor });
		standIns.push(name);
		return true;
	}

	/** Names ER has put back, for the chart. @type {string[]} */
	const standIns = [];

	/**
	 * Adds several stand-ins and reports how many were needed.
	 * @param {Record<string, PropertyDescriptor>} map
	 * @returns {false | string}
	 */
	function standIns_(map) {
		const added = Object.entries(map).filter(([n, d]) => standIn(n, d)).map(([n]) => n);
		return added.length ? `put back: ${added.join(", ")}` : false;
	}

	/**
	 * A plain variable stand-in that keeps whatever add-ons write into it.
	 * @param {unknown} value
	 * @returns {PropertyDescriptor}
	 */
	const variable = (value) => ({ value, writable: true });

	/**
	 * A stand-in function that does nothing and returns `ret`.
	 * @param {unknown} [ret]
	 * @returns {PropertyDescriptor}
	 */
	const noop = (ret) => ({ value: function () { return ret; }, writable: true });

	/**
	 * Reads one of the game's own globals, including `const`/`let` ones that are not on window.
	 * @param {() => any} read
	 * @returns {any}
	 */
	function game(read) {
		try {
			return read();
		} catch {
			return undefined;
		}
	}

	/**
	 * The game's release number (R134Beta1 -> 134), used where a check on the function itself would be fooled by
	 * other add-ons' ModSDK wrappers.
	 * @returns {number}
	 */
	const release = () => Number((/^R(\d+)/.exec(String(game(() => GameVersion))) || [])[1]) || 0;

	/** ModSDK handle, made once the SDK is there. @type {any} */
	let sdk = null;

	/**
	 * Hooks a game function through ModSDK, so other add-ons' hooks on it keep working.
	 * @param {string} name
	 * @param {number} priority Higher runs first; ER's argument fixes run before everyone else.
	 * @param {(args: any[], next: (args: any[]) => any) => any} hook
	 * @returns {boolean}
	 */
	function hook(name, priority, hook) {
		if (!sdk || typeof w[name] !== "function") return false;
		const fix = currentFix;
		// Every call checks the player's switches and the auto-pause, so turning a fix off acts at once.
		sdk.hookFunction(name, priority, fix ? (/** @type {any[]} */ args, /** @type {(a: any[]) => any} */ next) => (active(fix) ? hook(args, next) : next(args)) : hook);
		return true;
	}

	// ---- Fixes that only need the game's scripts (run as early as possible, before other add-ons) ----

	/** The fixes that put removed globals back. */
	function standInFixes() {
		treat(
			{
				id: "room-space",
				ext: "game",
				title: "ChatRoomSpace / ChatRoomGame",
				why: "R134 removed them; the room's space and game now live in ChatRoomData and the lobby settings.",
				patients: ["ADCS", "WCE", "LSCG", "MBS", "BCT", "EBC", "MPA", "Themed", "ABCL", "CATS", "AFC", "FCM", "GGC", "Echo", "NotifyPlus", "Responsive (Legacy)", "SlimeBeep"],
			},
			() => {
				/** @type {string | undefined} */
				let space;
				/** @type {string | undefined} */
				let gameName;
				return standIns_({
					ChatRoomSpace: {
						get: () => game(() => ChatRoomData?.Space) ?? space ?? game(() => ChatSearchSpace) ?? "X",
						set: (v) => { space = v; },
					},
					ChatRoomGame: {
						get: () => game(() => ChatRoomData?.Game) ?? gameName ?? game(() => ChatSearchGame) ?? "",
						set: (v) => { gameName = v; },
					},
				});
			},
		);

		treat(
			{
				id: "info-sheet",
				ext: "game",
				title: "InformationSheetSecondScreen",
				why: "R134 rebuilt the profile sheet without its second page; add-ons that hook that page stopped loading.",
				patients: ["ULTRAbc", "AFC", "FCM"],
			},
			() => standIns_({
				InformationSheetSecondScreen: variable(false),
				InformationSheetSecondScreenRun: noop(),
			}),
		);

		treat(
			{
				id: "online-profile",
				ext: "WCE",
				title: "OnlineProfileMode / OnlineProfileText*",
				why: "R134 moved the profile text into the OnlineProfile object.",
				patients: ["WCE"],
			},
			() => {
				const op = () => game(() => OnlineProfile);
				return standIns_({
					OnlineProfileMode: {
						get: () => (op()?.mode === "ownersNotes" ? "OwnersNotes" : "Description"),
						set: (v) => { game(() => OnlineProfileSetMode(v === "OwnersNotes" ? "ownersNotes" : "description")); },
					},
					OnlineProfileTextDesc: { get: () => op()?.description?.() ?? "", set: () => {} },
					OnlineProfileTextOwnersNotes: { get: () => op()?.ownersNotes?.() ?? "", set: () => {} },
					OnlineProfileNotesAvailable: { get: () => !!op()?.notesAvailable?.(), set: () => {} },
				});
			},
		);

		treat(
			{
				id: "room-admin",
				ext: "game",
				title: "ChatAdminVisibilityMode* / ChatAdminAccessMode* / ChatBlockItem*",
				why: "R134 rebuilt the room settings screen; these lists and indexes are gone.",
				patients: ["BC+", "KikiLink", "BCX"],
			},
			() => {
				const vis = game(() => ChatRoomVisibilityMode) ?? {};
				const acc = game(() => ChatRoomAccessMode) ?? {};
				const visLabels = Object.keys(vis);
				const accLabels = Object.keys(acc);
				return standIns_({
					ChatAdminVisibilityModeLabels: variable(visLabels),
					ChatAdminVisibilityModeValues: variable(visLabels.map((k) => vis[k])),
					ChatAdminVisibilityModeIndex: variable(0),
					ChatAdminAccessModeLabels: variable(accLabels),
					ChatAdminAccessModeValues: variable(accLabels.map((k) => acc[k])),
					ChatAdminAccessModeIndex: variable(0),
					ChatBlockItemEditable: variable(true),
					ChatBlockItemReturnScreen: variable(null),
				});
			},
		);

		treat(
			{
				id: "controller",
				ext: "game",
				title: "Controller* (gamepad support)",
				why: "R134 removed gamepad support; add-ons that still register gamepad areas crashed while drawing.",
				patients: ["BCT", "Themed", "ULTRAbc", "EBCH", "MoonCEBC"],
			},
			() => standIns_({
				ControllerIsActive: noop(false),
				ControllerIsEnabled: noop(false),
				ControllerAddActiveArea: noop(),
				ControllerClearAreas: noop(),
				ControllerStart: noop(),
				ControllerProcess: noop(),
				ControllerLoadMapping: noop(),
				ControllerSupportKeyDown: noop(false),
				ControllerActiveAreas: variable([]),
			}),
		);

		treat(
			{
				id: "chat-width",
				ext: "game",
				title: "Long chat messages pushed the map off the screen",
				why: "R134's map rooms put the chat next to the map in a flexible row; the chat has no minimum width, so one long word or link widens it until the map is squeezed to nothing.",
				patients: ["everyone in map rooms"],
			},
			() => {
				if (release() < 134) return false;
				// Game MR !6950 adds this rule; once the game ships it, ER has nothing to do.
				const gameHasIt = [...document.styleSheets].some((sheet) => {
					try {
						return [...sheet.cssRules].some((r) => r instanceof CSSStyleRule && r.selectorText === "#chat-room-div" && r.style.minWidth === "0px");
					} catch {
						return false;
					}
				});
				if (gameHasIt) return false;
				const style = document.createElement("style");
				style.id = "er-chat-width";
				style.textContent = [
					"#chat-room-div { min-width: 0; }",
					"#chat-room-content { flex-shrink: 0; }",
					"#TextAreaChatLog { overflow-wrap: anywhere; }",
				].join("\n");
				(document.head || document.documentElement).append(style);
				return "the chat keeps the width you set";
			},
		);

		treat(
			{
				id: "infiltration",
				ext: "ULTRAbc",
				title: "InfiltrationMission / InfiltrationTarget / InfiltrationDifficulty",
				why: "R134 merged the Pandora mission into one InfiltrationMissionState object.",
				patients: ["ULTRAbc"],
			},
			() => {
				const state = () => game(() => InfiltrationMissionState);
				/** @param {object} part */
				const write = (part) => {
					const next = { ...(state() ?? { Difficulty: 0 }), ...part };
					game(() => (InfiltrationMissionState = next));
				};
				return standIns_({
					InfiltrationMission: { get: () => state()?.Mission ?? "", set: (v) => write({ Mission: v }) },
					InfiltrationDifficulty: { get: () => state()?.Difficulty ?? 0, set: (v) => write({ Difficulty: v }) },
					InfiltrationTarget: {
						get: () => {
							const s = state();
							return s && s.Target ? { Type: s.Target, Name: s.Name, Found: s.Found, Fail: s.Fail, PrivateRoom: s.PrivateRoom } : null;
						},
						set: (t) => write(t ? { Target: t.Type, Name: t.Name, Found: !!t.Found, Fail: !!t.Fail, PrivateRoom: !!t.PrivateRoom } : { Target: undefined }),
					},
					InfiltrationObjectType: { get: () => game(() => InfiltrationObjectList) ?? [], set: () => {} },
				});
			},
		);

		treat(
			{
				id: "helpers",
				ext: "game",
				title: "CommonConvertArrayToString / AssetParseDefaultColor / KidnapReturnFunction",
				why: "Small helpers R134 removed.",
				patients: ["any"],
			},
			() => standIns_({
				CommonConvertArrayToString: { value: (/** @type {unknown[]} */ arr) => arr.join(","), writable: true },
				AssetParseDefaultColor: {
					value: (/** @type {number} */ count, /** @type {string} */ fill, /** @type {unknown} */ color) => {
						const out = Array(count).fill(fill);
						if (typeof color === "string") out.fill(color);
						else if (Array.isArray(color)) color.slice(0, count).forEach((c, i) => (out[i] = c));
						return out;
					},
					writable: true,
				},
				KidnapReturnFunction: variable(""),
			}),
		);
	}

	// ---- Fixes that need ModSDK (argument adapters and the game bug fix) ----

	function hookFixes() {
		treat(
			{
				id: "modular-options",
				ext: "game",
				title: "Modular items only saved their first option",
				why: "R134 beta bug (game MR !6947, not merged yet): a modular item's other modules reset to their first option, e.g. Bar Stool decal, Hypnotic Visor, Echo items.",
				patients: ["everyone"],
			},
			() => {
				const entry = game(() => PropertyData?.TypeRecord);
				if (!entry || typeof entry._difference !== "function") return false;
				const probe = entry._difference.call(entry, [{ a: 1, b: 2 }, { a: 1, b: 2 }]);
				if (probe === undefined) return false;
				/** @param {Record<string, unknown>[]} values */
				const difference = function (values) {
					const [head, ...tail] = values;
					const ret = { ...head };
					for (const obj of tail) {
						for (const [k, v] of Object.entries(obj)) {
							if (v !== undefined && ret[k] === v) delete ret[k];
						}
					}
					return Object.values(ret).some((i) => i !== undefined) ? ret : undefined;
				};
				entry._difference = difference;
				const PDE = game(() => PropertyDataEntry);
				if (PDE && typeof PDE.differenceShallowObjects === "function") PDE.differenceShallowObjects = difference;
				hook("ItemPropertiesDifference", 1000, (args) => {
					const [propertyList, asset, output] = args;
					const ret = output ?? CommonCloneDeep(propertyList[0]) ?? {};
					for (const [propName, propValue] of Object.entries(ret)) {
						if (propValue === undefined) continue;
						const e = PropertyData[propName];
						const propList = [propValue, ...propertyList.map((p) => (p === ret ? undefined : p[propName]))];
						if (e) ret[propName] = e.difference(propList, { asset });
						else if (propList.filter((i) => i === propValue).length >= 2) delete ret[propName];
					}
					return ret;
				});
				return "game fix applied until the game ships it";
			},
		);

		treat(
			{
				id: "fetch-request",
				ext: "Echo",
				title: "Add-on pictures failed to load (CommonFetch with a Request and options)",
				why: "R134's image loader calls CommonFetch(url, {headers}); add-ons that redirect pictures turn the url into a Request, and R134's CommonFetch refuses a Request together with options, so every redirected picture failed (Echo's hair, eyes, sleeves...).",
				patients: ["Echo", "any add-on that redirects game files"],
			},
			() => {
				if (typeof w.CommonFetch !== "function" || release() < 134) return false;
				// Lowest priority: runs last, after the add-on has swapped in its Request.
				hook("CommonFetch", -1000, (args, next) => {
					const [req, options] = args;
					if (!(req instanceof Request) || options == null) return next(args);
					const headers = new Headers(req.headers);
					for (const [k, v] of new Headers(options.headers ?? undefined)) if (!headers.has(k)) headers.set(k, v);
					return next([new Request(req, { headers })]);
				});
				return "redirected pictures load again";
			},
		);

		treat(
			{
				id: "bcx-curse-loop",
				ext: "BCX",
				title: "BCX curses on crafted items looped",
				why: "Since R133 the server sends crafted items back with only part of their craft data; BCX curses compare the full craft, see a change, \"undo all changes\" and loop until BCX's protection switches the curse off.",
				patients: ["BCX"],
			},
			() => {
				if (release() < 133 || typeof w.ServerAppearanceLoadFromBundle !== "function" || typeof w.ChatRoomSyncItem !== "function") return false;
				/** The keys a partial craft keeps. */
				const PARTIAL = ["Name", "MemberName", "MemberNumber", "Description", "Effects", "Private"];
				const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => (typeof w.CommonDeepEqual === "function" ? w.CommonDeepEqual(a, b) : JSON.stringify(a) === JSON.stringify(b));
				const copy = (/** @type {any} */ o) => (typeof w.CommonCloneDeep === "function" ? w.CommonCloneDeep(o) : JSON.parse(JSON.stringify(o)));
				/** A full craft has data beyond what a partial one keeps. @param {any} craft */
				const isFull = (craft) => craft != null && typeof craft === "object" && Object.keys(craft).some((k) => !PARTIAL.includes(k) && k !== "Partial");
				/** The full crafts of the player's worn items, by group. @param {any[]} appearance @param {string[]} [groups] */
				const snapshot = (appearance, groups) => {
					/** @type {Map<string, { name: string, craft: any }>} */
					const saved = new Map();
					for (const item of appearance || []) {
						if (!item?.Asset || !isFull(item.Craft)) continue;
						const group = item.Asset.Group.Name;
						if (groups && !groups.includes(group)) continue;
						saved.set(group, { name: item.Asset.Name, craft: copy(item.Craft) });
					}
					return saved;
				};
				/** Puts the full craft back on items that came back partial but are otherwise the same craft. */
				const restore = (/** @type {any[]} */ appearance, /** @type {Map<string, { name: string, craft: any }>} */ saved) => {
					for (const item of appearance || []) {
						if (!item?.Asset || item.Craft == null || typeof item.Craft !== "object" || isFull(item.Craft)) continue;
						const old = saved.get(item.Asset.Group.Name);
						if (!old || old.name !== item.Asset.Name) continue;
						// The game fills in defaults on load (Effects: {}, Private: false), so missing and default count as equal.
						const norm = (/** @type {string} */ k, /** @type {any} */ v) => (v ?? (k === "Effects" ? {} : k === "Private" ? false : null));
						if (!PARTIAL.every((k) => same(norm(k, old.craft[k]), norm(k, item.Craft[k])))) continue;
						item.Craft = Object.assign(old.craft, item.Craft, { Partial: old.craft.Partial });
						if (item.Craft.Partial === undefined) delete item.Craft.Partial;
					}
				};
				const bcx = () => !!w.BCX_Loaded;
				// Full appearance reloads: the echo of the player's own appearance, room syncs, refreshes.
				hook("ServerAppearanceLoadFromBundle", 0, (args, next) => {
					const C = args[0];
					if (!bcx() || C !== w.Player || args[4]) return next(args);
					const saved = snapshot(C.Appearance);
					const res = next(args);
					if (saved.size) restore(C.Appearance, saved);
					return res;
				});
				// One item changed by someone else (e.g. tightening the cursed collar).
				hook("ChatRoomSyncItem", 0, (args, next) => {
					const data = args[0];
					const group = data?.Item?.Group;
					if (!bcx() || typeof group !== "string" || data.Item.Target !== w.Player?.MemberNumber) return next(args);
					const saved = snapshot(w.Player.Appearance, [group]);
					const res = next(args);
					if (saved.size) restore(w.Player.Appearance, saved);
					return res;
				});
				return "keeps the full craft BCX's curses compare against";
			},
		);

		treat(
			{
				id: "ubc-info-sheet",
				ext: "ULTRAbc",
				title: "ULTRAbc drew its old profile sheet over the new one",
				why: "R134 rebuilt the profile sheet as page elements; ULTRAbc still draws its own canvas copy of the old sheet on top, so the profile shows twice.",
				patients: ["ULTRAbc"],
			},
			() => {
				if (release() < 134 || typeof w.InformationSheetRun !== "function") return false;
				/** @type {boolean | undefined} */
				let ubc;
				const hasUbc = () => (ubc ??= (w.bcModSdk?.getModsInfo?.() ?? []).some((/** @type {any} */ m) => m.name === "ULTRAbc") || undefined) === true;
				/** A canvas nobody sees, for ULTRAbc's old sheet. */
				let scratch = /** @type {CanvasRenderingContext2D | null} */ (null);
				let reached = false;
				// Lowest priority: tells us whether the game's own sheet was reached.
				hook("InformationSheetRun", -1000, (args, next) => {
					reached = true;
					return next(args);
				});
				// Just above ULTRAbc's hook (priority 4): add-ons with higher priorities run normally first.
				hook("InformationSheetRun", 5, (args, next) => {
					if (!hasUbc()) return next(args);
					reached = false;
					const real = game(() => MainCanvas);
					if (!scratch) {
						const c = document.createElement("canvas");
						c.width = real?.canvas?.width ?? 2000;
						c.height = real?.canvas?.height ?? 1000;
						scratch = c.getContext("2d");
					}
					let res;
					try {
						MainCanvas = scratch;
						res = next(args);
					} finally {
						MainCanvas = real;
					}
					if (!reached && sdk) sdk.callOriginal("InformationSheetRun", args);
					return res;
				});
				return "the game's profile sheet shows alone";
			},
		);

		treat(
			{
				id: "baseline-options",
				ext: "Echo",
				title: "Items with options in their baseline could not change options",
				why: "R134 merges a new option into the item keeping the old value; when an add-on puts its options in BaselineProperty (e.g. Echo's 标志纹饰), the old options always won.",
				patients: ["Echo", "any add-on item with BaselineProperty.TypeRecord"],
			},
			() => {
				const entry = game(() => PropertyData?.TypeRecord);
				// R133 merged options with its own PropertyUnion (new value wins); only R134's property system keeps the old one.
				if (release() < 134 || !entry || typeof entry._union !== "function" || typeof w.ExtendedItemSetProperty !== "function") return false;
				const merged = entry._union.call(entry, [{ a: 1 }, { a: 2 }]);
				if (!merged || merged.a !== 1) return false;
				hook("ExtendedItemSetProperty", 1000, (args, next) => {
					const [C, item, previousProperty, newProperty, push = false, refresh = true] = args;
					// Merge before the game refreshes (and possibly sends) the item, then refresh as asked.
					const res = next([C, item, previousProperty, newProperty, false, false]);
					const chosen = newProperty && newProperty.TypeRecord;
					if (item && item.Property && chosen && typeof chosen === "object") {
						item.Property.TypeRecord = { ...(item.Property.TypeRecord || {}), ...chosen };
					}
					if (refresh || push) w.CharacterRefresh(C, push, false);
					return res;
				});
				return "the chosen option wins again, like R133";
			},
		);

		treat(
			{
				id: "default-color",
				ext: "Echo",
				title: "Add-on items lost their default colours",
				why: "R134 reads default colours only from each layer's Color; the item-level DefaultColor add-ons use is ignored, so their items come out uncoloured and some (e.g. Echo's 淫纹) crash while drawing.",
				patients: ["Echo", "any add-on with its own items"],
			},
			() => {
				if (typeof w.AssetAssignDefaultColor !== "function" || typeof w.AssetMapLayer !== "function") return false;
				// Add-ons often call the original AssetAdd (skipping hooks), but AssetAdd itself still calls these two
				// by name: AssetMapLayer sees the item definition, AssetAssignDefaultColor sets the colours.
				/** @type {WeakMap<object, any>} */
				const defs = new WeakMap();
				hook("AssetMapLayer", 1000, (args, next) => {
					if (args[1] && args[3]) defs.set(args[1], args[3]);
					return next(args);
				});
				hook("AssetAssignDefaultColor", 1000, (args, next) => {
					const res = next(args);
					const asset = args[0];
					const def = asset && defs.get(asset);
					if (!def || def.DefaultColor == null) return res;
					// Add-ons already written for R134 colour their layers themselves.
					if (Array.isArray(def.Layer) && def.Layer.some((/** @type {any} */ l) => Array.isArray(l.Color) && l.Color.length)) return res;
					const fill = asset.Group.ColorSchema[0];
					const old = Array(asset.ColorableLayerCount).fill(fill);
					if (typeof def.DefaultColor === "string") old.fill(def.DefaultColor);
					else if (Array.isArray(def.DefaultColor)) def.DefaultColor.slice(0, old.length).forEach((/** @type {string} */ c, /** @type {number} */ i) => (old[i] = c));
					asset.DefaultColor = old;
					for (const layer of asset.Layer) {
						if (layer.AllowColorize && typeof layer.ColorIndex === "number" && old[layer.ColorIndex] !== undefined) layer.Color = [old[layer.ColorIndex]];
					}
					return res;
				});
				return "add-on items get their own default colours back";
			},
		);

		treat(
			{
				id: "arousal-active",
				ext: "WCE",
				title: "PreferenceArousalIsActive() without a character",
				why: "R134 made it take a character; old calls with none crashed.",
				patients: ["WCE"],
			},
			() => {
				if (release() < 134) return false;
				return hook("PreferenceArousalIsActive", 1000, (args, next) => next(args[0] == null ? [w.Player, ...args.slice(1)] : args)) && "old calls use the player";
			},
		);

		treat(
			{
				id: "item-header",
				ext: "game",
				title: "ExtendedItemDrawHeader(X, Y, Item)",
				why: "R134 moved Item to the first argument and dropped the DialogFocusItem defaults.",
				patients: ["any"],
			},
			() => {
				if (release() < 134) return false;
				hook("ExtendedItemDrawHeader", 1000, (args, next) => (typeof args[0] === "number" || args.length === 0 ? next([args[2] ?? w.DialogFocusItem, args[0] ?? 1387, args[1] ?? 55]) : next(args)));
				hook("ExtendedItemFunctionPrefix", 1000, (args, next) => next(args.length ? args : [w.DialogFocusItem]));
				hook("ExtendedItemDrawButton", 1000, (args, next) => {
					if (args[4] === undefined) args[4] = w.DialogFocusItem;
					return next(args);
				});
				hook("ExtendedItemGetButtonColor", 1000, (args, next) => {
					if (args[6] === undefined) args[6] = w.DialogFocusItem;
					return next(args);
				});
				return "old argument order accepted";
			},
		);

		treat(
			{
				id: "debounce",
				ext: "game",
				title: "CommonDebounce(func) / CommonThrottle(func)",
				why: "R134 changed them to (interval, func) returning fn(...args); old callers passed only func and gave the interval on each call.",
				patients: ["any"],
			},
			() => {
				if (release() < 134) return false;
				for (const name of ["CommonDebounce", "CommonThrottle"]) {
					hook(name, 1000, (args, next) => {
						if (typeof args[0] !== "function") return next(args);
						const func = args[0];
						/** @type {Map<number, Function>} */
						const byWait = new Map();
						return function (/** @type {number} */ wait, /** @type {unknown[]} */ ...rest) {
							let fn = byWait.get(wait);
							if (!fn) byWait.set(wait, (fn = next([wait, func])));
							return fn.apply(this, rest);
						};
					});
				}
				return "old one-argument form accepted";
			},
		);
	}

	// ---- The panel: Preferences > Extensions > ER, or /er in a chat room ----

	/**
	 * ER's own call on a fix, shown next to its switch.
	 * @param {ChartEntry} c
	 * @returns {{ state: "running" | "paused" | "idle" | "off" | "failed", text: string }}
	 */
	function verdict(c) {
		if (c.status === "failed") return { state: "failed", text: `could not apply: ${c.detail ?? "error"}` };
		if (c.status === "off") return { state: "off", text: "switched off when the game loaded; reload after turning it back on" };
		if (c.status === "healthy") return { state: "idle", text: "not needed: this game version has what the add-ons use" };
		const f = forced(c);
		const paused = pausedReason(c.ext);
		if (f === "off") return { state: "off", text: "forced off" };
		if (paused && f !== "on") return { state: "paused", text: `paused by ER: ${paused}` };
		if (paused) return { state: "running", text: `forced on (${paused})` };
		return { state: "running", text: `should run: ${c.detail ?? "needed on this game version"}` };
	}

	const PANEL_ID = "er-panel";

	const CSS = `
#er-panel { position: fixed; top: 4vh; left: 50%; transform: translateX(-50%); width: min(760px, 94vw); max-height: 92vh; z-index: 100000;
	display: flex; flex-direction: column; background: #fff; color: #1d1a1a; border-radius: 14px; overflow: hidden;
	box-shadow: 0 12px 48px rgba(0,0,0,.45); font: 15px/1.45 system-ui, "Segoe UI", sans-serif; text-align: left; }
#er-panel * { box-sizing: border-box; }
#er-panel .er-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #d81e1e; color: #fff; }
#er-panel .er-cross { width: 34px; height: 34px; flex: none; position: relative; background: #fff; border-radius: 8px; }
#er-panel .er-cross::before, #er-panel .er-cross::after { content: ""; position: absolute; background: #d81e1e; border-radius: 2px; }
#er-panel .er-cross::before { left: 13px; top: 6px; width: 8px; height: 22px; }
#er-panel .er-cross::after { left: 6px; top: 13px; width: 22px; height: 8px; }
#er-panel .er-logo { width: 40px; height: 40px; flex: none; border-radius: 9px; background: #fff; }
#er-panel .er-title { font-weight: 700; font-size: 17px; }
#er-panel .er-sub { opacity: .9; font-size: 13px; }
#er-panel .er-close { margin-left: auto; background: rgba(255,255,255,.18); color: #fff; border: 0; border-radius: 8px; width: 34px; height: 34px; font-size: 18px; cursor: pointer; }
#er-panel .er-body { overflow: auto; padding: 10px 16px 4px; }
#er-panel .er-help { font-size: 13px; color: #5d5555; margin: 2px 0 8px; }
#er-panel .er-ext { border: 1px solid #ead9d9; border-radius: 10px; margin: 10px 0; overflow: hidden; }
#er-panel .er-ext-head { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: #fbf3f3; }
#er-panel .er-ext-name { font-weight: 700; }
#er-panel .er-ext-ver { font-size: 12px; color: #6b6464; }
#er-panel .er-fix { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 8px 10px; border-top: 1px solid #f3e6e6; }
#er-panel .er-fix-title { font-weight: 600; }
#er-panel .er-why { grid-column: 1 / -1; font-size: 12px; color: #6b6464; }
#er-panel .er-verdict { grid-column: 1 / -1; font-size: 13px; }
#er-panel .er-pill { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 99px; margin-right: 6px; color: #fff; }
#er-panel .er-running { background: #1f9d55; }
#er-panel .er-paused { background: #b45309; }
#er-panel .er-idle { background: #6b6464; }
#er-panel .er-off { background: #3f3939; }
#er-panel .er-failed { background: #d81e1e; }
#er-panel .er-seg { display: inline-flex; border: 1px solid #d9c4c4; border-radius: 8px; overflow: hidden; margin-left: auto; flex: none; align-self: start; }
#er-panel .er-seg button { border: 0; background: #fff; color: #1d1a1a; padding: 4px 10px; font: inherit; font-size: 13px; cursor: pointer; }
#er-panel .er-seg button + button { border-left: 1px solid #d9c4c4; }
#er-panel .er-seg button[aria-pressed="true"] { background: #d81e1e; color: #fff; }
#er-panel .er-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 16px; border-top: 1px solid #ead9d9; font-size: 13px; color: #5d5555; }
#er-panel .er-foot button { margin-left: auto; background: #d81e1e; color: #fff; border: 0; border-radius: 8px; padding: 7px 14px; font: inherit; font-weight: 600; cursor: pointer; }
#er-panel a { color: #d81e1e; }
`;

	/**
	 * Builds an element with text only (never HTML), so names and messages cannot inject markup.
	 * @param {string} tag
	 * @param {string} [cls]
	 * @param {string} [text]
	 */
	function el(tag, cls, text) {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}

	/**
	 * The Auto / On / Off switch for one key.
	 * @param {string} key An extension id or a fix id.
	 * @param {string} label What the switch is for, for screen readers.
	 */
	function modeSwitch(key, label) {
		const seg = el("span", "er-seg");
		seg.setAttribute("role", "group");
		seg.setAttribute("aria-label", label);
		for (const m of /** @type {Mode[]} */ (["auto", "on", "off"])) {
			const b = /** @type {HTMLButtonElement} */ (el("button", undefined, m === "auto" ? "Auto" : m === "on" ? "On" : "Off"));
			b.type = "button";
			b.setAttribute("aria-pressed", String(modeOf(key) === m));
			b.addEventListener("click", () => {
				if (m === "auto") delete settings.mode[key];
				else settings.mode[key] = m;
				saveSettings();
				renderPanel();
			});
			seg.append(b);
		}
		return seg;
	}

	/** Draws (or redraws) the panel's contents. */
	function renderPanel() {
		const panel = document.getElementById(PANEL_ID);
		if (!panel) return;
		const body = /** @type {HTMLElement} */ (panel.querySelector(".er-body"));
		const scroll = body.scrollTop;
		body.replaceChildren();
		body.append(
			el(
				"p",
				"er-help",
				"Every switch starts on Auto: ER runs a fix only when the game needs it, and pauses an extension's fixes by itself when that extension updates past the version ER was tested with. Use On or Off to force a choice.",
			),
		);
		for (const [ext, info] of Object.entries(EXTENSIONS)) {
			const fixes = chart.filter((c) => c.ext === ext);
			if (!fixes.length) continue;
			const box = el("section", "er-ext");
			const head = el("div", "er-ext-head");
			const names = el("div");
			names.append(el("div", "er-ext-name", info.label));
			if (info.mods) {
				const v = installedVersion(ext);
				const paused = pausedReason(ext);
				names.append(
					el("div", "er-ext-ver", v ? `installed ${v} · tested ${info.tested}${paused ? " · ER pauses these fixes until it is tested again" : ""}` : `not loaded · tested ${info.tested}`),
				);
			}
			head.append(names, modeSwitch(ext, `${info.label}: all fixes`));
			box.append(head);
			for (const c of fixes) {
				const row = el("div", "er-fix");
				row.append(el("div", "er-fix-title", c.title), modeSwitch(c.id, c.title));
				const v = verdict(c);
				const verdictLine = el("div", "er-verdict");
				verdictLine.append(el("span", `er-pill er-${v.state}`, v.state === "idle" ? "not needed" : v.state), document.createTextNode(`ER: ${v.text}`));
				row.append(verdictLine, el("div", "er-why", `${c.why} Helps: ${c.patients.join(", ")}.`));
				box.append(row);
			}
			body.append(box);
		}
		body.scrollTop = scroll;
	}

	function closePanel() {
		document.getElementById(PANEL_ID)?.remove();
		document.getElementById(`${PANEL_ID}-style`)?.remove();
	}

	/** Opens the panel. @param {() => void} [onClose] */
	function openPanel(onClose) {
		closePanel();
		const style = el("style");
		style.id = `${PANEL_ID}-style`;
		style.textContent = CSS;
		document.head.append(style);
		const panel = el("div");
		panel.id = PANEL_ID;
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-label", "ER - Extension Repairer");
		const head = el("div", "er-head");
		const titles = el("div");
		titles.append(el("div", "er-title", `ER - Extension Repairer ${VERSION}`), el("div", "er-sub", `Emergency room for add-ons · game ${game(() => GameVersion) ?? "?"}`));
		const close = /** @type {HTMLButtonElement} */ (el("button", "er-close", "✕"));
		close.type = "button";
		close.setAttribute("aria-label", "Close");
		close.addEventListener("click", () => {
			closePanel();
			onClose?.();
		});
		const logo = /** @type {HTMLImageElement} */ (el("img", "er-logo"));
		logo.src = LOGO;
		logo.alt = "";
		logo.addEventListener("error", () => logo.replaceWith(el("div", "er-cross")));
		head.append(logo, titles, close);
		const body = el("div", "er-body");
		const foot = el("div", "er-foot");
		const link = el("a", undefined, "Source and reports");
		link.setAttribute("href", REPO);
		link.setAttribute("target", "_blank");
		link.setAttribute("rel", "noopener");
		const reload = /** @type {HTMLButtonElement} */ (el("button", undefined, "Reload to apply"));
		reload.type = "button";
		reload.addEventListener("click", () => location.reload());
		foot.append(el("span", undefined, "Most switches act at once; fixes that start with the game need a reload."), link, reload);
		panel.append(head, body, foot);
		// Keys typed in the panel must not reach the game.
		panel.addEventListener("keydown", (e) => e.stopPropagation());
		document.body.append(panel);
		renderPanel();
	}

	/** ER's logo, from the repo (the same files the install page uses). */
	const LOGO = "https://cdn.jsdelivr.net/gh/Proudkiller0015/extension-repairer@main/icon-128.png";

	/** A red cross, used if the logo cannot load. */
	const ICON = `data:image/svg+xml,${encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#d81e1e"/><rect x="26" y="12" width="12" height="40" rx="3" fill="#fff"/><rect x="12" y="26" width="40" height="12" rx="3" fill="#fff"/></svg>',
	)}`;

	/** Adds ER to Preferences > Extensions. @returns {boolean} Whether the game was ready for it. */
	function registerSettings() {
		const registry = game(() => PreferenceExtensionsSettings);
		if (typeof w.PreferenceRegisterExtensionSetting !== "function" || !registry || typeof registry !== "object") return false;
		if (registry.ER) return true;
		w.PreferenceRegisterExtensionSetting({
			Identifier: "ER",
			ButtonText: "ER - Extension Repairer",
			Image: LOGO,
			load: () => openPanel(() => game(() => PreferenceSubscreenExtensionsClear())),
			run: () => {},
			click: () => {},
			exit: () => {
				closePanel();
				return true;
			},
			unload: () => closePanel(),
		});
		return true;
	}

	function registerCommand() {
		if (typeof w.CommandCombine !== "function" || !Array.isArray(w.Commands) || w.Commands.some((/** @type {any} */ c) => c.Tag === "er")) return;
		w.CommandCombine([
			{
				Tag: "er",
				Description: ": ER - Extension Repairer: open the fixes panel",
				Action: () => openPanel(),
			},
		]);
	}

	// ---- Start ----

	/**
	 * The game's own scripts are all in index.html, so they have all run once the document is parsed. Starting
	 * earlier could put a stand-in in front of a name the game is still about to declare.
	 */
	const ready = () => document.readyState !== "loading" && typeof w.GameVersion === "string" && typeof w.CommonSetScreen === "function";

	function start() {
		standInFixes();
		const sdkReady = () => {
			if (!w.bcModSdk) return false;
			sdk = w.bcModSdk.registerMod({ name: "ER", fullName: "ER - Extension Repairer", version: VERSION, repository: REPO });
			hookFixes();
			return true;
		};
		const commandTimer = setInterval(() => {
			if (typeof w.CommandCombine === "function" && Array.isArray(w.Commands)) {
				registerCommand();
				clearInterval(commandTimer);
			}
		}, 500);
		if (!registerSettings()) {
			const t = setInterval(() => registerSettings() && clearInterval(t), 500);
		}
		if (!sdkReady()) {
			const t = setInterval(() => sdkReady() && clearInterval(t), 100);
		}
		const treated = () => chart.filter((c) => c.status === "treated").map((c) => c.id);
		console.info(`%c✚ ER ${VERSION}%c treating: ${treated().join(", ") || "nothing"} (settings: /er or Preferences > Extensions)`, "color:#e02424;font-weight:bold", "");
	}

	w.ER = {
		version: VERSION,
		repository: REPO,
		/** The chart: what each fix found. */
		chart: () => chart.map((c) => ({ ...c })),
		/** Names ER put back on window. */
		standIns: () => [...standIns],
		/** Opens the fixes panel. */
		open: () => openPanel(),
	};

	/**
	 * CDNs can keep handing out an old copy for hours. Before starting, ask GitHub Pages for its version; if it is
	 * newer, load that copy instead of this one. Gives up after 3 seconds so ER still starts offline.
	 * @returns {Promise<boolean>} Whether this copy should start.
	 */
	async function shouldStart() {
		if (w.ER?.handoverTo === VERSION) return true;
		try {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 3000);
			const text = await (await fetch(`${NEWEST}?v=${Date.now()}`, { cache: "no-store", signal: ctrl.signal })).text();
			clearTimeout(timer);
			const latest = /const VERSION = "(\d+\.\d+\.\d+)"/.exec(text)?.[1];
			if (latest && newer(latest, VERSION)) {
				w.ER.handoverTo = latest;
				const script = document.createElement("script");
				script.src = `${NEWEST}?v=${latest}`;
				script.crossOrigin = "anonymous";
				// If the newer copy cannot load after all, this one starts.
				script.addEventListener("error", () => go());
				(document.head || document.documentElement).append(script);
				console.info(`[ER] ${VERSION} is outdated; loading ${latest}`);
				return false;
			}
		} catch {
			// Offline or blocked: this copy is fine.
		}
		return true;
	}

	let started = false;
	function go() {
		if (started) return;
		started = true;
		if (ready()) start();
		else {
			const t = setInterval(() => {
				if (ready()) {
					clearInterval(t);
					start();
				}
			}, 50);
		}
	}

	shouldStart().then((ok) => ok && go());
})();
