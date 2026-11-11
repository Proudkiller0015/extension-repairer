// Loads one Echo picture through the beta's image cache and reports what happened.
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BUILDS = { live: 'https://www.bondageprojects.elementfx.com/R133/BondageClub/', beta: 'https://www.bondageprojects.elementfx.com/R133/1970510968540/' };
const URL_ = 'https://cdn.jsdelivr.net/gh/SugarChain-Studio/echo-clothing-ext@091d2f4e1dfc8df571a396a6304746dfafa68dbf/resources/Assets/Female3DCG/新后发_Luzi/单马尾1b_左侧.png';
(async () => {
	const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
	for (const b of ['live', 'beta']) {
		const page = await browser.newPage();
		const net = [];
		page.on('request', (r) => { if (r.url().includes('jsdelivr')) net.push('REQ ' + r.method() + ' ' + JSON.stringify(r.headers()).slice(0, 200)); });
		page.on('requestfailed', (r) => { if (r.url().includes('jsdelivr')) net.push('FAILED ' + r.failure()?.errorText); });
		page.on('response', (r) => { if (r.url().includes('jsdelivr')) net.push('RESP ' + r.status() + ' acao=' + r.headers()['access-control-allow-origin']); });
		await page.goto(BUILDS[b], { waitUntil: 'load', timeout: 120000 });
		await page.waitForFunction(() => typeof GLDrawImageCache !== 'undefined' && GLDrawImageCache, { timeout: 120000 });
		const r = await page.evaluate(async (u) => {
			const errs = [];
			const orig = console.error;
			console.error = (...a) => { errs.push(a.map((x) => (x && x.err ? 'err=' + x.err.message + ' cause=' + x.err.cause?.message : String(x))).join(' ')); orig(...a); };
			const img = GLDrawImageCache.get(u);
			for (let i = 0; i < 40 && img.state !== undefined && !img.isLoaded?.() && String(img.state) !== 'failed' && img.state !== 3; i++) await new Promise((r) => setTimeout(r, 250));
			let direct;
			try { const res = await fetch(u); direct = res.status + ' ' + res.headers.get('content-type'); } catch (e) { direct = 'fetch error ' + e.message; }
			let common;
			try { const res = await CommonFetch(u, { headers: [['accept', 'image/*']] }); common = res.status + ' ' + res.headers.get('content-type'); } catch (e) { common = 'CommonFetch error ' + e.message; }
			return { state: img.state, loaded: img.isLoaded?.(), errs, direct, common, commonFetchSrc: String(CommonFetch).slice(0, 600) };
		}, URL_);
		console.log('=====', b, JSON.stringify(r, null, 1));
		console.log(net.slice(0, 6).join('\n'));
		await page.close();
	}
	await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
