// End-to-end test of the core feature — confirm before closing a pinned tab —
// against a real, headless Obsidian. This is the one behavior the unit gate
// can't reach: it lives entirely in the `workspace:close` command patch
// (src/main.ts) and depends on real Obsidian workspace state.
//
// The regression it guards (reported bug): `workspace:close` closes the active
// tab group's current tab, but the patch used to inspect the *focused* view's
// leaf. Those diverge whenever focus isn't in the current tab — with the file
// explorer (or any sidebar leaf) focused, or with nothing focused after the sole
// unpinned tab is closed. There the patch saw an unpinned sidebar leaf, or null,
// judged "no pinned tab here", and let Cmd+W close the still-visible pinned tab
// with NO confirmation modal. The fix resolves the target with
// `getMostRecentLeaf()` — the main-area tab `close` actually acts on — so the
// pinned tab is guarded no matter where focus is.
//
// Run with `npm run test:e2e` (needs a display — CI wraps it in `xvfb-run`).
// `npm run build` must have run first so the plugin's main.js exists.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { launchObsidian } from "./obsidian-harness.mjs";

const VAULT = fileURLToPath(new URL("./vault", import.meta.url));

let obs;

before(async () => {
	obs = await launchObsidian({ vault: VAULT });

	// Three fixture notes to open as tabs, and helpers stashed on a page global.
	await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['cp-1.md','cp-2.md','cp-3.md']) await ensure(p);

		window.__cp = {
			rp,
			open: async (p, pin) => {
				const leaf = app.workspace.getLeaf('tab');
				await leaf.openFile(app.vault.getAbstractFileByPath(p));
				if (pin) leaf.setPinned(true);
				return leaf;
			},
			// A modal that belongs to our confirm dialog (matched by its title, so
			// an unrelated modal can't be mistaken for it).
			confirmModal: () => [...activeDocument.querySelectorAll('.modal-container')]
				.find((m) => m.textContent.includes('Close pinned tab?')) || null,
			dismissModal: () => {
				const m = [...activeDocument.querySelectorAll('.modal-container')]
					.find((el) => el.textContent.includes('Close pinned tab?'));
				if (!m) return;
				// Cancel is the first button; click it so the promise settles false.
				const cancel = [...m.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
				if (cancel) cancel.click();
			},
			// Count pinned tabs from the DOM — the pin element Obsidian renders in
			// each pinned header — rather than iterateAllLeaves (an unreliable
			// enumerator per CLAUDE.md), so the before/after counts are exact.
			pinnedCount: () => activeDocument.querySelectorAll('.workspace-tab-header-status-icon.mod-pinned').length,
			close: () => app.commands.executeCommandById('workspace:close'),
		};
		return true;
	`);
});

after(async () => {
	await obs?.close();
});

// Each test arranges its own tabs and tears them down, so ordering is irrelevant.
const reset = () => obs.evalInApp(`
	const app = window.app;
	const cp = window.__cp;
	cp.dismissModal();
	// Unpin then detach every main-area leaf so we start from a clean strip.
	const leaves = [];
	app.workspace.iterateAllLeaves((l) => { const r = l.getRoot(); if (r !== app.workspace.leftSplit && r !== app.workspace.rightSplit) leaves.push(l); });
	for (const l of leaves) { try { l.setPinned(false); } catch {} }
	for (const l of leaves) { try { l.detach(); } catch {} }
	await new Promise((r) => setTimeout(r, 150));
	window.__cp.rp.settings.confirmBeforeClose = true;
	return true;
`);

test("closing an unpinned tab goes through without a modal", async () => {
	await reset();
	const r = await obs.evalInApp(`
		const cp = window.__cp;
		await cp.open('cp-1.md', true);          // pinned
		const u = await cp.open('cp-2.md', false); // unpinned, active
		await new Promise((r) => setTimeout(r, 150));
		const before = cp.pinnedCount();
		cp.close();                               // Cmd+W on the unpinned tab
		await new Promise((r) => setTimeout(r, 250));
		return { before, after: cp.pinnedCount(), modal: !!cp.confirmModal(), unpinnedGone: !u.view || u.parent == null };
	`);
	assert.equal(r.modal, false, "closing an unpinned tab shows no confirmation modal");
	assert.equal(r.after, r.before, "the pinned tab is untouched");
});

test("Cmd+W on a focused pinned tab asks for confirmation (and closes nothing until confirmed)", async () => {
	await reset();
	const r = await obs.evalInApp(`
		const app = window.app;
		const cp = window.__cp;
		const p = await cp.open('cp-1.md', true); // pinned, active/focused
		await new Promise((r) => setTimeout(r, 150));
		const before = cp.pinnedCount();
		cp.close();
		await new Promise((r) => setTimeout(r, 250));
		const modal = !!cp.confirmModal();
		const after = cp.pinnedCount();
		cp.dismissModal();
		return { before, after, modal };
	`);
	assert.equal(r.modal, true, "a focused pinned tab prompts before closing");
	assert.equal(r.after, r.before, "nothing closes while the prompt is open");
});

test("REGRESSION (file explorer focus): Cmd+W with focus in the file explorer still prompts for the pinned tab", async () => {
	// The reported repro: a pinned tab is the current main-area tab, but focus is
	// in the file explorer (left pane). Cmd+W closes the current main tab, not the
	// focused sidebar leaf — so the pre-fix guard, which read the focused leaf,
	// saw an unpinned file-explorer leaf and let the pinned tab close unprompted.
	await reset();
	const r = await obs.evalInApp(`
		const app = window.app;
		const cp = window.__cp;
		await cp.open('cp-1.md', true); // pinned main tab, current + active
		await new Promise((r) => setTimeout(r, 150));

		// Move focus to the file explorer, exactly like the report.
		const fe = app.workspace.getLeavesOfType('file-explorer')[0];
		if (fe) app.workspace.setActiveLeaf(fe, { focus: true });
		await new Promise((r) => setTimeout(r, 150));

		const focusedExplorer = !!fe;
		const pinnedBefore = cp.pinnedCount();
		cp.close();                     // Cmd+W while the file explorer is focused
		await new Promise((r) => setTimeout(r, 250));
		const modal = !!cp.confirmModal();
		const pinnedAfter = cp.pinnedCount();
		cp.dismissModal();
		return { focusedExplorer, pinnedBefore, pinnedAfter, modal };
	`);
	assert.equal(r.focusedExplorer, true, "precondition: the file explorer leaf was focused");
	assert.equal(r.modal, true, "Cmd+W with sidebar focus still prompts for the pinned main tab");
	assert.equal(r.pinnedAfter, r.pinnedBefore, "no pinned tab is closed without confirmation");
});

test("REGRESSION (natural flow): closing the sole unpinned tab then Cmd+W never loses a pinned tab without a prompt", async () => {
	// The reported flow, unforced: N pinned tabs + one unpinned tab; close the
	// unpinned tab, then press Cmd+W. Obsidian moves focus off the main tab (to the
	// file explorer, or nowhere), yet the pinned tab is still what `close` targets.
	// getMostRecentLeaf() resolves that main-area tab regardless of focus, so the
	// invariant holds whatever the intermediate focus state: Cmd+W prompts, nothing
	// closes.
	await reset();
	const r = await obs.evalInApp(`
		const app = window.app;
		const cp = window.__cp;
		await cp.open('cp-1.md', true);           // pinned
		await cp.open('cp-2.md', true);           // pinned
		const u = await cp.open('cp-3.md', false); // unpinned, active
		await new Promise((r) => setTimeout(r, 200));

		u.detach();                                // close the sole unpinned tab
		await new Promise((r) => setTimeout(r, 250));

		const pinnedBefore = cp.pinnedCount();
		cp.close();                                // the second Cmd+W
		await new Promise((r) => setTimeout(r, 250));
		const modal = !!cp.confirmModal();
		const pinnedAfter = cp.pinnedCount();
		cp.dismissModal();
		return { pinnedBefore, pinnedAfter, modal };
	`);
	assert.equal(r.modal, true, "Cmd+W after the unpinned tab is gone prompts before touching a pinned tab");
	assert.equal(r.pinnedAfter, r.pinnedBefore, "no pinned tab is closed without confirmation");
});

test("REGRESSION (no active leaf): a displayed-but-unfocused pinned tab is resolved and prompts", async () => {
	// The "visible but not selected" state from the video: a pinned tab is the
	// current main-area tab while nothing is the focused/active leaf. Forced here
	// so it runs deterministically. getMostRecentLeaf() returns the pinned tab even
	// with activeLeaf null, so the prompt fires; pre-fix, the focused-leaf read was
	// null and the close slipped through.
	await reset();
	const r = await obs.evalInApp(`
		const app = window.app;
		const cp = window.__cp;
		await cp.open('cp-1.md', true);
		const p2 = await cp.open('cp-2.md', true);
		const u = await cp.open('cp-3.md', false);
		await new Promise((r) => setTimeout(r, 200));

		u.detach();
		await new Promise((r) => setTimeout(r, 150));
		app.workspace.setActiveLeaf(p2, { focus: true }); // p2 is the visible pinned tab...
		await new Promise((r) => setTimeout(r, 100));
		app.workspace.activeLeaf = null;                  // ...now displayed but unselected

		const noActiveLeaf = app.workspace.activeLeaf == null;
		const pinnedBefore = cp.pinnedCount();
		cp.close();
		await new Promise((r) => setTimeout(r, 250));
		const modal = !!cp.confirmModal();
		const pinnedAfter = cp.pinnedCount();
		cp.dismissModal();
		return { noActiveLeaf, pinnedBefore, pinnedAfter, modal };
	`);
	assert.equal(r.noActiveLeaf, true, "precondition: no active leaf (the visible-but-unfocused state)");
	assert.equal(r.modal, true, "the pinned tab is resolved and prompts even with no active leaf");
	assert.equal(r.pinnedAfter, r.pinnedBefore, "no pinned tab is closed without confirmation");
});

test("with confirmBeforeClose off, closing a pinned tab is blocked outright (no close, no modal)", async () => {
	await reset();
	const r = await obs.evalInApp(`
		const cp = window.__cp;
		cp.rp.settings.confirmBeforeClose = false;
		await cp.open('cp-1.md', true); // pinned, active
		await new Promise((r) => setTimeout(r, 150));
		const before = cp.pinnedCount();
		cp.close();
		await new Promise((r) => setTimeout(r, 250));
		const out = { before, after: cp.pinnedCount(), modal: !!cp.confirmModal() };
		cp.rp.settings.confirmBeforeClose = true;
		return out;
	`);
	assert.equal(r.modal, false, "no modal when confirmation is disabled");
	assert.equal(r.after, r.before, "the pinned tab is not closed (block-outright)");
});
