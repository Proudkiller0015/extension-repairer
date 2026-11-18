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
	const VERSION = "1.13.3";
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
	 * @typedef {{ id: string, ext: string, title: string, why: string, patients: string[], selfCheck?: boolean, status: "treated" | "healthy" | "failed" | "off", detail?: string }} ChartEntry
	 */

	/**
	 * The extensions ER has fixes for. `mods` are their ModSDK names; `tested` is the version ER's fixes were
	 * checked against. When the player runs a different version, that extension's fixes pause (its author may
	 * have fixed it) until ER is tested again, unless the player keeps them on.
	 * @type {Record<string, { label: string, mods?: string[], tested?: string | string[] }>}
	 */
	const EXTENSIONS = {
		game: { label: "Game changes (help every add-on)" },
		Echo: { label: "Echo's Clothing Mod", mods: ["服装拓展"], tested: ["1.136.5", "1.136.6"] },
		WCE: { label: "WCE", mods: ["WCE"], tested: "6.3.20" },
		BCX: { label: "BCX", mods: ["BCX"], tested: ["1.1.23", "1.1.24", "1.1.25"] },
		LSCG: { label: "LSCG", mods: ["LSCG"], tested: "0.9.16" },
	};

	/** Where the player's choices are kept (per browser, read before login so fixes can start early). */
	const SETTINGS_KEY = "ER.settings";

	/**
	 * Per extension and per fix: "auto" (ER decides, the default), "on" (forced on, even while paused) or "off".
	 * A fix's own setting wins over its extension's.
	 * @typedef {"auto" | "on" | "off"} Mode
	 * @typedef {{ mode: Record<string, Mode>, notifyUpdates: boolean }} Settings
	 */

	/** @returns {Settings} */
	function loadSettings() {
		try {
			const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
			/** @type {Record<string, Mode>} */
			const mode = {};
			for (const [k, v] of Object.entries(s.mode && typeof s.mode === "object" ? s.mode : {})) if (v === "on" || v === "off") mode[k] = v;
			return { mode, notifyUpdates: s.notifyUpdates !== false };
		} catch {
			return { mode: {}, notifyUpdates: true };
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
		const tested = [info.tested].flat();
		if (!v || tested.some((t) => baseVersion(t) === baseVersion(v))) return null;
		return `${info.label} updated to ${v}; ER's fixes were tested with ${tested.join(" and ")}`;
	}

	/**
	 * Whether a fix should act right now: the player's forced choice, else ER's own call.
	 * @param {{ id: string, ext: string }} fix
	 */
	const active = (fix) => {
		const f = forced(fix);
		if (f !== "auto") return f === "on";
		// A fix that checks for the problem itself every time keeps running when its extension updates: if the update
		// fixed the problem, the fix simply finds nothing to do.
		return !!fix.selfCheck || !pausedReason(fix.ext);
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
				patients: ["AFC", "FCM"],
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
				id: "fetch-request",
				selfCheck: true,
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
				// It only steps in when the server actually sends a partial craft back, so a BCX update cannot make it wrong.
				selfCheck: true,
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
				id: "baseline-options",
				selfCheck: true,
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
				id: "saved-settings",
				selfCheck: true,
				ext: "Echo",
				title: "Add-on item settings were lost when an outfit was saved or loaded",
				why: "R134 checks a loaded item's settings against the game's own list and drops every one it does not know (the code says 'ignore', but skipping means deleting). An add-on's own settings (e.g. AEE's Free Draw drawings, and the position, size and rotation of Echo's 渐变叠加 hair gradient) are never on that list, so they came back as the defaults after every relog and for everyone else in the room.",
				patients: ["AEE", "Echo", "any add-on item that stores its own settings"],
			},
			() => {
				if (release() < 134 || typeof w.ItemPropertiesValidate !== "function") return false;
				const known = (/** @type {string} */ key) => !!game(() => PropertyData?.[key]);
				// No probe: this runs before the game has loaded its items. It needs none either: it only puts back
				// what the game left out of its answer, so once the game keeps these itself it changes nothing.
				hook("ItemPropertiesValidate", 1000, (args, next) => {
					const res = next(args);
					const [properties, , options] = args;
					if (!res || !res.value || !properties || typeof properties !== "object" || Array.isArray(properties)) return res;
					const omit = new Set((options && options.omit) || []);
					for (const [key, value] of Object.entries(properties)) {
						// Only what the game has no rules for; everything it knows stays its decision.
						if (value === undefined || known(key) || omit.has(key) || key in res.value) continue;
						res.value[key] = value;
					}
					return res;
				});
				// The other direction: saving. R134 only bundles names on an "allowed" list (the game's own, plus what the
				// item's options and defaults name), so most add-on settings never even left the player: Echo's 身体论文
				// kept Text1 but lost Text2/Text3, AEE's Free Draw lost its drawing.
				if (typeof w.ItemPropertiesCompress === "function") {
					/** Items the game itself defines (Female3DCG's static list); everything else came from an add-on. */
					const vanilla = (/** @type {any} */ asset) => {
						const groups = game(() => AssetFemale3DCG);
						const g = Array.isArray(groups) ? groups.find((x) => x && x.Group === asset.Group.Name) : null;
						return !!g && (g.Asset || []).some((/** @type {any} */ x) => (typeof x === "string" ? x : x && x.Name) === asset.Name);
					};
					const NEVER = new Set([...(game(() => ValidationModifiableProperties) || []), "LockedBy", "LockMemberNumber", "LockMemberName"]);
					hook("ItemPropertiesCompress", 1000, (args, next) => {
						let out = next(args);
						const [item, options] = args;
						if (!item || !item.Property || typeof item.Property !== "object" || !item.Asset) return out;
						const omit = new Set((options && options.omit) || []);
						/** @type {boolean | undefined} */
						let isVanilla;
						for (const [key, value] of Object.entries(item.Property)) {
							if (value === undefined || omit.has(key) || NEVER.has(key)) continue;
							if (out && Object.prototype.hasOwnProperty.call(out, key)) continue;
							// Never anything big: an add-on that keeps a large value (AEE's drawing as picture data) out of
							// the appearance on purpose must not have it sent with every update.
							const size = JSON.stringify(value)?.length ?? 0;
							if (size > 1000 || (typeof value === "string" && value.startsWith("data:"))) continue;
							if (known(key)) {
								// The game's own names stay the game's decision on the game's own items.
								if ((isVanilla ??= vanilla(item.Asset))) continue;
								// On an add-on item, only plain values (Echo's text lines), never the game's structured ones.
								if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
							}
							out ??= {};
							out[key] = JSON.parse(JSON.stringify(value));
						}
						return out;
					});
				}
				return "add-on settings are saved and loaded, like R133";
			},
		);

		treat(
			{
				id: "stacking-init",
				selfCheck: true,
				ext: "game",
				title: "Item difficulty and height grew every time an item was loaded",
				why: "R134 adds Difficulty and HeightModifier together when it merges properties, and re-initialising an item merges its option's value into the value already there: a rope went 1, 2, 3... and Futuristic Heels lifted the character 6, 12, 18, 24 with every reload or echo. Outfits drifted out of place, restraints got harder, and BCX curses kept 'undoing changes' on the moving value. ER sets both back to what the item's chosen options give, which also repairs outfits saved with the inflated values.",
				patients: ["everyone", "BCX (curse spam)"],
			},
			() => {
				const gather = () => game(() => ExtendedItemGatherOptions);
				if (release() < 134 || typeof w.ExtendedItemInit !== "function" || typeof gather() !== "function") return false;
				const KEYS = ["Difficulty", "HeightModifier"];
				/** What the chosen options add up to, per key; a key no option or baseline sets is left out. @param {any} item */
				const expected = (item) => {
					/** @type {any[]} */
					let options = [];
					try {
						options = gather()(item) || [];
					} catch (e) {
						return null;
					}
					if (!options.length) return null;
					/** @type {Record<string, number>} */
					const sums = {};
					const baselines = new Set();
					for (const o of options) {
						for (const k of KEYS) {
							const v = o && o.Property && o.Property[k];
							if (typeof v === "number") sums[k] = (sums[k] ?? 0) + v;
						}
						const base = o && o.ParentData && o.ParentData.baselineProperty;
						if (base && !baselines.has(base)) {
							baselines.add(base);
							for (const k of KEYS) if (typeof base[k] === "number") sums[k] = (sums[k] ?? 0) + base[k];
						}
					}
					return sums;
				};
				hook("ExtendedItemInit", 1000, (args, next) => {
					const item = args[1];
					const res = next(args);
					try {
						const archetype = item && item.Asset && item.Asset.Archetype;
						if (!item || !item.Property || (archetype !== "typed" && archetype !== "modular")) return res;
						const want = expected(item);
						if (!want) return res;
						for (const k of KEYS) {
							if (typeof want[k] === "number") {
								// Exactly what the options give, 0 included: the game checks an item against its options with
								// ===, so a missing 0 would count as a change on every init and resend the outfit forever.
								if (item.Property[k] !== want[k]) item.Property[k] = want[k];
							} else if (item.Property[k] === 0) {
								// A 0 no option sets (left by an option change): saved outfits leave it out, so leave it out here.
								delete item.Property[k];
							}
						}
					} catch (e) {
						// A value we could not correct must never break the game's item setup.
					}
					return res;
				});
				// Changing an option takes the old option's value off and leaves a 0 behind; a saved outfit leaves 0 out.
				if (typeof w.ExtendedItemSetProperty === "function") {
					hook("ExtendedItemSetProperty", 999, (args, next) => {
						const res = next(args);
						const item = args[1];
						if (!item || !item.Property) return res;
						try {
							const want = expected(item) || {};
							for (const k of KEYS) if (item.Property[k] === 0 && typeof want[k] !== "number") delete item.Property[k];
						} catch (e) {
							// Leave the item as the game made it.
						}
						return res;
					});
				}
				return "an item's difficulty and height are what its options give, however often it loads";
			},
		);

		treat(
			{
				id: "minigame-return",
				selfCheck: true,
				ext: "game",
				title: "Add-on minigames crashed when they ended",
				why: "R134 calls the minigame's return as a function; before, it could be the name of one (the game looked it up). Add-ons still pass names (LSCG's sleepy drink and brainwash games pass \"LSCG_InjectEnd_Sedative\"), so the game called a string when the minigame ended and the player was stuck. ER turns a name into its function.",
				patients: ["LSCG", "any add-on with its own minigame"],
			},
			() => {
				if (release() < 134 || typeof w.MiniGameEnd !== "function") return false;
				/** A function's name (like R133 took it, "Name" or "Name()", dotted paths too) as the function, or null. */
				const resolve = (/** @type {string} */ name) => {
					const path = name.trim().replace(/\(\)$/, "").split(".");
					/** @type {any} */
					let target = w;
					for (const key of path) target = target == null ? undefined : target[key];
					return typeof target === "function" ? () => target() : null;
				};
				const fixUp = () => {
					if (typeof w.MiniGameReturnFunction === "string") w.MiniGameReturnFunction = resolve(w.MiniGameReturnFunction);
				};
				if (typeof w.MiniGameStart === "function") {
					hook("MiniGameStart", 1000, (args, next) => {
						if (typeof args[2] === "string") args[2] = resolve(args[2]);
						return next(args);
					});
				}
				hook("MiniGameEnd", 1000, (args, next) => {
					fixUp();
					return next(args);
				});
				return "a minigame's return given by name works again";
			},
		);

		treat(
			{
				id: "late-masks",
				selfCheck: true,
				ext: "Echo",
				title: "Cut-outs made by add-on masks did not show",
				why: "R134 draws an item before its mask picture has loaded and redraws the character once the picture arrives, but it finds the character from the picture's Assets/ path. Masks an add-on builds itself (Echo's 油光全身袜 detached sleeves and cut-outs) are blob: pictures with no such path, so nobody was redrawn and the cut never appeared.",
				patients: ["Echo", "any add-on that draws masks it generates itself"],
			},
			() => {
				if (release() < 134 || typeof w.GLDrawLoadTextureAlphaMask !== "function" || typeof w.DrawGetImage !== "function") return false;
				// Not by wrapping ImageCache's own method: something in the page rebuilds those methods from their
				// source, which loses a wrapper's variables and broke every picture load. Hooks on the two global
				// mask functions instead: a mask not loaded yet when it is drawn is watched, and once it arrives,
				// every character drawn with masks is asked to redraw once.
				/** @type {Set<string>} */
				const watching = new Set();
				const redraw = () => {
					for (const C of game(() => Character) || []) if (C && Array.isArray(C.AppearanceMasks) && C.AppearanceMasks.length) C.MustDraw = true;
				};
				const watch = (/** @type {unknown} */ url) => {
					if (typeof url !== "string" || watching.has(url)) return;
					const ready = () => {
						try {
							return !!w.DrawGetImage(url);
						} catch (e) {
							return false;
						}
					};
					if (ready()) return;
					watching.add(url);
					let tries = 0;
					const timer = setInterval(() => {
						// A picture still missing after a minute has failed; the game logs that itself.
						if (ready() || ++tries > 300) {
							clearInterval(timer);
							watching.delete(url);
							if (tries <= 300) redraw();
						}
					}, 200);
				};
				const watchAll = (/** @type {unknown} */ masks) => {
					if (Array.isArray(masks)) for (const m of masks) watch(m && m.Url);
				};
				// After add-ons that redirect mask pictures (Echo maps them at priority 0), so the address is the real one.
				hook("GLDrawLoadTextureAlphaMask", -1000, (args, next) => {
					const res = next(args);
					watchAll(args[5]);
					return res;
				});
				hook("DrawApplyTextureAlphaMask", -1000, (args, next) => {
					const res = next(args);
					watchAll(args[3]);
					return res;
				});
				return "characters are redrawn when a mask that was still loading arrives";
			},
		);

		treat(
			{
				id: "default-color",
				selfCheck: true,
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
				id: "wce-profile",
				ext: "WCE",
				title: "WCE's rich profiles and profile notes broke",
				why: "R134 rebuilt the profile screen as page elements. WCE's rich profile (clickable links, embedded pictures) looks for the old DescriptionInput box and never appears; its notes window draws its Save/Close buttons on the canvas under R134's own Save/Leave, so 'closing the notes' left the profile instead. ER gives WCE the box it looks for, fits WCE's views into the new screen, and puts real buttons in the menu bar for WCE's canvas ones.",
				patients: ["WCE"],
			},
			() => {
				const op = () => game(() => OnlineProfile);
				if (release() < 134 || !op()?.IDs || typeof w.OnlineProfileLoad !== "function" || typeof w.OnlineProfileClick !== "function") return false;
				const fix = currentFix;
				const wce = () => (w.bcModSdk?.getModsInfo?.() ?? []).some((/** @type {any} */ m) => m.name === "WCE");
				const ids = op().IDs;
				// WCE's canvas buttons (its own coordinates): edit toggle, refresh after a mode change, notes, note save/close.
				const AT = { toggle: [135, 105], refresh: [1665, 105], notes: [1565, 105], noteSave: [1765, 105], noteClose: [1865, 105] };
				const press = (/** @type {number[]} */ [x, y]) => {
					const ox = w.MouseX, oy = w.MouseY;
					w.MouseX = x;
					w.MouseY = y;
					try {
						w.OnlineProfileClick(new MouseEvent("click"));
					} finally {
						w.MouseX = ox;
						w.MouseY = oy;
					}
				};
				const style = document.createElement("style");
				style.id = "er-wce-profile";
				style.textContent = [
					`#${ids.screen} #bceRichOnlineProfile, #${ids.screen} #bceNoteInput { position: static !important; left: auto !important; top: auto !important; width: 100% !important; height: 100% !important; min-height: 20em; box-sizing: border-box; font-size: inherit !important; }`,
					`#${ids.screen}:has(#bceRichOnlineProfile) #${ids.description}, #${ids.screen}:has(#bceRichOnlineProfile) #${ids.ownersNotes} { display: none !important; }`,
					`#${ids.screen}.er-wce-notes #${ids.description}, #${ids.screen}.er-wce-notes #${ids.ownersNotes}, #${ids.screen}.er-wce-notes #bceRichOnlineProfile { display: none !important; }`,
					`#${ids.screen}.er-wce-notes #${ids.saveButton}, #${ids.screen}.er-wce-notes #${ids.cancelButton}, #${ids.screen}.er-wce-notes #${ids.ownersNotesButton}, #${ids.screen}.er-wce-notes #er-wce-toggle, #${ids.screen}.er-wce-notes #er-wce-notes { display: none !important; }`,
					`#${ids.screen}:not(.er-wce-notes) #er-wce-note-save, #${ids.screen}:not(.er-wce-notes) #er-wce-note-close { display: none !important; }`,
					"#DescriptionInput.er-wce-stand-in { display: none !important; }",
				].join("\n");
				(document.head || document.documentElement).append(style);
				const button = (/** @type {string} */ id, /** @type {string} */ image, /** @type {string} */ tooltip, /** @type {() => void} */ onClick) => {
					const EB = game(() => ElementButton);
					if (EB && typeof EB.Create === "function") return EB.Create(id, onClick, { image, tooltip });
					return Object.assign(document.createElement("button"), { id, title: tooltip, onclick: onClick, textContent: tooltip });
				};
				let richSeen = false;
				// Below WCE's own hook (it looks for the box right after the game's load returns).
				hook("OnlineProfileLoad", -100, (args, next) => {
					const res = next(args);
					if (!wce()) return res;
					try {
						setUp();
					} catch (e) {
						// ER's additions must never stop the profile from opening.
						console.warn("[ER] wce-profile:", e);
					}
					return res;
				});
				function setUp() {
					const screen = document.getElementById(ids.screen);
					if (!screen) return;
					richSeen = false;
					watch();
					if (!document.getElementById("DescriptionInput")) {
						const standIn = document.createElement("textarea");
						standIn.id = "DescriptionInput";
						standIn.className = "er-wce-stand-in";
						standIn.setAttribute("aria-hidden", "true");
						standIn.tabIndex = -1;
						screen.append(standIn);
					}
					const bar = document.getElementById(ids.cancelButton)?.parentElement;
					if (bar) {
						bar.append(
							Object.assign(button("er-wce-toggle", "Icons/Crafting.png", "[WCE] Formatted / plain text", () => press(AT.toggle)), { hidden: true }),
							...(document.getElementById("bceNoteInput") ? [button("er-wce-notes", "Icons/Notifications.png", "[WCE] Notes", () => press(AT.notes))] : []),
							button("er-wce-note-close", "Icons/Cancel.png", "[WCE] Close note", () => press(AT.noteClose)),
							button("er-wce-note-save", "Icons/Accept.png", "[WCE] Save note", () => press(AT.noteSave)),
						);
					}
				}
				/** Puts WCE's views inside the new screen and shows the right buttons. */
				const sync = () => {
					if (!active(fix)) return;
					const screen = document.getElementById(ids.screen);
					const area = document.getElementById(ids.description)?.parentElement;
					if (!screen || !area) return;
					const rich = document.getElementById("bceRichOnlineProfile");
					if (rich) richSeen = true;
					if (rich && rich.parentElement !== area) area.append(rich);
					const note = document.getElementById("bceNoteInput");
					const notesOpen = !!note && !note.classList.contains("bce-hidden");
					screen.classList.toggle("er-wce-notes", notesOpen);
					if (notesOpen && note.parentElement !== area) area.append(note);
					const toggle = document.getElementById("er-wce-toggle");
					if (toggle) toggle.hidden = !richSeen;
				};
				// WCE adds and shows its views on its own schedule: follow the page while the profile is open, and
				// every frame too.
				/** @type {MutationObserver | null} */
				let watcher = null;
				const watch = () => {
					watcher?.disconnect();
					watcher = new MutationObserver(() => {
						if (!document.getElementById(ids.screen)) {
							watcher?.disconnect();
							watcher = null;
							return;
						}
						try {
							sync();
						} catch (e) {
							/* never break the page */
						}
					});
					watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
				};
				hook("OnlineProfileRun", -100, (args, next) => {
					const res = next(args);
					try {
						sync();
					} catch (e) {
						/* never break the page */
					}
					return res;
				});
				// The owner's notes button switches the text: let WCE refresh its formatted copy.
				if (typeof w.OnlineProfileSetMode === "function") {
					hook("OnlineProfileSetMode", -100, (args, next) => {
						const res = next(args);
						if (wce() && document.getElementById("bceRichOnlineProfile")) press(AT.refresh);
						return res;
					});
				}
				// WCE's notes box goes back to the page body when the profile closes, where WCE keeps it.
				hook("OnlineProfileUnload", -100, (args, next) => {
					const note = document.getElementById("bceNoteInput");
					if (note && note.parentElement !== document.body) document.body.append(note);
					watcher?.disconnect();
					watcher = null;
					document.getElementById("DescriptionInput")?.classList.contains("er-wce-stand-in") && document.getElementById("DescriptionInput")?.remove();
					return next(args);
				});
				return "WCE's formatted profiles and notes work in the new profile screen";
			},
		);

		treat(
			{
				id: "view-rebuild",
				selfCheck: true,
				ext: "LSCG",
				title: "Map buttons vanished",
				why: "R134 rebuilds the open room view's buttons when you come back to the room; LSCG skips the game when the view is already open (R133 did nothing there), so the map's arrows and editor stayed gone in map rooms.",
				patients: ["LSCG"],
			},
			() => {
				if (release() < 134 || typeof w.ChatRoomActivateView !== "function" || typeof w.ChatRoomIsViewActive !== "function") return false;
				// Above LSCG's hook (priority 1): rebuild the view afterwards if nobody let the game do it.
				hook("ChatRoomActivateView", 1000, (args, next) => {
					const view = game(() => ChatRoomViews)?.[args[0]];
					if (typeof view?.Activate !== "function" || !w.ChatRoomIsViewActive(args[0])) return next(args);
					const activate = view.Activate;
					let rebuilt = false;
					view.Activate = function (/** @type {any[]} */ ...a) {
						rebuilt = true;
						return activate.apply(this, a);
					};
					let res;
					try {
						res = next(args);
					} finally {
						view.Activate = activate;
					}
					if (!rebuilt) activate.call(view);
					return res;
				});
				return "the open view rebuilds its buttons again";
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
		if (paused && c.selfCheck && f !== "on") return { state: "running", text: `checks for the problem itself each time, so it keeps running (${paused})` };
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
#er-panel .er-option { display: flex; align-items: center; gap: 6px; font-size: 14px; margin: 0 0 8px; cursor: pointer; }
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
		const updates = el("label", "er-option");
		const box = /** @type {HTMLInputElement} */ (el("input"));
		box.type = "checkbox";
		box.checked = settings.notifyUpdates;
		box.addEventListener("change", () => {
			settings.notifyUpdates = box.checked;
			saveSettings();
		});
		updates.append(box, document.createTextNode(" Tell me when a new ER is ready (reload the game to get it)"));
		body.append(updates);
		body.append(
			el(
				"p",
				"er-help",
				"Every switch starts on Auto: ER runs a fix only when the game needs it. Fixes that check for the problem themselves each time keep running when their extension updates (if the update fixed it, they find nothing to do); the others pause by themselves until ER is tested with the new version. Use On or Off to force a choice.",
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
					el("div", "er-ext-ver", v ? `installed ${v} · tested ${[info.tested].flat().join(", ")}${paused ? " · ER pauses these fixes until it is tested again" : ""}` : `not loaded · tested ${[info.tested].flat().join(", ")}`),
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

	/**
	 * Every 15 minutes, ask GitHub Pages for the newest version; when it is newer than this copy, say so once
	 * (a game toast, and a line in the chat if the player is in a room). ER always loads the newest copy on a
	 * reload, so a reload is all it takes. Switched off with the panel's first box.
	 */
	/** @type {() => Promise<void>} */
	let checkForUpdate = async () => {};
	function watchForUpdates() {
		/** @type {string | null} */
		let told = null;
		const check = async () => {
			if (!settings.notifyUpdates) return;
			try {
				const text = await (await fetch(`${NEWEST}?v=${Date.now()}`, { cache: "no-store" })).text();
				const latest = /const VERSION = "(\d+\.\d+\.\d+)"/.exec(text)?.[1];
				if (!latest || !newer(latest, VERSION) || latest === told) return;
				told = latest;
				const message = `ER ${latest} is ready (you have ${VERSION}). Reload the game to update.`;
				const toast = game(() => ToastManager);
				if (toast && typeof toast.info === "function") toast.info(message, { title: "ER update", duration: 20000 });
				if (game(() => CurrentScreen) === "ChatRoom" && typeof w.ChatRoomSendLocal === "function") w.ChatRoomSendLocal(`✚ ${message}`);
				if (!toast) console.info(`[ER] ${message}`);
			} catch {
				// Offline or GitHub down: try again next time.
			}
		};
		checkForUpdate = check;
		setInterval(check, 15 * 60 * 1000);
	}

	function start() {
		watchForUpdates();
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
		/** Looks for a newer ER now (it also does every 15 minutes) and says so if there is one. */
		checkForUpdate: () => checkForUpdate(),
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
