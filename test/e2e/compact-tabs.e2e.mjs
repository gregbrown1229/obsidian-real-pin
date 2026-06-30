// End-to-end test of the compact-pinned-tabs feature against a real, headless
// Obsidian. The feature is pure CSS: Obsidian renders a
// `.workspace-tab-header-status-icon.mod-pinned` element inside a pinned tab's
// header, the bundled styles.css selects it with `:has(...)` (gated on a body
// class the plugin toggles), and pinned tabs shrink to icon-only. There is no
// per-tab JavaScript to test — so this asserts the real behavior end to end:
// that pinning shrinks a tab and hides its title, that an unpinned tab is
// untouched, that pin/unpin is reactive with no marker plumbing, that the width
// slider drives the cap, that Obsidian keeps the title accessible, and that the
// toggle fully reverts.
//
// Run with `npm run test:e2e` (needs a display — CI wraps it in `xvfb-run`).
// `npm run build` must have run first so the plugin's main.js exists.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { launchObsidian } from "./obsidian-harness.mjs";

const VAULT = fileURLToPath(new URL("./vault", import.meta.url));

/** The compact width we configure, asserted against the resolved CSS cap. */
const WIDTH = 80;

let obs;

before(async () => {
	obs = await launchObsidian({ vault: VAULT });

	// Arrange once: enable the feature at a known width, then open two fixture
	// notes — one pinned, one not. No icon assignment needed; the feature compacts
	// every pinned tab regardless of icon. Leaves are stashed on a page global so
	// later (serializable-only) reads can refer back to them.
	await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		rp.settings.compactPinnedTabs = true;
		rp.settings.compactTabWidth = ${WIDTH};
		rp.compactTabs.apply();

		const open = async (path, pin) => {
			const file = app.vault.getAbstractFileByPath(path);
			const leaf = app.workspace.getLeaf('tab');
			await leaf.openFile(file);
			if (pin) leaf.setPinned(true);
			return leaf;
		};

		window.__rp = {
			rp,
			pinned: await open('with-icon.md', true),
			unpinned: await open('no-icon.md', false),
		};

		// Wait for Obsidian to render the pin element the CSS keys on, so reads are
		// deterministic. (Pure CSS applies synchronously once it's in the DOM.)
		for (let i = 0; i < 60; i++) {
			if (window.__rp.pinned.tabHeaderEl.querySelector('.workspace-tab-header-status-icon.mod-pinned')) break;
			await new Promise((r) => setTimeout(r, 50));
		}
		return true;
	`);
});

after(async () => {
	await obs?.close();
});

/** Read the rendered state of a stashed leaf's tab header. */
const readTab = (leafKey) =>
	obs.evalInApp(`
		const h = window.__rp.${leafKey}.tabHeaderEl;
		const title = h.querySelector('.workspace-tab-header-inner-title');
		const cs = getComputedStyle(h);
		return {
			isPinned: !!h.querySelector('.workspace-tab-header-status-icon.mod-pinned'),
			titleDisplay: title ? getComputedStyle(title).display : '(no title el)',
			maxWidth: cs.maxWidth,
			width: window.__rp.${leafKey}.tabHeaderEl.getBoundingClientRect().width,
			ariaLabel: h.getAttribute('aria-label'),
		};
	`);

test("the body class arms the feature; pure CSS does the rest", async () => {
	const armed = await obs.evalInApp(
		`return activeDocument.body.classList.contains('real-pin-compact-pinned-tabs');`,
	);
	assert.equal(armed, true, "enabling the setting adds the body gate class");
});

test("a pinned tab compacts to icon-only at the configured width", async () => {
	const r = await readTab("pinned");
	assert.equal(r.isPinned, true, "fixture tab should be pinned");
	assert.equal(r.titleDisplay, "none", "styles.css should hide the title");
	assert.equal(
		parseFloat(r.maxWidth),
		WIDTH,
		`width should be capped to the configured ${WIDTH}px`,
	);
});

test("an unpinned tab is left full-size", async () => {
	const r = await readTab("unpinned");
	assert.equal(r.isPinned, false, "fixture tab should be unpinned");
	assert.equal(r.titleDisplay, "block", "title stays visible");
	assert.ok(
		parseFloat(r.maxWidth) > WIDTH,
		`unpinned tab should not get the compact cap (got ${r.maxWidth})`,
	);
});

test("a compacted tab is clearly narrower than a full one", async () => {
	const pinned = await readTab("pinned");
	const unpinned = await readTab("unpinned");
	assert.ok(
		pinned.width < unpinned.width,
		`compacted tab (${pinned.width}) should be narrower than a full tab (${unpinned.width})`,
	);
});

test("the width slider drives the cap live", async () => {
	const wide = WIDTH + 40;
	const r = await obs.evalInApp(`
		const rp = window.__rp.rp;
		rp.settings.compactTabWidth = ${wide};
		rp.compactTabs.apply();
		const h = window.__rp.pinned.tabHeaderEl;
		return getComputedStyle(h).maxWidth;
	`);
	assert.equal(parseFloat(r), wide, `cap should follow the slider to ${wide}px`);
	// Restore for any later assertions.
	await obs.evalInApp(
		`const rp = window.__rp.rp; rp.settings.compactTabWidth = ${WIDTH}; rp.compactTabs.apply(); return true;`,
	);
});

test("pin/unpin is reactive with no per-tab JavaScript", async () => {
	// Unpin removes Obsidian's `.mod-pinned` element, so the `:has()` rule stops
	// matching and the tab expands — and re-pinning re-matches. No marker class,
	// no listener: the CSS reacts to the DOM Obsidian itself changes.
	const r = await obs.evalInApp(`
		const leaf = window.__rp.pinned;
		const titleDisplay = () => {
			const t = leaf.tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
			return getComputedStyle(t).display;
		};
		const waitFor = async (want) => { for (let i = 0; i < 50; i++) { if (titleDisplay() === want) break; await new Promise((r) => setTimeout(r, 50)); } return titleDisplay(); };
		const start = titleDisplay();
		leaf.setPinned(false);
		const afterUnpin = await waitFor('block');
		leaf.setPinned(true);
		const afterRepin = await waitFor('none');
		return { start, afterUnpin, afterRepin };
	`);
	assert.equal(r.start, "none", "starts compacted (title hidden)");
	assert.equal(r.afterUnpin, "block", "unpinning expands the tab (title shown)");
	assert.equal(r.afterRepin, "none", "re-pinning compacts again (title hidden)");
});

test("Obsidian keeps the title accessible, so hiding the visible one is safe", async () => {
	// We hide the visible title with CSS; the accessible name must survive. It
	// does, because Obsidian sets the tab header's own aria-label to the title
	// (and shows it as a hover tooltip) — we never touch that.
	const r = await readTab("pinned");
	assert.equal(
		r.ariaLabel,
		"with-icon",
		"Obsidian's header aria-label still exposes the title to screen readers",
	);
});

test("turning the setting off reverts every tab", async () => {
	const r = await obs.evalInApp(`
		const rp = window.__rp.rp;
		rp.settings.compactPinnedTabs = false;
		rp.compactTabs.apply();
		const h = window.__rp.pinned.tabHeaderEl;
		const t = h.querySelector('.workspace-tab-header-inner-title');
		return {
			armed: activeDocument.body.classList.contains('real-pin-compact-pinned-tabs'),
			titleDisplay: getComputedStyle(t).display,
			maxWidth: getComputedStyle(h).maxWidth,
		};
	`);
	assert.equal(r.armed, false, "body gate class removed");
	assert.equal(r.titleDisplay, "block", "title restored");
	assert.ok(
		parseFloat(r.maxWidth) > WIDTH,
		`compact cap lifted (got ${r.maxWidth})`,
	);
});
