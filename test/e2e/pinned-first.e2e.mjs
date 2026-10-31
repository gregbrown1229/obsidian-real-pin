// End-to-end test of "Keep pinned tabs first" against a real, headless Obsidian.
// The decision (a stable partition) is unit-tested in
// scripts/pinnedTabsFirst.test.mjs; this asserts the Obsidian-only behavior end
// to end: enabling sorts existing tabs immediately, pin → end of the pinned
// block, unpin → first unpinned, a drag across the boundary snaps back, the
// shown tab never changes under a re-sort, each split and popout is sorted on
// its own, sidebars are left alone, the setting is inert when off, and pinned
// tabs can't be grouped while tab groups are on.
//
// Native OS drag-and-drop can't be scripted over CDP, so a "drag" is simulated
// with the same `removeChild`/`insertChild` reorder Obsidian's drop handler
// performs (which fires `layout-change`); the real drag feel is a manual check.
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

	// Page-side helpers, stashed on a global so each test reads tersely. Tabs are
	// named after the note they show; `order()` reads the strip's `children`
	// model (what Ctrl+Tab / Cmd+1…9 follow), `shown()` the tab it displays.
	await obs.evalInApp(`
		const app = window.app;
		const ws = app.workspace;
		const rp = app.plugins.plugins['real-pin'];
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const ensure = async (name) =>
			app.vault.getAbstractFileByPath(name + '.md') ||
			(await app.vault.create(name + '.md', '# ' + name));
		const names = ['a', 'b', 'c', 'd', 'e'];
		for (const n of names) await ensure(n);
		const nameOf = (leaf) => leaf.view.file?.basename ?? '?';

		window.__pf = {
			rp,
			tabs: {},
			sleep,
			nameOf,
			set(on) {
				rp.settings.pinnedTabsFirst = on;
				rp.pinnedTabsFirst.apply();
			},
			/** Fresh single strip of tabs a…(n), setting off, nothing pinned. */
			async reset(n) {
				this.set(false);
				rp.settings.enableTabGroups = false;
				rp.tabGroups.apply();
				// iterateRootLeaves omits deferred (background) tabs, so gather each
				// strip's complete \`children\` instead.
				const old = new Set();
				ws.iterateRootLeaves((l) => l.parent.children.forEach((c) => old.add(c)));
				this.tabs = {};
				for (const name of names.slice(0, n)) {
					const leaf = ws.getLeaf('tab');
					await leaf.openFile(app.vault.getAbstractFileByPath(name + '.md'));
					this.tabs[name] = leaf;
				}
				// getLeaf('tab') reuses an empty active tab, so never detach a new one.
				const fresh = new Set(Object.values(this.tabs));
				for (const l of old) {
					if (fresh.has(l)) continue;
					l.setPinned(false);
					l.detach();
				}
				await sleep(150);
			},
			order(name = 'a') {
				return this.tabs[name].parent.children.map(nameOf).join('');
			},
			shown(name = 'a') {
				const p = this.tabs[name].parent;
				return nameOf(p.children[p.currentTab]);
			},
			/** Poll until order(name) === want (or time out); returns the last order. */
			async until(want, name = 'a') {
				for (let i = 0; i < 60 && this.order(name) !== want; i++) await sleep(50);
				return this.order(name);
			},
			/** What Obsidian's tab drop does: reorder the strip's children. */
			drag(name, index) {
				const leaf = this.tabs[name];
				const strip = leaf.parent; // removeChild clears leaf.parent
				strip.removeChild(leaf);
				strip.insertChild(index, leaf);
			},
		};
		return true;
	`);
});

after(async () => {
	await obs?.close();
});

const page = (body) => obs.evalInApp(`const pf = window.__pf; ${body}`);

test("off by default: pinning a tab leaves it where it is", async () => {
	const r = await page(`
		await pf.reset(4);
		const off = pf.rp.settings.pinnedTabsFirst;
		pf.tabs.c.setPinned(true);
		await pf.sleep(300);
		return { off, order: pf.order() };
	`);
	assert.equal(r.off, false, "the setting is off by default");
	assert.equal(r.order, "abcd", "nothing moves while the setting is off");
});

test("turning the setting on sorts existing tabs immediately, keeping the shown tab", async () => {
	// Continues from the previous test: "c" is pinned at index 2, "d" is shown.
	const r = await page(`
		const before = { order: pf.order(), shown: pf.shown() };
		pf.set(true);
		return {
			before,
			order: pf.order(), // synchronous: no wait for a layout-change
			shown: pf.shown(),
			dVisible: pf.tabs.d.containerEl.isShown(),
			dActiveHeader: pf.tabs.d.tabHeaderEl.classList.contains('is-active'),
		};
	`);
	assert.deepEqual(r.before, { order: "abcd", shown: "d" });
	assert.equal(r.order, "cabd", "the pinned tab moves first as soon as the setting is on");
	assert.equal(r.shown, "d", "the strip still shows the same tab");
	assert.equal(r.dVisible, true, "the shown tab's view stays visible");
	assert.equal(r.dActiveHeader, true, "the shown tab's header stays active");
});

