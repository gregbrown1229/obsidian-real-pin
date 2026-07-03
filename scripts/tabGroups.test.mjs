// Unit tests for the pure tab-group decision core (src/tabGroups/model.ts).
// Run via `node --test` (Node ≥ 22.18 strips the TS types on import). These
// cover the membership-reconcile rules that drive drag-to-group, plus naming,
// positions, serialization, and the data migration — the logic that must be
// correct independent of Obsidian.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	GROUP_COLORS,
	isGroupColor,
	posFor,
	nextGroupName,
	memberFromViewState,
	findMovedId,
	groupForMoved,
	reconcile,
	migrateData,
	SCHEMA_VERSION,
} from "../src/tabGroups/model.ts";

/** Build a TabGroup tersely. */
const group = (id, memberIds, extra = {}) => ({
	id,
	name: id,
	color: "blue",
	collapsed: false,
	memberIds,
	...extra,
});

test("GROUP_COLORS has the nine Chrome colors and isGroupColor guards them", () => {
	assert.equal(GROUP_COLORS.length, 9);
	assert.ok(isGroupColor("blue"));
	assert.ok(!isGroupColor("chartreuse"));
	assert.ok(!isGroupColor(42));
});

test("posFor classifies run position", () => {
	assert.equal(posFor(0, 1), "solo");
	assert.equal(posFor(0, 3), "first");
	assert.equal(posFor(1, 3), "mid");
	assert.equal(posFor(2, 3), "last");
});

test("nextGroupName picks the lowest unused Group N", () => {
	assert.equal(nextGroupName([]), "Group 1");
	assert.equal(nextGroupName(["Group 1"]), "Group 2");
	assert.equal(nextGroupName(["Group 2"]), "Group 1");
	assert.equal(nextGroupName(["Group 1", "Group 3"]), "Group 2");
});

test("memberFromViewState keeps only type+state and the pin flag", () => {
	const m = memberFromViewState(
		{ type: "markdown", state: { file: "a.md", mode: "source" }, active: true },
		true,
	);
	assert.deepEqual(m, {
		viewState: { type: "markdown", state: { file: "a.md", mode: "source" } },
		pinned: true,
	});
});

test("findMovedId detects a single move and rejects non-moves", () => {
	assert.equal(findMovedId(["a", "b", "c"], ["a", "b", "c"]), null);
	// an adjacent swap is genuinely ambiguous: either swapped id is valid
	assert.ok(["a", "b"].includes(findMovedId(["a", "b", "c"], ["b", "a", "c"])));
	// a non-adjacent move is unambiguous
	assert.equal(findMovedId(["a", "b", "c", "d"], ["b", "c", "d", "a"]), "a");
	// length change (open/close) is not a move
	assert.equal(findMovedId(["a", "b"], ["a", "b", "c"]), null);
});

test("groupForMoved: inside a uniform region joins it", () => {
	assert.equal(groupForMoved("G", "G", undefined), "G"); // dropped inside group G
	assert.equal(groupForMoved(undefined, undefined, "G"), undefined); // open space
});

test("groupForMoved: at a boundary, stay only if still touching own group", () => {
	// reorder to a group's own edge (left edge of G, right neighbor is G)
	assert.equal(groupForMoved(undefined, "G", "G"), "G");
	// boundary into a foreign edge → ungroup (use explicit add instead)
	assert.equal(groupForMoved(undefined, "H", "G"), undefined);
	assert.equal(groupForMoved("G", "H", undefined), undefined);
});

test("reconcile: dragging an ungrouped tab inside a group joins it", () => {
	const groups = [group("G", ["a", "c"])];
	const r = reconcile(groups, ["a", "c", "x"], ["a", "x", "c"]);
	assert.deepEqual(r.groups[0].memberIds, ["a", "x", "c"]);
	assert.deepEqual(r.ungrouped, []);
});

test("reconcile: dragging a member out of the group removes it", () => {
	const groups = [group("G", ["a", "b", "c"])];
	// move b to the end, next to ungrouped x → both neighbors ungrouped
	const r = reconcile(groups, ["a", "b", "c", "x"], ["a", "c", "x", "b"]);
	assert.deepEqual(r.groups[0].memberIds, ["a", "c"]);
	assert.deepEqual(r.ungrouped, ["x", "b"]);
});

