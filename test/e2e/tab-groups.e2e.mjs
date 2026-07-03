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

test("add-to-group and remove-from-group (the tab-menu actions) work", async () => {
	// Restores c to ungrouped at the end, so later tests are unaffected.
	const r = await obs.evalInApp(`
		const { rp, c, groupId } = window.__tg;
		const has = () => (rp.tabGroups.getGroups().find(g => g.id === groupId) || { memberIds: [] }).memberIds.includes(c.id);
		rp.tabGroups.addLeafToGroup(c.id, groupId);
		await new Promise(r => setTimeout(r, 120));
		const added = has();
		rp.tabGroups.removeLeafFromGroup(c.id);
		await new Promise(r => setTimeout(r, 120));
		return { added, removed: !has() };
	`);
	assert.equal(r.added, true, "addLeafToGroup adds the tab to the group");
	assert.equal(r.removed, true, "removeLeafFromGroup takes it back out");
});

test("removing a middle tab ejects it so the group stays contiguous", async () => {
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['cg-1.md','cg-2.md','cg-3.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const t1 = await open('cg-1.md'), t2 = await open('cg-2.md'), t3 = await open('cg-3.md');
		await new Promise(r => setTimeout(r, 150));
		const g = rp.tabGroups.createGroup([t1.id, t2.id, t3.id]);
		await new Promise(r => setTimeout(r, 150));

		const strip = t1.tabHeaderEl.parentElement;
		const orderIds = () => [...strip.querySelectorAll(':scope > .workspace-tab-header')].map(h => {
			let id = null; app.workspace.iterateAllLeaves(l => { if (l.tabHeaderEl === h) id = l.id; }); return id;
		});

		rp.tabGroups.removeLeafFromGroup(t2.id); // the MIDDLE tab
		await new Promise(r => setTimeout(r, 300));

		const order = orderIds();
		const grp = rp.tabGroups.getGroups().find(x => x.id === g.id) || { memberIds: [] };
		const memberPos = grp.memberIds.map(id => order.indexOf(id));
		const min = Math.min(...memberPos), max = Math.max(...memberPos);
		const t2Pos = order.indexOf(t2.id);
		const out = {
			t2StillMember: grp.memberIds.includes(t2.id),
			memberCount: grp.memberIds.length,
			contiguous: memberPos.length > 0 && (max - min === memberPos.length - 1),
			t2Outside: t2Pos > max || t2Pos < min,
		};
		rp.tabGroups.ungroup(g.id);
		t1.detach(); t2.detach(); t3.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.t2StillMember, false, "removed tab is no longer a member");
	assert.equal(r.memberCount, 2, "two members remain");
	assert.equal(r.contiguous, true, "the group's members stay contiguous in the strip");
	assert.equal(r.t2Outside, true, "the removed tab is moved outside the group's run");
});

test("dragging the group pill moves the whole group", async () => {
	// Drives the drag handlers + move logic with synthetic DragEvents (the
	// headless harness can't initiate native OS drag-and-drop). Verifies the
	// group relocates as a contiguous block.
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['pd-1.md','pd-2.md','pd-3.md','pd-4.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('pd-1.md'), b = await open('pd-2.md'), u1 = await open('pd-3.md'), u2 = await open('pd-4.md');
		await new Promise(r => setTimeout(r, 150));
		const g = rp.tabGroups.createGroup([a.id, b.id]);
		await new Promise(r => setTimeout(r, 150));
		const strip = a.tabHeaderEl.parentElement;
		const orderIds = () => [...strip.querySelectorAll(':scope > .workspace-tab-header')].map(h => {
			let id = null; app.workspace.iterateAllLeaves(l => { if (l.tabHeaderEl === h) id = l.id; }); return id;
		});
		// Select THIS group's chip — the strip may hold other groups' chips too.
		const chip = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + g.id + '"]');
		const dt = new DataTransfer();
		chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		const rect = u2.tabHeaderEl.getBoundingClientRect();
		const at = { bubbles: true, dataTransfer: dt, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 };
		u2.tabHeaderEl.dispatchEvent(new DragEvent('dragover', at));
		u2.tabHeaderEl.dispatchEvent(new DragEvent('drop', at));
		await new Promise(r => setTimeout(r, 300));
		const order = orderIds();
		const grp = rp.tabGroups.getGroups().find(x => x.id === g.id) || { memberIds: [] };
		const pa = order.indexOf(a.id), pb = order.indexOf(b.id), pu2 = order.indexOf(u2.id);
		const out = { members: grp.memberIds.length, contiguous: Math.abs(pa - pb) === 1, groupAfterU2: Math.min(pa, pb) > pu2 };
		rp.tabGroups.ungroup(g.id);
		a.detach(); b.detach(); u1.detach(); u2.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.members, 2, "group keeps its members");
	assert.equal(r.contiguous, true, "group stays contiguous after the move");
	assert.equal(r.groupAfterU2, true, "the whole group moved past the other tabs");
});

