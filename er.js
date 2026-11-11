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
	const VERSION = "1.0.0";
	/** Where the source lives. */
	const REPO = "https://github.com/Proudkiller0015/extension-repairer";

	const w = /** @type {any} */ (window);
	if (w.ER && w.ER.version) return;

	/**
	 * One line on the chart per fix.
	 * @typedef {{ id: string, title: string, why: string, patients: string[], status: "treated" | "healthy" | "failed", detail?: string }} ChartEntry
	 */

	/** @type {ChartEntry[]} */
	const chart = [];

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
		try {
			const res = treat();
			if (res === false) note(fix, "healthy");
			else note(fix, "treated", typeof res === "string" ? res : undefined);
		} catch (e) {
			note(fix, "failed", String((e && e.message) || e));
			console.warn(`[ER] ${fix.id} failed:`, e);
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
		sdk.hookFunction(name, priority, hook);
		return true;
	}

	// ---- Fixes that only need the game's scripts (run as early as possible, before other add-ons) ----

	/** The fixes that put removed globals back. */
	function standInFixes() {
		treat(
			{
				id: "room-space",
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
				id: "infiltration",
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
				id: "arousal-active",
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

	// ---- The chart: /er in a chat room ----

	/** @param {string} s */
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

	function chartHtml() {
		const treated = chart.filter((c) => c.status === "treated");
		const failed = chart.filter((c) => c.status === "failed");
		const rows = (/** @type {ChartEntry[]} */ list, /** @type {string} */ mark) =>
			list.map((c) => `<div style="margin:2px 0"><b>${mark} ${esc(c.title)}</b>${c.detail ? ` <i>(${esc(c.detail)})</i>` : ""}<br><span style="opacity:.8">${esc(c.why)}</span><br><span style="opacity:.7">Patients: ${esc(c.patients.join(", "))}</span></div>`).join("");
		return (
			`<div style="border-left:4px solid #e02424;padding:4px 8px;background:rgba(224,36,36,.08)">` +
			`<b style="color:#e02424">✚ ER - Extension Repairer ${VERSION}</b> <span style="opacity:.7">on ${esc(game(() => GameVersion) ?? "?")}</span><br>` +
			(treated.length ? `${treated.length} treatment(s) running:` + rows(treated, "🩹") : "No treatment needed: the game has everything your add-ons use.") +
			(failed.length ? `<br>${failed.length} could not be applied:` + rows(failed, "⚠") : "") +
			`<br><span style="opacity:.7">${chart.filter((c) => c.status === "healthy").length} check(s) healthy. Source: <a href="${REPO}" target="_blank" rel="noopener">${REPO.replace("https://", "")}</a></span></div>`
		);
	}

	function registerCommand() {
		if (typeof w.CommandCombine !== "function" || !Array.isArray(w.Commands) || w.Commands.some((/** @type {any} */ c) => c.Tag === "er")) return;
		w.CommandCombine([
			{
				Tag: "er",
				Description: ": ER - Extension Repairer: show which add-on fixes are running",
				Action: () => {
					if (typeof w.ChatRoomSendLocal === "function") {
						const div = document.createElement("div");
						div.innerHTML = chartHtml();
						w.ChatRoomSendLocal(div);
					}
				},
			},
		]);
	}

	// ---- Start ----

	const ready = () => typeof w.GameVersion === "string" && w.GameVersion !== "R0" && typeof w.CommonSetScreen === "function";

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
		if (!sdkReady()) {
			const t = setInterval(() => sdkReady() && clearInterval(t), 100);
		}
		const treated = () => chart.filter((c) => c.status === "treated").map((c) => c.id);
		console.info(`%c✚ ER ${VERSION}%c treating: ${treated().join(", ") || "nothing"} (type /er in a chat room)`, "color:#e02424;font-weight:bold", "");
	}

	w.ER = {
		version: VERSION,
		repository: REPO,
		/** The chart: what each fix found. */
		chart: () => chart.map((c) => ({ ...c })),
		/** Names ER put back on window. */
		standIns: () => [...standIns],
	};

	if (ready()) start();
	else {
		const t = setInterval(() => {
			if (ready()) {
				clearInterval(t);
				start();
			}
		}, 50);
	}
})();