test("pinning a tab moves it to the end of the pinned tabs", async () => {
	const r = await page(`
		await pf.reset(5);
		pf.set(true);
		pf.tabs.c.setPinned(true);
		const first = await pf.until('cabde');
		pf.tabs.e.setPinned(true);
		const second = await pf.until('ceabd');
		return { first, second };
	`);
	assert.equal(r.first, "cabde", "the first pinned tab moves to the front");
	assert.equal(r.second, "ceabd", "the next one lands after it, not before");
});

test("unpinning a tab moves it just after the pinned tabs", async () => {
	// Continues: "c" and "e" are pinned → "ceabd".
	const r = await page(`
		pf.tabs.c.setPinned(false);
		return await pf.until('ecabd');
	`);
	assert.equal(r, "ecabd", "the unpinned tab becomes the first unpinned tab");
});

test("a tab dragged across the pinned boundary snaps back", async () => {
	// Continues: only "e" is pinned → "ecabd".
	const r = await page(`
		pf.drag('b', 0); // unpinned tab dropped before the pinned one
		const unpinnedIn = await pf.until('ebcad');
		pf.drag('e', 4); // pinned tab dropped at the far end
		const pinnedOut = await pf.until('ebcad');
		pf.drag('a', 1); // a reorder within the unpinned tabs is left alone
		await pf.sleep(300);
		return { unpinnedIn, pinnedOut, within: pf.order() };
	`);
	assert.equal(r.unpinnedIn, "ebcad", "an unpinned tab dropped among pinned ones snaps to the boundary");
	assert.equal(r.pinnedOut, "ebcad", "a pinned tab dropped among unpinned ones snaps back");
	assert.equal(r.within, "eabcd", "reordering within the unpinned tabs isn't undone");
});

test("pinning never changes which tab the strip shows", async () => {
	const r = await page(`
		await pf.reset(4);
		pf.set(true);
		// Pin the shown tab from mid-strip…
		app.workspace.setActiveLeaf(pf.tabs.c, { focus: true });
		pf.tabs.c.setPinned(true);
		const self = { order: await pf.until('cabd'), shown: pf.shown() };
		// …and a background tab that moves past the shown one.
		app.workspace.setActiveLeaf(pf.tabs.d, { focus: true });
		pf.tabs.b.setPinned(true);
		const other = { order: await pf.until('cbad'), shown: pf.shown() };
		return { self, other };
	`);
	assert.deepEqual(r.self, { order: "cabd", shown: "c" }, "the pinned shown tab stays shown");
	assert.deepEqual(r.other, { order: "cbad", shown: "d" }, "moving another tab doesn't switch tabs");
});

test("each split pane keeps its own pinned tabs first", async () => {
	const r = await page(`
		await pf.reset(2); // left pane: a, b
		pf.set(true);
		const ws = app.workspace;
		app.workspace.setActiveLeaf(pf.tabs.b, { focus: true });
		const c = ws.getLeaf('split');
		await c.openFile(app.vault.getAbstractFileByPath('c.md'));
		app.workspace.setActiveLeaf(c, { focus: true });
		const d = ws.getLeaf('tab');
		await d.openFile(app.vault.getAbstractFileByPath('d.md'));
		Object.assign(pf.tabs, { c, d });
		const separate = c.parent !== pf.tabs.a.parent;
		d.setPinned(true);
		const right = await pf.until('dc', 'c');
		pf.tabs.b.setPinned(true);
		const left = await pf.until('ba', 'a');
		return { separate, right, left, rightAfter: pf.order('c') };
	`);
	assert.equal(r.separate, true, "fixture: the split has its own tab strip");
	assert.equal(r.right, "dc", "the split's pinned tab moves first within that split");
	assert.equal(r.left, "ba", "the other pane is sorted on its own");
	assert.equal(r.rightAfter, "dc", "and that doesn't disturb the split");
});

test("a popout window keeps its pinned tabs first", async (t) => {
	const r = await page(`
		await pf.reset(1);
		pf.set(true);
		const ws = app.workspace;
		if (typeof ws.openPopoutLeaf !== 'function') return { skipped: true };
		const b = ws.openPopoutLeaf();
		await b.openFile(app.vault.getAbstractFileByPath('b.md'));
		app.workspace.setActiveLeaf(b, { focus: true });
		const c = ws.getLeaf('tab');
		await c.openFile(app.vault.getAbstractFileByPath('c.md'));
		Object.assign(pf.tabs, { b, c });
		const popout = b.view.containerEl.ownerDocument !== document && c.parent === b.parent;
		c.setPinned(true);
		const order = await pf.until('cb', 'b');
		b.detach(); c.detach();
		await pf.sleep(150);
		return { popout, order };
	`);
	if (r.skipped) return t.skip("this Obsidian build has no openPopoutLeaf");
	assert.equal(r.popout, true, "fixture: both tabs share a strip in a popout window");
	assert.equal(r.order, "cb", "the popout's pinned tab moves first");
});