test("dropping a pill on the first group's chip lands it before that group", async () => {
	// The user can't reach the sliver left of a leading group, so dropping onto a
	// group's chip means "place before this whole group" — that's how a group gets
	// moved to the very start of the bar.
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['bf-1.md','bf-2.md','bf-3.md','bf-4.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const g1a = await open('bf-1.md'), g1b = await open('bf-2.md'), g2a = await open('bf-3.md'), g2b = await open('bf-4.md');
		await new Promise(r => setTimeout(r, 150));
		const g1 = rp.tabGroups.createGroup([g1a.id, g1b.id]);
		const g2 = rp.tabGroups.createGroup([g2a.id, g2b.id]);
		await new Promise(r => setTimeout(r, 150));
		const strip = g1a.tabHeaderEl.parentElement;
		const orderIds = () => [...strip.querySelectorAll(':scope > .workspace-tab-header')].map(h => {
			let id = null; app.workspace.iterateAllLeaves(l => { if (l.tabHeaderEl === h) id = l.id; }); return id;
		});
		const chip1 = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + g1.id + '"]');
		const chip2 = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + g2.id + '"]');
		const dt = new DataTransfer();
		chip2.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		const rect = chip1.getBoundingClientRect();
		const at = { bubbles: true, dataTransfer: dt, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 };
		chip1.dispatchEvent(new DragEvent('dragover', at));
		chip1.dispatchEvent(new DragEvent('drop', at));
		await new Promise(r => setTimeout(r, 300));
		const order = orderIds();
		const g2max = Math.max(order.indexOf(g2a.id), order.indexOf(g2b.id));
		const g1min = Math.min(order.indexOf(g1a.id), order.indexOf(g1b.id));
		const out = { g2BeforeG1: g2max < g1min };
		rp.tabGroups.ungroup(g1.id); rp.tabGroups.ungroup(g2.id);
		g1a.detach(); g1b.detach(); g2a.detach(); g2b.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.g2BeforeG1, true, "the dragged group is placed before the group whose chip it was dropped on");
});

test("dropping a group's chip onto the middle of another group doesn't split it", async () => {
	// The reported bug: dragging a group into the middle of another split the
	// target. Drop targets snap to the target group's outer boundary, so a group
	// dropped anywhere on another lands before/after it as a whole — never inside.
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['sp-1.md','sp-2.md','sp-3.md','sp-4.md','sp-5.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('sp-1.md'), b = await open('sp-2.md'), c = await open('sp-3.md'), d = await open('sp-4.md'), e = await open('sp-5.md');
		await new Promise(r => setTimeout(r, 150));
		const g1 = rp.tabGroups.createGroup([a.id, b.id, c.id]); // 3-tab target
		const g2 = rp.tabGroups.createGroup([d.id, e.id]);
		await new Promise(r => setTimeout(r, 150));
		const strip = a.tabHeaderEl.parentElement;
		const orderIds = () => [...strip.querySelectorAll(':scope > .workspace-tab-header')].map(h => {
			let id = null; app.workspace.iterateAllLeaves(l => { if (l.tabHeaderEl === h) id = l.id; }); return id;
		});
		const chip2 = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + g2.id + '"]');
		const dt = new DataTransfer();
		chip2.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		// Drop on the LEFT half of g1's MIDDLE member (b) → snaps to before g1.
		const rect = b.tabHeaderEl.getBoundingClientRect();
		const at = { bubbles: true, dataTransfer: dt, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 };
		b.tabHeaderEl.dispatchEvent(new DragEvent('dragover', at));
		b.tabHeaderEl.dispatchEvent(new DragEvent('drop', at));
		chip2.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		await new Promise(r => setTimeout(r, 300));
		const order = orderIds();
		const gg1 = rp.tabGroups.getGroups().find(x => x.id === g1.id) || { memberIds: [] };
		const gg2 = rp.tabGroups.getGroups().find(x => x.id === g2.id) || { memberIds: [] };
		const p1 = gg1.memberIds.map(id => order.indexOf(id));
		const p2 = gg2.memberIds.map(id => order.indexOf(id));
		const contiguous = (ps) => { const s = [...ps].sort((x, y) => x - y); return s[s.length - 1] - s[0] === s.length - 1; };
		const out = {
			g1Count: gg1.memberIds.length,
			g2Count: gg2.memberIds.length,
			g1Contiguous: contiguous(p1),
			g2Contiguous: contiguous(p2),
			disjoint: Math.max(...p2) < Math.min(...p1) || Math.min(...p2) > Math.max(...p1),
		};
		rp.tabGroups.ungroup(g1.id); rp.tabGroups.ungroup(g2.id);
		a.detach(); b.detach(); c.detach(); d.detach(); e.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.g1Count, 3, "the target group keeps all three members");
	assert.equal(r.g2Count, 2, "the dragged group keeps its members");
	assert.equal(r.g1Contiguous, true, "the target group is not split");
	assert.equal(r.g2Contiguous, true, "the dragged group stays contiguous");
	assert.equal(r.disjoint, true, "the two groups don't interleave");
});

