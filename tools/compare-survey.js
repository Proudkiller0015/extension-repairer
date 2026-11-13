// Compares two survey folders: for each add-on, the log lines only one side has.
// usage: node tools/compare-survey.js <before dir> <after dir>
const fs = require('fs');
const path = require('path');

const [a, b] = process.argv.slice(2);
// Server noise from several survey pages at once.
const NOISE = /ErrorRateLimited/;
const read = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
	const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
	return [`${r.id}:${r.dist}`, r];
}));
const before = read(a);
const after = read(b);
for (const [id, r] of Object.entries(after)) {
	const old = before[id];
	const logs = r.logs.filter((l) => !NOISE.test(l));
	const oldLogs = old ? old.logs.filter((l) => !NOISE.test(l)) : [];
	const added = logs.filter((l) => !oldLogs.includes(l));
	const gone = oldLogs.filter((l) => !logs.includes(l));
	const mods = (r.mods || []).filter((m) => !m.startsWith('ER@'));
	const oldMods = old ? (old.mods || []).filter((m) => !m.startsWith('ER@')) : [];
	const modNote = mods.join(',') === oldMods.join(',') ? '' : ` mods ${oldMods.join(',') || '-'} -> ${mods.join(',') || '-'}`;
	if (!added.length && !gone.length && !modNote) continue;
	console.log(`== ${id}${modNote}`);
	for (const l of added) console.log(`  + ${l.slice(0, 300)}`);
	for (const l of gone) console.log(`  - ${l.slice(0, 300)}`);
}
