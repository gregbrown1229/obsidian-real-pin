// End-to-end test of the compact-pinned-tabs feature against a real, headless
// Obsidian with Iconize installed. This is the automated form of the manual
// in-Obsidian checklist: it proves the real tab DOM, the Iconize gate, the
// marker class + aria-label, that styles.css caps the width, and that Iconize's
// `allIconsLoaded` event makes a tab compact without a click (the startup race).
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

	// Arrange once: assign a real Iconize icon to with-icon.md (the way the
	// right-click menu does — this is what `getIconNameFromPath` reads), enable
	// the feature, and open both fixture notes in pinned tabs. Leaves are stashed
	// on a page global so later (serializable-only) reads can refer back to them.
	await obs.evalInApp(`
		const app = window.app;
		const ic = app.plugins.plugins['obsidian-icon-folder'];
		for (let i = 0; i < 100; i++) {
			if (typeof ic.addFolderIcon === 'function' && typeof ic.getIconNameFromPath === 'function') break;
			await new Promise((r) => setTimeout(r, 100));
		}
		if (ic.settings) ic.settings.iconInTabsEnabled = true;
		await ic.addFolderIcon('with-icon.md', '🏠');
		if (typeof ic.saveIconFolderData === 'function') await ic.saveIconFolderData();

		const rp = app.plugins.plugins['real-pin'];
		rp.settings.compactPinnedTabs = true;

		const openPinned = async (path) => {
			const file = app.vault.getAbstractFileByPath(path);
			const leaf = app.workspace.getLeaf('tab');
			await leaf.openFile(file);
			leaf.setPinned(true);
			return leaf;
		};

		window.__rp = {
			rp,
			withIcon: await openPinned('with-icon.md'),
			noIcon: await openPinned('no-icon.md'),
		};

		// Reconcile until the marker lands (the icon is already assigned, so this
		// is deterministic).
		for (let i = 0; i < 60; i++) {
			rp.compactTabs.refresh();
			if (window.__rp.withIcon.tabHeaderEl.classList.contains('real-pin-compact-tab')) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		return true;
	`);
});

after(async () => {
	await obs?.close();
});

/** Read the marker class, aria-label, and title visibility off a stashed leaf's tab header. */
const readTab = (leafKey) =>
	obs.evalInApp(`
		const h = window.__rp.${leafKey}.tabHeaderEl;
		const title = h.querySelector('.workspace-tab-header-inner-title');
		return {
			marker: h.classList.contains('real-pin-compact-tab'),
			ariaLabel: h.getAttribute('aria-label'),
			titleDisplay: title ? getComputedStyle(title).display : '(no title el)',
		};
	`);

test("a pinned note with an Iconize icon compacts to icon-only", async () => {
	const r = await readTab("withIcon");
	assert.equal(r.marker, true, "marker class should be applied");
	assert.equal(r.titleDisplay, "none", "styles.css should hide the title");
	assert.equal(r.ariaLabel, "with-icon", "hidden title should be re-exposed as aria-label");
});

test("a pinned note without an icon stays full-size", async () => {
	const r = await readTab("noIcon");
	assert.equal(r.marker, false, "no marker on an icon-less tab");
	assert.equal(r.titleDisplay, "block", "title stays visible");
	assert.equal(r.ariaLabel, null, "no aria-label added");
});

test("a compacted tab collapses to the capped width, narrower than a full tab", async () => {
	// Obsidian grows tabs to fill and won't size them to content, so styles.css
	// caps the width via --real-pin-compact-tab-width. Assert the compacted tab
	// respects that cap (read from computed style — no hard-coded px) and is
	// clearly narrower than the non-compacted icon-less tab.
	const r = await obs.evalInApp(`
		const compact = window.__rp.withIcon.tabHeaderEl.getBoundingClientRect().width;
		const full = window.__rp.noIcon.tabHeaderEl.getBoundingClientRect().width;
		const cap = parseFloat(getComputedStyle(window.__rp.withIcon.tabHeaderEl).maxWidth);
		return { compact, full, cap };
	`);
	assert.ok(Number.isFinite(r.cap), "compacted tab should have a finite max-width cap");
	assert.ok(r.compact <= r.cap + 1, `compacted width ${r.compact} should respect the cap ${r.cap}`);
	assert.ok(r.compact < r.full, `compacted tab (${r.compact}) should be narrower than a full tab (${r.full})`);
});

test("Iconize's allIconsLoaded event compacts the tab with no click (startup-race fix)", async () => {
	// Strip our marker to simulate the moment before Iconize's data is in, then
	// fire Iconize's readiness event. Our listener must reconcile on its own —
	// no manual refresh, no tab click.
	const r = await obs.evalInApp(`
		const app = window.app;
		const h = window.__rp.withIcon.tabHeaderEl;
		h.classList.remove('real-pin-compact-tab');
		h.removeAttribute('aria-label');
		const before = h.classList.contains('real-pin-compact-tab');
		app.plugins.plugins['obsidian-icon-folder'].getEventEmitter().emit('allIconsLoaded');
		for (let i = 0; i < 60; i++) {
			if (h.classList.contains('real-pin-compact-tab')) break;
			await new Promise((r) => setTimeout(r, 50));
		}
		return { before, after: h.classList.contains('real-pin-compact-tab') };
	`);
	assert.equal(r.before, false, "marker should start cleared");
	assert.equal(r.after, true, "allIconsLoaded should re-compact the tab via our listener");
});

test("unpinning expands and re-pinning re-compacts, with no tab switch", async () => {
	// Pin/unpin fires only a per-leaf `pinned-change` (no workspace event), so
	// without wiring it the tab wouldn't update until you click another tab.
	const r = await obs.evalInApp(`
		const leaf = window.__rp.withIcon;
		const has = () => leaf.tabHeaderEl.classList.contains('real-pin-compact-tab');
		const waitFor = async (want) => { for (let i = 0; i < 50; i++) { if (has() === want) break; await new Promise((r) => setTimeout(r, 50)); } return has(); };
		const start = has();
		leaf.setPinned(false);
		const afterUnpin = await waitFor(false);
		leaf.setPinned(true);
		const afterPin = await waitFor(true);
		return { start, afterUnpin, afterPin };
	`);
	assert.equal(r.start, true, "tab starts compacted");
	assert.equal(r.afterUnpin, false, "unpinning should expand the tab");
	assert.equal(r.afterPin, true, "re-pinning should compact again without switching tabs");
});

test("turning the setting off reverts compacted tabs", async () => {
	await obs.evalInApp(`
		const rp = window.__rp.rp;
		rp.settings.compactPinnedTabs = false;
		rp.compactTabs.refresh();
		return true;
	`);
	const r = await readTab("withIcon");
	assert.equal(r.marker, false, "marker removed when the feature is off");
	assert.equal(r.titleDisplay, "block", "title restored");
	assert.equal(r.ariaLabel, null, "aria-label removed");
});
