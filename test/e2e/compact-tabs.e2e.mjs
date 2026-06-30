// End-to-end test of the compact-pinned-tabs feature against a real, headless
// Obsidian with Iconize installed. This is the automated form of the manual
// in-Obsidian checklist: it proves the real tab DOM, the Iconize gate, the
// marker class + aria-label, and that styles.css actually hides the title.
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

	// Arrange once: make Iconize paint tab icons, enable our feature, and open
	// both fixture notes in pinned tabs. Leaves are stashed on a page global so
	// later (serializable-only) reads can refer back to them.
	await obs.evalInApp(`
		const app = window.app;
		const iconize = app.plugins.plugins['obsidian-icon-folder'];
		if (iconize?.settings) iconize.settings.iconInTabsEnabled = true;
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

		// Reconcile, but wait until with-icon.md's frontmatter icon is actually
		// indexed and the marker has landed — opening a file and reconciling in the
		// same tick races the metadata cache and makes the suite flaky.
		const withIconFile = app.vault.getAbstractFileByPath('with-icon.md');
		for (let i = 0; i < 75; i++) {
			rp.compactTabs.refresh();
			const indexed = !!app.metadataCache.getFileCache(withIconFile)?.frontmatter?.icon;
			const marked = window.__rp.withIcon.tabHeaderEl.classList.contains('real-pin-compact-tab');
			if (indexed && marked) break;
			await new Promise((r) => setTimeout(r, 200));
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
	assert.ok(
		r.compact <= r.cap + 1,
		`compacted width ${r.compact} should respect the cap ${r.cap}`,
	);
	assert.ok(
		r.compact < r.full,
		`compacted tab (${r.compact}) should be narrower than a full tab (${r.full})`,
	);
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
