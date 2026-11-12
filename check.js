// ER check-up: shows why ER or another add-on is not loading, in a box on the BC screen. Reads only; changes nothing.
// Run it from the browser console:
// document.head.append(Object.assign(document.createElement("script"),{src:"https://proudkiller0015.github.io/extension-repairer/check.js"}))
(async () => {
	const r = {};
	try {
		r.page = location.href.split("?")[0];
		r.game = typeof GameVersion !== "undefined" ? GameVersion : "?";
		r.server = typeof ServerIsConnected !== "undefined" ? ServerIsConnected : "?";
		r.loggedIn = typeof Player !== "undefined" && !!Player?.MemberNumber;
		r.ER = window.ER?.version ?? "not loaded";
		r.mods = window.bcModSdk ? bcModSdk.getModsInfo().map((m) => `${m.name} ${m.version}`).join(", ") || "none" : "no ModSDK";
		r.FUSAM = window.FUSAM ? "loaded" : "not loaded";
		for (const [k, u] of [
			["pages", "https://proudkiller0015.github.io/extension-repairer/er.js"],
			["jsdelivr", "https://cdn.jsdelivr.net/gh/Proudkiller0015/extension-repairer@main/er.js"],
			["fusamSite", "https://sidiousious.gitlab.io/bc-addon-loader/fusam.js"],
		]) {
			try {
				const res = await fetch(`${u}?v=${Date.now()}`, { cache: "no-store" });
				const t = await res.text();
				r[k] = res.ok ? (t.match(/VERSION = "([^"]+)"/) || [])[1] || "reachable" : `HTTP ${res.status}`;
			} catch (e) {
				r[k] = `blocked: ${e.message}`;
			}
		}
		let size = 0;
		const big = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			const n = (localStorage.getItem(k) || "").length;
			size += n;
			big.push([k, n]);
		}
		r.storageKB = Math.round(size / 1024);
		r.biggest = big
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([k, n]) => `${k} ${Math.round(n / 1024)}KB`)
			.join(", ");
		r.browser = navigator.userAgent;
	} catch (e) {
		r.error = String(e);
	}
	const box = document.createElement("textarea");
	box.value = "```\n" + JSON.stringify(r, null, 1) + "\n```";
	box.title = "ER check-up: copy this and send it. Reload to remove it.";
	box.style.cssText = "position:fixed;top:10px;left:10px;width:min(640px,95vw);height:340px;z-index:999999;font:13px monospace;background:#fff;color:#000;border:3px solid #d81e1e";
	document.body.append(box);
	box.select();
})();
