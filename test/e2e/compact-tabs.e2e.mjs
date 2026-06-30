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

	// Arrange once: enable the feature, open both fixture notes in pinned tabs,
	// then simulate Iconize painting an icon onto one of them *after* the tab is
	// already open — exactly the "icon arrives late" race. The controller's
	// MutationObserver should notice and compact that tab on its own, with no
	// explicit refresh and no tab click. Leaves are stashed on a page global so
	// later (serializable-only) reads can refer back to them.
	await obs.evalInApp(`
		const app = window.app;
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

		// Paint an Iconize-style icon (its '.iconize-icon' + 'data-icon' markers)
		// into the tab header, the way Iconize does once its data loads.
		const iconEl = window.__rp.withIcon.tabHeaderEl.querySelector('.workspace-tab-header-inner-icon');
		iconEl.style.display = 'flex';
		const icon = document.createElement('div');
		icon.className = 'iconize-icon';
		icon.setAttribute('data-icon', 'LiHome');
		icon.textContent = '🏠';
		iconEl.appendChild(icon);

		// Do NOT call refresh() here: the observer must drive the compaction.
		for (let i = 0; i < 60; i++) {
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
