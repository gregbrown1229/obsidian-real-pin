// End-to-end test of the core feature — confirm before closing a pinned tab —
// against a real, headless Obsidian. This is the one behavior the unit gate
// can't reach: it lives entirely in the `workspace:close` command patch
// (src/main.ts) and depends on real Obsidian workspace state.
//
// The regression it guards (reported bug): with exactly one unpinned tab open
// plus one or more pinned tabs, closing the unpinned tab leaves a pinned tab
// "visible but not selected" — Obsidian displays it without making it the
// focused/active leaf. In that state `getActiveViewOfType(View)` is null, so the
// patch used to treat the close as "no pinned tab here" and let it through: a
// second Cmd+W closed the pinned tab with NO confirmation modal. The fix falls
// back to the most-recently-active leaf so that visible-but-unfocused pinned tab
// is still guarded.
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

test("REGRESSION (natural flow): closing the sole unpinned tab then Cmd+W never loses a pinned tab without a prompt", async () => {
	// The reported flow, unforced: N pinned tabs + one unpinned tab; close the
	// unpinned tab, then press Cmd+W. Obsidian is left displaying a pinned tab that
	// may not be the focused/active leaf (activeLeaf null) — the state where the
	// pre-fix guard read getActiveViewOfType() as null and let the close through.
	// The invariant must hold whatever the intermediate focus state: that second
	// Cmd+W prompts and closes nothing.
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

		// Diagnostics (not assertions): whether Obsidian naturally left no focused
		// leaf, and whether the most-recent main-area leaf the fix falls back to is
		// pinned. These document that the real flow reaches the fallback path.
		const naturallyNoActiveLeaf = app.workspace.activeLeaf == null;
		const mr = app.workspace.getMostRecentLeaf();
		let mostRecentPinned = null; try { mostRecentPinned = mr ? !!mr.getViewState().pinned : null; } catch {}

		const pinnedBefore = cp.pinnedCount();
		cp.close();                                // the second Cmd+W
		await new Promise((r) => setTimeout(r, 250));
		const modal = !!cp.confirmModal();
		const pinnedAfter = cp.pinnedCount();
		cp.dismissModal();
		return { naturallyNoActiveLeaf, mostRecentPinned, pinnedBefore, pinnedAfter, modal };
	`);
	// Whatever the intermediate focus state, the safety invariant holds:
	assert.equal(r.modal, true, "Cmd+W after the unpinned tab is gone prompts before touching a pinned tab");
	assert.equal(r.pinnedAfter, r.pinnedBefore, "no pinned tab is closed without confirmation");
});

test("REGRESSION (forced state): a visible-but-unfocused pinned tab still routes through the fallback and prompts", async () => {
	// Deterministic companion to the natural-flow test: force the exact
	// "displayed but not selected" state the video shows — a pinned tab is the most
	// recent main-area leaf while nothing is the focused/active leaf — so the
	// getMostRecentLeaf() fallback is exercised on every run, not only when
	// Obsidian happens to clear focus. Pre-fix, getActiveViewOfType() was null here
	// and the close slipped through unconfirmed.
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
	assert.equal(r.modal, true, "the fallback resolves the visible pinned tab and prompts");
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