test("reconcile: reordering a member to its own group's front keeps it", () => {
	const groups = [group("G", ["a", "b", "c"])];
	const r = reconcile(groups, ["a", "b", "c"], ["c", "a", "b"]);
	assert.deepEqual(r.groups[0].memberIds, ["c", "a", "b"]);
});

test("reconcile: dragging a member into another group switches it", () => {
	const groups = [group("G", ["a", "b"]), group("H", ["d", "e"])];
	// move a between d and e
	const r = reconcile(groups, ["a", "b", "d", "e"], ["b", "d", "a", "e"]);
	const G = r.groups.find((g) => g.id === "G");
	const H = r.groups.find((g) => g.id === "H");
	assert.deepEqual(G.memberIds, ["b"]);
	assert.deepEqual(H.memberIds, ["d", "a", "e"]);
});

test("reconcile: dragging a tab into a group's interior wins the swap", () => {
	// [a(G), d(H), e(H)] -> [d, a, e]: a lands between d and e. The adjacent
	// swap is ambiguous, but joining H must beat 'd left H'.
	const groups = [group("G", ["a"]), group("H", ["d", "e"])];
	const r = reconcile(groups, ["a", "d", "e"], ["d", "a", "e"]);
	const H = r.groups.find((g) => g.id === "H");
	assert.equal(r.groups.find((g) => g.id === "G"), undefined); // G emptied
	assert.deepEqual(H.memberIds, ["d", "a", "e"]);
});

test("reconcile: dragging a one-tab group's only member keeps the group", () => {
	const groups = [group("G", ["a"])];
	const r = reconcile(groups, ["a", "x"], ["x", "a"]);
	assert.equal(r.groups.length, 1);
	assert.deepEqual(r.groups[0].memberIds, ["a"]);
	assert.deepEqual(r.ungrouped, ["x"]);
});

test("reconcile: opening a new tab leaves it ungrouped, group intact", () => {
	const groups = [group("G", ["a", "b"])];
	const r = reconcile(groups, ["a", "b"], ["a", "b", "new"]);
	assert.deepEqual(r.groups[0].memberIds, ["a", "b"]);
	assert.deepEqual(r.ungrouped, ["new"]);
});

test("reconcile: closing a tab drops it; an emptied group disappears", () => {
	const groups = [group("G", ["a"]), group("H", ["d", "e"])];
	const r = reconcile(groups, ["a", "d", "e"], ["d", "e"]);
	assert.equal(r.groups.length, 1);
	assert.equal(r.groups[0].id, "H");
	assert.deepEqual(r.groups[0].memberIds, ["d", "e"]);
});

test("reconcile: a pure refresh (no change) preserves groups and order", () => {
	const groups = [group("G", ["a", "b"])];
	const r = reconcile(groups, ["a", "b", "x"], ["a", "b", "x"]);
	assert.deepEqual(r.groups[0].memberIds, ["a", "b"]);
	assert.deepEqual(r.ungrouped, ["x"]);
});

test("migrateData: null yields a fresh v2 document", () => {
	const d = migrateData(null, { confirmBeforeClose: true });
	assert.equal(d.schemaVersion, SCHEMA_VERSION);
	assert.deepEqual(d.settings, { confirmBeforeClose: true });
	assert.deepEqual(d.savedGroups, []);
	assert.deepEqual(d.liveGroups, []);
});

test("migrateData: legacy flat settings are wrapped and preserved", () => {
	const legacy = { confirmBeforeClose: false, compactPinnedTabs: true };
	const d = migrateData(legacy, {
		confirmBeforeClose: true,
		compactPinnedTabs: false,
		compactTabWidth: 72,
	});
	assert.equal(d.schemaVersion, SCHEMA_VERSION);
	assert.equal(d.settings.confirmBeforeClose, false);
	assert.equal(d.settings.compactPinnedTabs, true);
	assert.equal(d.settings.compactTabWidth, 72); // default filled in
	assert.deepEqual(d.savedGroups, []);
});

test("migrateData: an existing v2 document is preserved with defaults filled", () => {
	const existing = {
		schemaVersion: SCHEMA_VERSION,
		settings: { confirmBeforeClose: false },
		savedGroups: [{ id: "s1" }],
		liveGroups: [{ id: "g1" }],
	};
	const d = migrateData(existing, { confirmBeforeClose: true, extra: 1 });
	assert.equal(d.settings.confirmBeforeClose, false);
	assert.equal(d.settings.extra, 1);
	assert.equal(d.savedGroups.length, 1);
	assert.equal(d.liveGroups.length, 1);
});
