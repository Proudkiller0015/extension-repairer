// ==UserScript==
// @name         ER - Extension Repairer
// @namespace    https://github.com/Proudkiller0015/extension-repairer
// @version      1.0.0
// @description  An emergency room for Bondage Club add-ons: keeps add-ons working when a game update breaks them. Always runs the newest fixes.
// @homepageURL  https://github.com/Proudkiller0015/extension-repairer
// @downloadURL  https://raw.githubusercontent.com/Proudkiller0015/extension-repairer/main/er.user.js
// @updateURL    https://raw.githubusercontent.com/Proudkiller0015/extension-repairer/main/er.user.js
// @match        https://www.bondageprojects.elementfx.com/*
// @match        https://bondageprojects.elementfx.com/*
// @match        https://bondageprojects.com/*
// @match        https://www.bondageprojects.com/*
// @match        https://www.bondage-europe.com/*
// @match        https://bondage-europe.com/*
// @match        https://www.bondageeurope.com/*
// @match        https://bondageeurope.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * The ER loader. It never needs updating: on every game load it adds the newest ER from GitHub Pages,
 * so new fixes reach everybody the next time they reload. It runs at document-start so ER is in place
 * before other add-ons load.
 */
(function () {
	"use strict";
	const script = document.createElement("script");
	script.src = `https://proudkiller0015.github.io/extension-repairer/er.js?v=${Math.floor(Date.now() / 60000)}`;
	script.crossOrigin = "anonymous";
	(document.head || document.documentElement).appendChild(script);
})();