test("dragging a group past another reorders as blocks, never splitting it", async () => {
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['bl-1.md','bl-2.md','bl-3.md','bl-4.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('bl-1.md'), b = await open('bl-2.md'), c = await open('bl-3.md'), d = await open('bl-4.md');
		await new Promise(r => setTimeout(r, 150));
		const g1 = rp.tabGroups.createGroup([a.id, b.id]);
		const g2 = rp.tabGroups.createGroup([c.id, d.id]);
		await new Promise(r => setTimeout(r, 150));
		const strip = a.tabHeaderEl.parentElement;
		const orderIds = () => [...strip.querySelectorAll(':scope > .workspace-tab-header')].map(h => {
			let id = null; app.workspace.iterateAllLeaves(l => { if (l.tabHeaderEl === h) id = l.id; }); return id;
		});
		// Drop g1 on the RIGHT half of g2's chip => g1 lands after the whole of g2.
		const chip2 = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + g2.id + '"]');
		const chip1 = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + g1.id + '"]');
		const dt = new DataTransfer();
		chip1.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		const rect = chip2.getBoundingClientRect();
		const at = { bubbles: true, dataTransfer: dt, clientX: rect.right - 2, clientY: rect.top + rect.height / 2 };
		chip2.dispatchEvent(new DragEvent('dragover', at));
		chip2.dispatchEvent(new DragEvent('drop', at));
		chip1.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		await new Promise(r => setTimeout(r, 300));
		const order = orderIds();
		const gg1 = rp.tabGroups.getGroups().find(x => x.id === g1.id) || { memberIds: [] };
		const gg2 = rp.tabGroups.getGroups().find(x => x.id === g2.id) || { memberIds: [] };
		const pa = order.indexOf(a.id), pb = order.indexOf(b.id), pc = order.indexOf(c.id), pd = order.indexOf(d.id);
		const out = {
			g1Count: gg1.memberIds.length,
			g2Count: gg2.memberIds.length,
			g1Contiguous: Math.abs(pa - pb) === 1,
			g2Contiguous: Math.abs(pc - pd) === 1,
			g1AfterG2: Math.min(pa, pb) > Math.max(pc, pd),
		};
		rp.tabGroups.ungroup(g1.id); rp.tabGroups.ungroup(g2.id);
		a.detach(); b.detach(); c.detach(); d.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.g1Count, 2, "the dragged group keeps both members");
	assert.equal(r.g2Count, 2, "the group dragged past is left whole (not split)");
	assert.equal(r.g1Contiguous, true, "the dragged group stays contiguous");
	assert.equal(r.g2Contiguous, true, "the other group stays contiguous");
	assert.equal(r.g1AfterG2, true, "the dragged group moved entirely past the other");
});

