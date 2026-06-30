// End-to-end test of Chrome-style tab groups against a real, headless Obsidian.
// Unlike compact-pinned-tabs (pure CSS), tab groups need JavaScript: the
// controller tags member tab headers with `data-rp-*` and inserts a chip into
// the tab strip, driven by an idempotent reconcile. This asserts the real
// behavior end to end: grouping tags members + inserts a chip, an ungrouped tab
// is untouched, collapsing hides members but keeps the chip, dragging a tab into
// a group's run joins it (membership inferred from native reorder), and
// disabling the feature reverts everything.
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

	// Enable the feature, then open three notes as tabs and group the first two.
	await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		rp.settings.enableTabGroups = true;
		rp.tabGroups.apply();

		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['rp-a.md','rp-b.md','rp-c.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('rp-a.md'), b = await open('rp-b.md'), c = await open('rp-c.md');
		await new Promise(r => setTimeout(r, 200));

		const group = rp.tabGroups.createGroup([a.id, b.id]);
		await new Promise(r => setTimeout(r, 100));
		window.__tg = { rp, a, b, c, groupId: group.id };
		return true;
	`);
});

after(async () => {
	await obs?.close();
});

const read = (leafKey) =>
	obs.evalInApp(`
		const h = window.__tg.${leafKey}.tabHeaderEl;
		return {
			group: h.dataset.rpGroup || null,
			color: h.dataset.rpColor || null,
			pos: h.dataset.rpPos || null,
			collapsed: h.dataset.rpCollapsed || null,
			display: getComputedStyle(h).display,
		};
	`);

test("the body class arms the feature", async () => {
	const armed = await obs.evalInApp(
		`return activeDocument.body.classList.contains('real-pin-tab-groups');`,
	);
	assert.equal(armed, true);
});

test("grouped tabs are tagged and a chip is inserted before the first member", async () => {
	const a = await read("a");
	const b = await read("b");
	assert.equal(a.group, await obs.evalInApp(`return window.__tg.groupId;`));
	assert.ok(a.color, "member carries a color");
	assert.equal(a.pos, "first", "first member rounds on the left");
	assert.equal(b.pos, "last", "last member rounds on the right");

	const chip = await obs.evalInApp(`
		const a = window.__tg.a.tabHeaderEl;
		const strip = a.parentElement;
		const chip = strip.querySelector('.real-pin-group-chip');
		return {
			exists: !!chip,
			beforeFirst: !!chip && chip.nextElementSibling === a,
			color: chip ? chip.dataset.rpColor : null,
		};
	`);
	assert.equal(chip.exists, true, "a chip is rendered in the strip");
	assert.equal(chip.beforeFirst, true, "chip sits before the first member");
});

test("an ungrouped tab is left untouched", async () => {
	const c = await read("c");
	assert.equal(c.group, null);
	assert.equal(c.pos, null);
});

test("collapsing hides members but keeps the chip", async () => {
	await obs.evalInApp(
		`window.__tg.rp.tabGroups.toggleCollapse(window.__tg.groupId); await new Promise(r=>setTimeout(r,100)); return true;`,
	);
	const a = await read("a");
	assert.equal(a.collapsed, "1", "member marked collapsed");
	assert.equal(a.display, "none", "member tab is hidden");
	const chipVisible = await obs.evalInApp(`
		const strip = window.__tg.a.tabHeaderEl.parentElement;
		const chip = strip.querySelector('.real-pin-group-chip');
		return !!chip && getComputedStyle(chip).display !== 'none';
	`);
	assert.equal(chipVisible, true, "chip stays visible while collapsed");

	// expand again for the following tests
	await obs.evalInApp(
		`window.__tg.rp.tabGroups.toggleCollapse(window.__tg.groupId); await new Promise(r=>setTimeout(r,100)); return true;`,
	);
	assert.equal((await read("a")).display !== "none", true, "member shown again");
});

test("dragging an ungrouped tab into the group's run joins it", async () => {
	// Simulate Obsidian's native reorder: move c between a and b using the same
	// internal WorkspaceTabs ops a drag performs. The controller's observer then
	// reconciles membership from the new order.
	const joined = await obs.evalInApp(`
		const { a, b, c } = window.__tg;
		const parent = a.parent;
		const strip = a.tabHeaderEl.parentElement;
		const idxOf = (leaf) => [...strip.querySelectorAll(':scope > .workspace-tab-header')].indexOf(leaf.tabHeaderEl);
		parent.removeChild(c);
		parent.insertChild(idxOf(b), c); // drop c just before b => inside the a..b run
		await new Promise(r => setTimeout(r, 250));
		return c.tabHeaderEl.dataset.rpGroup === window.__tg.groupId;
	`);
	assert.equal(joined, true, "c joined the group after landing inside its run");
});

test("live groups are persisted so they survive a reload", async () => {
	const persisted = await obs.evalInApp(`
		await new Promise(r => setTimeout(r, 600)); // let the debounced save fire
		const groups = window.__tg.rp.getLiveGroups();
		const g = groups.find(x => x.id === window.__tg.groupId);
		return {
			count: groups.length,
			found: !!g,
			hasMembers: !!g && g.memberIds.includes(window.__tg.a.id) && g.memberIds.includes(window.__tg.b.id),
		};
	`);
	assert.equal(persisted.found, true, "the group is written to plugin data");
	assert.equal(persisted.hasMembers, true, "its members are persisted");
});

test("saving a group then reopening it restores its tabs as a group", async () => {
	const r = await obs.evalInApp(`
		const rp = window.__tg.rp;
		rp.tabGroups.saveGroup(window.__tg.groupId);
		await new Promise(r => setTimeout(r, 120));
		const saved = rp.getSavedGroups();
		const s = saved[saved.length - 1];
		const savedCount = s.members.length;
		await rp.tabGroups.openSavedGroup(s.id);
		await new Promise(r => setTimeout(r, 350));
		const reopened = rp.tabGroups.getGroups().find(g => g.name === s.name && g.id !== window.__tg.groupId);
		return {
			savedCount,
			reopenedExists: !!reopened,
			reopenedMembers: reopened ? reopened.memberIds.length : 0,
			savedColor: s.color,
			reopenedColor: reopened ? reopened.color : null,
		};
	`);
	assert.ok(r.savedCount >= 2, "saved group captured its members");
	assert.equal(r.reopenedExists, true, "reopening creates a live group with the saved name");
	assert.equal(r.reopenedMembers, r.savedCount, "every member reopened");
	assert.equal(r.reopenedColor, r.savedColor, "color preserved on reopen");
});

test("the saved-groups panel lists saved groups", async () => {
	const rows = await obs.evalInApp(`
		await window.__tg.rp.activateSavedGroupsView();
		await new Promise(r => setTimeout(r, 250));
		return activeDocument.querySelectorAll('.real-pin-saved-group').length;
	`);
	assert.ok(rows >= 1, "panel renders at least one saved group");
});

test("disabling the feature reverts every tab and removes chips", async () => {
	const r = await obs.evalInApp(`
		const rp = window.__tg.rp;
		rp.settings.enableTabGroups = false;
		rp.tabGroups.apply();
		await new Promise(r => setTimeout(r, 100));
		const strip = window.__tg.a.tabHeaderEl.parentElement;
		return {
			armed: activeDocument.body.classList.contains('real-pin-tab-groups'),
			chips: strip.querySelectorAll('.real-pin-group-chip').length,
			aGroup: window.__tg.a.tabHeaderEl.dataset.rpGroup || null,
		};
	`);
	assert.equal(r.armed, false, "body gate class removed");
	assert.equal(r.chips, 0, "all chips removed");
	assert.equal(r.aGroup, null, "member attributes cleared");
});