test("sidebar tabs are left alone", async (t) => {
	const r = await page(`
		pf.set(true);
		const ws = app.workspace;
		let strip = null;
		ws.iterateAllLeaves((l) => {
			if (!strip && l.getRoot() === ws.leftSplit && l.parent.children?.length >= 2) strip = l.parent;
		});
		if (!strip) return { skipped: true };
		const last = strip.children[strip.children.length - 1];
		const before = strip.children.indexOf(last);
		last.setPinned(true);
		await pf.sleep(300);
		const after = strip.children.indexOf(last);
		last.setPinned(false);
		return { before, after };
	`);
	if (r.skipped) return t.skip("no sidebar tab strip with two or more tabs");
	assert.equal(r.after, r.before, "a pinned sidebar tab isn't moved");
});

test("turning the setting off stops enforcing (and moves nothing back)", async () => {
	const r = await page(`
		await pf.reset(3);
		pf.set(true);
		pf.tabs.c.setPinned(true);
		const on = await pf.until('cab');
		pf.set(false);
		const afterOff = pf.order();
		pf.tabs.b.setPinned(true);
		await pf.sleep(300);
		return { on, afterOff, pinOff: pf.order() };
	`);
	assert.equal(r.on, "cab");
	assert.equal(r.afterOff, "cab", "turning it off leaves the current order as-is");
	assert.equal(r.pinOff, "cab", "pinning no longer moves a tab");
});

/** Members of the group `gid`, by tab name (empty if the group is gone). */
const members = `(gid) => (pf.rp.tabGroups.getGroups().find((g) => g.id === gid)?.memberIds ?? [])
	.map((id) => Object.entries(pf.tabs).find(([, l]) => l.id === id)?.[0]).join('')`;

test("with tab groups on, pinning a grouped tab removes it from the group", async () => {
	const r = await page(`
		const membersOf = ${members};
		await pf.reset(4);
		pf.rp.settings.enableTabGroups = true;
		pf.rp.tabGroups.apply();
		pf.set(true);
		const g = pf.rp.tabGroups.createGroup([pf.tabs.b.id, pf.tabs.c.id]);
		await pf.sleep(150);
		const before = membersOf(g.id);
		pf.tabs.c.setPinned(true);
		const order = await pf.until('cabd');
		for (let i = 0; i < 40 && membersOf(g.id) !== 'b'; i++) await pf.sleep(50);
		return {
			before,
			order,
			after: membersOf(g.id),
			cTagged: pf.tabs.c.tabHeaderEl.dataset.rpGroup ?? null,
			gid: g.id,
		};
	`);
	assert.equal(r.before, "bc", "fixture: b and c are grouped");
	assert.equal(r.order, "cabd", "the pinned tab moves first");
	assert.equal(r.after, "b", "the pinned tab leaves its group; the rest stay grouped");
	assert.equal(r.cTagged, null, "the pinned tab's header is no longer tagged as a member");
});

test("with tab groups on, adding a pinned tab to a group unpins it", async () => {
	// Continues: "c" pinned, group = [b] → "cabd".
	const r = await page(`
		const membersOf = ${members};
		const gid = pf.rp.tabGroups.getGroups()[0].id;
		pf.rp.tabGroups.addLeafToGroup(pf.tabs.c.id, gid);
		for (let i = 0; i < 40 && membersOf(gid) !== 'bc'; i++) await pf.sleep(50);
		await pf.sleep(150);
		return {
			pinned: pf.tabs.c.getViewState().pinned === true,
			members: membersOf(gid),
			order: pf.order(),
		};
	`);
	assert.equal(r.pinned, false, "grouping a pinned tab unpins it (as in Chrome)");
	assert.equal(r.members, "bc", "it joins the group");
	assert.equal(r.order, "abcd", "and sits next to the group's other tab");
});

test("enabling the setting ungroups tabs that are already pinned", async () => {
	const r = await page(`
		const membersOf = ${members};
		await pf.reset(4);
		pf.rp.settings.enableTabGroups = true;
		pf.rp.tabGroups.apply();
		const g = pf.rp.tabGroups.createGroup([pf.tabs.b.id, pf.tabs.c.id]);
		pf.tabs.c.setPinned(true); // setting off: c stays put, grouped
		await pf.sleep(300);
		const before = { order: pf.order(), members: membersOf(g.id) };
		// What the settings toggle does.
		pf.set(true);
		pf.rp.tabGroups.apply();
		for (let i = 0; i < 40 && membersOf(g.id) !== 'b'; i++) await pf.sleep(50);
		return { before, order: pf.order(), members: membersOf(g.id) };
	`);
	assert.deepEqual(r.before, { order: "abcd", members: "bc" }, "fixture: a pinned member, setting off");
	assert.equal(r.order, "cabd", "enabling moves the pinned tab first");
	assert.equal(r.members, "b", "and removes it from its group");
});