test("dragging a single-tab group onto another does not merge it in", async () => {
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['sg-1.md','sg-2.md','sg-3.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('sg-1.md'), b = await open('sg-2.md'), s = await open('sg-3.md');
		await new Promise(r => setTimeout(r, 150));
		const g1 = rp.tabGroups.createGroup([a.id, b.id]);
		const gS = rp.tabGroups.createGroup([s.id]);
		await new Promise(r => setTimeout(r, 150));
		const strip = a.tabHeaderEl.parentElement;
		const chip1 = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + g1.id + '"]');
		const chipS = strip.querySelector('.real-pin-group-chip[data-rp-group-id="' + gS.id + '"]');
		const dt = new DataTransfer();
		chipS.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		const rect = chip1.getBoundingClientRect();
		const at = { bubbles: true, dataTransfer: dt, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 };
		chip1.dispatchEvent(new DragEvent('dragover', at));
		chip1.dispatchEvent(new DragEvent('drop', at));
		chipS.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		await new Promise(r => setTimeout(r, 300));
		const gg1 = rp.tabGroups.getGroups().find(x => x.id === g1.id) || { memberIds: [] };
		const ggS = rp.tabGroups.getGroups().find(x => x.id === gS.id) || { memberIds: [] };
		const out = {
			g1Members: gg1.memberIds.length,
			sStillOwnGroup: ggS.memberIds.length === 1 && ggS.memberIds[0] === s.id,
			sNotInG1: !gg1.memberIds.includes(s.id),
		};
		rp.tabGroups.ungroup(g1.id); rp.tabGroups.ungroup(gS.id);
		a.detach(); b.detach(); s.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.g1Members, 2, "the target group keeps exactly its own members");
	assert.equal(r.sStillOwnGroup, true, "the single tab stays its own group");
	assert.equal(r.sNotInG1, true, "the single tab did not merge into the target group");
});

test("focusing a tab expands its collapsed group", async () => {
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['fx-1.md','fx-2.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('fx-1.md'), b = await open('fx-2.md');
		await new Promise(r => setTimeout(r, 150));
		const g = rp.tabGroups.createGroup([a.id, b.id]);
		rp.tabGroups.toggleCollapse(g.id);
		await new Promise(r => setTimeout(r, 150));
		const collapsedBefore = (rp.tabGroups.getGroups().find(x => x.id === g.id) || {}).collapsed;
		const hiddenBefore = getComputedStyle(a.tabHeaderEl).display === 'none';
		app.workspace.setActiveLeaf(a, { focus: true });
		await new Promise(r => setTimeout(r, 250));
		const collapsedAfter = (rp.tabGroups.getGroups().find(x => x.id === g.id) || {}).collapsed;
		const hiddenAfter = getComputedStyle(a.tabHeaderEl).display === 'none';
		const out = { collapsedBefore, hiddenBefore, collapsedAfter, hiddenAfter };
		rp.tabGroups.ungroup(g.id);
		a.detach(); b.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.collapsedBefore, true, "the group starts collapsed");
	assert.equal(r.hiddenBefore, true, "its members start hidden");
	assert.equal(r.collapsedAfter, false, "focusing a member expands the group");
	assert.equal(r.hiddenAfter, false, "the focused member becomes visible again");
});

