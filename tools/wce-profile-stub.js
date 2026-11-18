// WCE 6.3.20's rich profile and profile notes, copied from its source (wce.js, functions Zt and the notes block),
// for testing ER's wce-profile fix without WCE's full start-up (which needs a real account). The only change:
// WCE's link renderer K() is replaced by a simple one that also makes <a> and <img>, since K needs WCE's trust store.
// Loaded into the page with addScriptTag after bcModSdk; registers as "WCE" 6.3.20 like the real one.
(function () {
	const V = bcModSdk.registerMod({ name: 'WCE', fullName: 'WCE stub (test)', version: '6.3.20' });
	const B = { Top: 11, OverrideBehaviour: 10, ModifyBehaviourHigh: 6, ModifyBehaviourMedium: 5, ModifyBehaviourLow: 4, AddBehaviour: 3, Observe: 0 };
	const Z = { richOnlineProfile: true };
	const W = (s) => s;
	function K(el) {
		const text = el.textContent;
		el.textContent = '';
		for (const part of text.split(/(\s+)/)) {
			if (/^https?:\/\//.test(part)) {
				const a = document.createElement('a');
				a.href = part;
				if (/\.(png|jpe?g|gif|webp)$/i.test(part)) { const img = document.createElement('img'); img.src = part; img.className = 'bce-img'; a.append(img); } else a.textContent = part;
				el.append(a);
			} else el.append(document.createTextNode(part));
		}
	}
	// ---- rich profile (Zt) ----
	(function Zt() {
		let e = 'DescriptionInput', t = 'bceRichOnlineProfile', n = !0;
		function r() { let t = document.getElementById(e); t && (n = !1, t.style.display = 'none'); }
		function i() { let t = document.getElementById(e); t && (n = !0, t.style.display = ''); }
		function a() { ElementPositionFix(t, 36, 100, 160, 1790, 750); }
		function o() { r(); let e = document.createElement('div'); e.id = t; e.style.overflowY = 'scroll'; e.style.whiteSpace = 'pre-wrap'; e.style.background = 'rgb(244, 236, 216)'; e.style.border = '2px solid black'; e.classList.add('bce-rich-textarea'); e.textContent = OnlineProfileMode === 'Description' ? OnlineProfileTextDesc : OnlineProfileTextOwnersNotes; K(e, () => !1); document.body.append(e); a(); }
		function s() { let e = document.getElementById(t); e && (e.textContent = OnlineProfileMode === 'Description' ? OnlineProfileTextDesc : OnlineProfileTextOwnersNotes, K(e, () => !1)); }
		function c() { let e = document.getElementById(t); e && e.remove(); i(); }
		V.hookFunction('OnlineProfileLoad', B.ModifyBehaviourMedium, (t, r) => { n = !0; let i = r(t), a = document.getElementById(e); return !Z.richOnlineProfile || !a || o(), i; });
		V.hookFunction('ChatRoomHideElements', B.ModifyBehaviourMedium, (e, t) => (c(), t(e)));
		let l = [90, 60, 90, 90];
		V.hookFunction('OnlineProfileRun', B.ModifyBehaviourMedium, (e, t) => { if (!Z.richOnlineProfile) return t(e); DrawButton(...l, '', 'White', 'Icons/Crafting.png', W('Toggle Editing Mode')); let i = t(e); return n || (r(), a()), i; });
		V.hookFunction('OnlineProfileClick', B.ModifyBehaviourMedium, (e, t) => { if (!Z.richOnlineProfile) return t(e); if (MouseIn(...l)) return n ? o() : c(), !0; let r = t(e); return MouseIn(1620, 60, 90, 90) && s(), r; });
		V.hookFunction('OnlineProfileUnload', B.ModifyBehaviourMedium, (e, t) => (n || c(), t(e)));
	})();
	// ---- profile notes ----
	(function notes() {
		const t = document.createElement('textarea');
		t.id = 'bceNoteInput';
		t.classList.add('bce-hidden');
		document.body.append(t);
		window.__wceNoteSaved = null;
		let p = !1;
		function g() { p = !0; t.classList.remove('bce-hidden'); t.value = 'my note'; }
		function v() { t.classList.add('bce-hidden'); p = !1; }
		V.hookFunction('OnlineProfileRun', B.OverrideBehaviour, (e, n) => p ? (DrawText(W('Personal notes (only you can read these):'), 910, 105, 'Black', 'Gray'), ElementPositionFix('bceNoteInput', 36, 100, 160, 1790, 750), DrawButton(1720, 60, 90, 90, '', 'White', 'Icons/Accept.png', TextGet('LeaveSave')), DrawButton(1820, 60, 90, 90, '', 'White', 'Icons/Cancel.png', TextGet('LeaveNoSave')), null) : (DrawButton(1520, 60, 90, 90, '', 'White', 'Icons/Notifications.png', W('[WCE] Notes')), n(e)));
		V.hookFunction('OnlineProfileClick', B.OverrideBehaviour, (n, r) => p ? (MouseIn(1720, 60, 90, 90) ? (window.__wceNoteSaved = t.value, v()) : MouseIn(1820, 60, 90, 90) && v(), null) : (!p && MouseIn(1520, 60, 90, 90) && g(), r(n)));
	})();
})();
