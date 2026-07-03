// Plan 0 — de-risking spikes for Chrome-style in-strip tab groups.
//
// Launches a real headless Obsidian ONCE (via the e2e harness) and runs every
// spike S1–S8 sequentially, printing a JSON report. This is throwaway probing
// to validate the plan's assumptions before building Plans 2–6 — not a test
// gate. Run: `npm run build && xvfb-run -a node test/e2e/spikes/spikes.mjs`.
import { fileURLToPath } from "node:url";
import { launchObsidian } from "../obsidian-harness.mjs";

const VAULT = fileURLToPath(new URL("../vault", import.meta.url));
const results = {};

const obs = await launchObsidian({ vault: VAULT });
try {
	// Setup: create a few notes and open three as tabs in the main area.
	await obs.evalInApp(`
		const app = window.app;
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['rp-a.md','rp-b.md','rp-c.md','rp-d.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		window.__sp = { leaves: { a: await open('rp-a.md'), b: await open('rp-b.md'), c: await open('rp-c.md') } };
		await new Promise(r => setTimeout(r, 300));
		return true;
	`);

	// S1 — do data-* attributes on tabHeaderEl survive re-renders?
	results.S1_attrPersistence = await obs.evalInApp(`
		const app = window.app; const L = window.__sp.leaves;
		const h = L.a.tabHeaderEl; const out = {};
		out.headerFound = !!h;
		h.dataset.rpTest = 'x'; out.afterSet = h.dataset.rpTest === 'x';
		const nl = app.workspace.getLeaf('tab'); await nl.openFile(app.vault.getAbstractFileByPath('rp-d.md'));
		await new Promise(r=>setTimeout(r,150));
		out.afterOpen = L.a.tabHeaderEl.dataset.rpTest === 'x';
		app.workspace.setActiveLeaf(L.a, { focus: true }); await new Promise(r=>setTimeout(r,100));
		out.afterActivate = L.a.tabHeaderEl.dataset.rpTest === 'x';
		nl.detach(); await new Promise(r=>setTimeout(r,150));
		out.afterClose = L.a.tabHeaderEl.dataset.rpTest === 'x';
		out.headerIdentityStable = L.a.tabHeaderEl === h;
		delete L.a.tabHeaderEl.dataset.rpTest;
		return out;
	`);

	// S2 — is a custom element in the header container wiped, and is idempotent re-insert safe?
	results.S2_chipSurvival = await obs.evalInApp(`
		const app = window.app; const L = window.__sp.leaves;
		const cont = L.a.tabHeaderEl.closest('.workspace-tab-header-container');
		const out = { containerFound: !!cont };
		if (cont) {
			const mk = () => { let c = cont.querySelector('.rp-spike-chip'); if (!c) { c = document.createElement('div'); c.className = 'rp-spike-chip'; cont.insertBefore(c, cont.firstChild); } return c; };
			mk(); out.afterInsert = !!cont.querySelector('.rp-spike-chip');
			const nl = app.workspace.getLeaf('tab'); await nl.openFile(app.vault.getAbstractFileByPath('rp-d.md'));
			await new Promise(r=>setTimeout(r,150));
			out.survivedOpen = !!cont.querySelector('.rp-spike-chip');
			nl.detach(); await new Promise(r=>setTimeout(r,150));
			out.survivedClose = !!cont.querySelector('.rp-spike-chip');
			mk(); mk(); out.countAfterDoubleMk = cont.querySelectorAll('.rp-spike-chip').length;
			cont.querySelectorAll('.rp-spike-chip').forEach(e=>e.remove());
		}
		return out;
	`);

	// S3 — leaf identity + DOM-order enumeration within a container.
	results.S3_leafIdentity = await obs.evalInApp(`
		const app = window.app; const L = window.__sp.leaves;
		const out = {};
		out.ids = { a: L.a.id, b: L.b.id, c: L.c.id };
		out.idsAreStrings = [L.a.id, L.b.id, L.c.id].every(x => typeof x === 'string' && x.length > 0);
		const flat = JSON.stringify(app.workspace.getLayout());
		out.idsInLayout = [L.a.id, L.b.id, L.c.id].map(id => flat.includes('"' + id + '"'));
		const cont = L.a.tabHeaderEl.closest('.workspace-tab-header-container');
		out.containerFound = !!cont;
		const headers = cont ? [...cont.querySelectorAll('.workspace-tab-header')] : [];
		const order = [];
		app.workspace.iterateAllLeaves(l => { const i = headers.indexOf(l.tabHeaderEl); if (i >= 0) order[i] = l.id; });
		out.domOrderResolves = order.length === headers.length && order.every(Boolean);
		out.headerCount = headers.length;
		return out;
	`);

	// S4 — does layout-change / active-leaf-change fire on open/close?
	results.S4_reconcileTrigger = await obs.evalInApp(`
		const app = window.app; const out = {};
		window.__cnt = { layout: 0, active: 0 };
		const r1 = app.workspace.on('layout-change', () => window.__cnt.layout++);
		const r2 = app.workspace.on('active-leaf-change', () => window.__cnt.active++);
		try {
			const before = { ...window.__cnt };
			const nl = app.workspace.getLeaf('tab'); await nl.openFile(app.vault.getAbstractFileByPath('rp-d.md'));
			await new Promise(r=>setTimeout(r,200));
			const afterOpen = { ...window.__cnt };
			nl.detach(); await new Promise(r=>setTimeout(r,200));
			const afterClose = { ...window.__cnt };
			out.layoutFiredOnOpen = afterOpen.layout > before.layout;
			out.layoutFiredOnClose = afterClose.layout > afterOpen.layout;
			out.activeFiredOnOpen = afterOpen.active > before.active;
			out.counts = { before, afterOpen, afterClose };
		} finally { app.workspace.offref(r1); app.workspace.offref(r2); }
		return out;
	`);

	// S5 — does file-menu fire with source 'tab-header' on a tab right-click?
	results.S5_tabMenuHook = await obs.evalInApp(`
		const app = window.app; const L = window.__sp.leaves;
		const sources = [];
		const ref = app.workspace.on('file-menu', (menu, file, source) => sources.push(source));
		try {
			const h = L.a.tabHeaderEl;
			h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: h.ownerDocument.defaultView }));
			await new Promise(r=>setTimeout(r,150));
			// close any menu that opened
			document.querySelectorAll('.menu').forEach(m => m.remove());
		} finally { app.workspace.offref(ref); }
		return { sources, fired: sources.length > 0, sawTabHeader: sources.includes('tab-header') };
	`);

	// S6 — getViewState/setViewState round-trip, missing file, deferred.
	results.S6_saveReopen = await obs.evalInApp(`
		const app = window.app; const L = window.__sp.leaves;
		const out = {};
		const vs = L.b.getViewState();
		out.capturedType = vs.type; out.capturedFile = vs.state && vs.state.file;
		const nl = app.workspace.getLeaf('tab'); await nl.setViewState(vs); await new Promise(r=>setTimeout(r,100));
		const rvs = nl.getViewState();
		out.roundTripType = rvs.type; out.roundTripFile = rvs.state && rvs.state.file;
		out.roundTripOk = rvs.type === vs.type && (rvs.state && rvs.state.file) === (vs.state && vs.state.file);
		nl.detach();
		let threw = false;
		try { const bl = app.workspace.getLeaf('tab'); await bl.setViewState({ type:'markdown', state:{ file:'no-such-file-xyz.md' } }); await new Promise(r=>setTimeout(r,80)); out.bogusType = bl.getViewState().type; bl.detach(); } catch (e) { threw = true; out.bogusErr = String(e); }
		out.bogusThrew = threw;
		out.hasIsDeferred = typeof L.b.isDeferred === 'function';
		out.bIsDeferred = typeof L.b.isDeferred === 'function' ? L.b.isDeferred() : 'n/a';
		return out;
	`);

	// S7 — can an existing tab be moved to an index? Probe APIs.
	results.S7_reorderMove = await obs.evalInApp(`
		const app = window.app; const L = window.__sp.leaves;
		const out = {};
		const parent = L.a.parent;
		out.parentCtor = parent && parent.constructor && parent.constructor.name;
		out.parentHasContainerEl = !!(parent && parent.containerEl);
		let created = null;
		try { created = app.workspace.createLeafInParent(parent, 0); out.createLeafInParent = !!created; }
		catch (e) { out.createLeafInParentErr = String(e); }
		if (created) {
			try {
				await created.setViewState({ type:'markdown', state:{ file:'rp-d.md' } }); await new Promise(r=>setTimeout(r,100));
				const cont = L.a.tabHeaderEl.closest('.workspace-tab-header-container');
				const headers = cont ? [...cont.querySelectorAll('.workspace-tab-header')] : [];
				out.createdAtIndex = headers.indexOf(created.tabHeaderEl);
			} catch (e) { out.createErr = String(e); }
			created.detach();
		}
		const proto = parent && Object.getPrototypeOf(parent);
		out.parentMoveMethods = proto ? Object.getOwnPropertyNames(proto).filter(n => /child|insert|move|reorder|tab/i.test(n)) : [];
		return out;
	`);

	// S8 — popout: reachable via iterateAllLeaves, taggable, container reachable.
	results.S8_multiWindow = await obs.evalInApp(`
		const app = window.app; const out = {};
		try {
			const nl = app.workspace.getLeaf('tab'); await nl.openFile(app.vault.getAbstractFileByPath('rp-d.md'));
			const win = app.workspace.moveLeafToPopout(nl);
			await new Promise(r=>setTimeout(r,700));
			let countWithHeader = 0; app.workspace.iterateAllLeaves(l => { if (l.tabHeaderEl) countWithHeader++; });
			out.countWithHeader = countWithHeader;
			const doc = nl.view && nl.view.containerEl && nl.view.containerEl.ownerDocument;
			out.popoutDocDiffers = !!doc && doc !== window.document;
			const cont = doc && doc.querySelector('.workspace-tab-header-container');
			out.reachedPopoutContainer = !!cont;
			if (nl.tabHeaderEl) { nl.tabHeaderEl.dataset.rpPop = '1'; out.attrSetInPopout = nl.tabHeaderEl.dataset.rpPop === '1'; }
			if (win && typeof win.close === 'function') win.close(); else nl.detach();
		} catch (e) { out.err = String(e); }
		return out;
	`);
} finally {
	await obs.close();
}

console.log("RP_SPIKE_RESULTS " + JSON.stringify(results, null, 2));