test("closing a group's last tab removes the group", async () => {
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['ce-1.md','ce-2.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const e1 = await open('ce-1.md'), e2 = await open('ce-2.md');
		await new Promise(r => setTimeout(r, 150));
		const g = rp.tabGroups.createGroup([e1.id, e2.id]);
		await new Promise(r => setTimeout(r, 150));
		const has = () => !!rp.tabGroups.getGroups().find(x => x.id === g.id);
		const existsBefore = has();
		e1.detach();
		await new Promise(r => setTimeout(r, 250));
		const afterOne = has();
		e2.detach();
		await new Promise(r => setTimeout(r, 350));
		const afterBoth = has();
		return { existsBefore, afterOne, afterBoth };
	`);
	assert.equal(r.existsBefore, true, "the group exists while its tabs are open");
	assert.equal(r.afterOne, true, "closing one of two tabs keeps the group");
	assert.equal(r.afterBoth, false, "closing the last tab removes the group entirely");
});

test("dropping a tab at a group's edge leaves it ungrouped (only between-tabs joins)", async () => {
	// Predictable membership: a tab joins only when dropped *between* a group's
	// tabs. Landing at the group's outer edge stays ungrouped. We simulate the
	// native reorder with the same internal ops a drag performs.
	const r = await obs.evalInApp(`
		const app = window.app;
		const rp = app.plugins.plugins['real-pin'];
		const ensure = async (p) => app.vault.getAbstractFileByPath(p) || await app.vault.create(p, '# ' + p);
		for (const p of ['ed-1.md','ed-2.md','ed-3.md']) await ensure(p);
		const open = async (p) => { const l = app.workspace.getLeaf('tab'); await l.openFile(app.vault.getAbstractFileByPath(p)); return l; };
		const a = await open('ed-1.md'), b = await open('ed-2.md'), x = await open('ed-3.md');
		await new Promise(r => setTimeout(r, 150));
		const g = rp.tabGroups.createGroup([a.id, b.id]); // order: a, b, x
		await new Promise(r => setTimeout(r, 150));
		const parent = a.parent;
		const strip = a.tabHeaderEl.parentElement;
		const idxOf = (leaf) => [...strip.querySelectorAll(':scope > .workspace-tab-header')].indexOf(leaf.tabHeaderEl);
		// Move x to the group's left edge: just before a (NOT between a and b).
		parent.removeChild(x);
		parent.insertChild(idxOf(a), x);
		await new Promise(r => setTimeout(r, 300));
		const out = { xGroup: x.tabHeaderEl.dataset.rpGroup || null };
		rp.tabGroups.ungroup(g.id);
		a.detach(); b.detach(); x.detach();
		await new Promise(r => setTimeout(r, 100));
		return out;
	`);
	assert.equal(r.xGroup, null, "a tab dropped at the group's edge is not absorbed");
});

test("clicking the chip collapses/expands — even after a re-render", async () => {
	// Regression guard: Obsidian re-renders the strip by cloning its children,
	// which drops a chip's per-element listeners. We force a re-render (activate
	// a member), then drive collapse by *clicking the chip element* (not the API)
	// and assert there's exactly one chip and the click works.
	const r = await obs.evalInApp(`
		const app = window.app;
		const { a } = window.__tg;
		app.workspace.setActiveLeaf(a, { focus: true });
		await new Promise(r => setTimeout(r, 220));
		const strip = a.tabHeaderEl.parentElement;
		const disp = () => getComputedStyle(a.tabHeaderEl).display;
		const press = () => strip.querySelector('.real-pin-group-chip').click();
		const before = disp();
		press();
		await new Promise(r => setTimeout(r, 200));
		const collapsed = disp();
		const chip = strip.querySelector('.real-pin-group-chip');
		const chipCount = strip.querySelectorAll('.real-pin-group-chip').length;
		const chipVisible = getComputedStyle(chip).display !== 'none';
		const chipCollapsedAttr = chip.dataset.rpCollapsed || null;
		press();
		await new Promise(r => setTimeout(r, 200));
		const expanded = disp();
		return { before, collapsed, expanded, chipCount, chipVisible, chipCollapsedAttr };
	`);
	assert.notEqual(r.before, "none", "starts expanded");
	assert.equal(r.collapsed, "none", "clicking the chip hides members");
	assert.equal(r.chipVisible, true, "chip stays visible while collapsed");
	assert.equal(r.chipCollapsedAttr, "1", "chip marked collapsed (drives inverted styling)");
	assert.equal(r.chipCount, 1, "no duplicate (cloned) chip remains");
	assert.notEqual(r.expanded, "none", "clicking again expands");
});

test("dragging an ungrouped tab into the group's run joins it", async () => {
	// Simulate Obsidian's native reorder: move c between a and b using the same
	// internal WorkspaceTabs ops a drag performs. The controller's observer then
	// reconciles membership from the new order.
	const r = await obs.evalInApp(`
		const { a, b, c, rp, groupId } = window.__tg;
		const parent = a.parent;
		const strip = a.tabHeaderEl.parentElement;
		const idxOf = (leaf) => [...strip.querySelectorAll(':scope > .workspace-tab-header')].indexOf(leaf.tabHeaderEl);
		parent.removeChild(c);
		parent.insertChild(idxOf(b), c); // drop c just before b => inside the a..b run
		await new Promise(r => setTimeout(r, 300));
		return { joined: c.tabHeaderEl.dataset.rpGroup === groupId };
	`);
	assert.equal(r.joined, true, "c joined the group after landing inside its run");
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
