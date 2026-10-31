// Unit tests for the pure "Keep pinned tabs first" decision core
// (src/pinnedTabsFirst/model.ts). Run via `node --test` (Node ≥ 22.18 strips the
// TS types on import). Tabs are modelled as strings; an uppercase "P" prefix
// means pinned. These pin down the Chrome semantics — pin → end of the pinned
// block, unpin → first unpinned, drag across the boundary → snap back — and that
// the planned moves, applied as a tab strip applies them, produce that order.
import { test } from "node:test";
import assert from "node:assert/strict";

import { pinnedFirstOrder, planMoves } from "../src/pinnedTabsFirst/model.ts";

const isPinned = (t) => t.startsWith("P");
const sort = (tabs) => pinnedFirstOrder(tabs, isPinned);

/** Apply moves the way a tab strip does: remove, then insert at `to`. */
const applyMoves = (tabs, moves) => {
	const work = tabs.slice();
	for (const { item, to } of moves) {
		work.splice(work.indexOf(item), 1);
		work.splice(to, 0, item);
	}
	return work;
};

test("pinnedFirstOrder is a stable partition: pinned first, order kept", () => {
	assert.deepEqual(sort(["a", "P1", "b", "P2", "c"]), ["P1", "P2", "a", "b", "c"]);
	assert.deepEqual(sort(["P2", "P1", "b", "a"]), ["P2", "P1", "b", "a"]);
});

test("pinnedFirstOrder handles empty / all-pinned / none-pinned strips", () => {
	assert.deepEqual(sort([]), []);
	assert.deepEqual(sort(["P1", "P2"]), ["P1", "P2"]);
	assert.deepEqual(sort(["a", "b"]), ["a", "b"]);
});

test("pinnedFirstOrder doesn't mutate its input", () => {
	const tabs = ["a", "P1"];
	sort(tabs);
	assert.deepEqual(tabs, ["a", "P1"]);
});

test("pinning a tab moves it to the end of the pinned block (Chrome)", () => {
	// "c" was just pinned (now "Pc"), sitting among the unpinned tabs.
	assert.deepEqual(sort(["P1", "P2", "a", "b", "Pc", "d"]), [
		"P1", "P2", "Pc", "a", "b", "d",
	]);
});

test("unpinning a tab moves it first among the unpinned tabs (Chrome)", () => {
	// "P1" was just unpinned (now "x"), sitting inside the pinned block.
	assert.deepEqual(sort(["x", "P2", "P3", "a", "b"]), ["P2", "P3", "x", "a", "b"]);
});

test("a drag across the boundary snaps back to the boundary", () => {
	// Unpinned "a" dropped among the pinned tabs → first unpinned.
	assert.deepEqual(sort(["P1", "a", "P2", "b"]), ["P1", "P2", "a", "b"]);
	// Pinned "P1" dropped among the unpinned tabs → last pinned.
	assert.deepEqual(sort(["P2", "a", "b", "P1", "c"]), ["P2", "P1", "a", "b", "c"]);
});

test("planMoves is empty when the strip is already in order", () => {
	const tabs = ["P1", "P2", "a", "b"];
	assert.deepEqual(planMoves(tabs, sort(tabs)), []);
	assert.deepEqual(planMoves([], []), []);
});

test("a single pin / unpin / snap-back is one move", () => {
	// Where only one tab can move in one step, it's that tab.
	for (const [tabs, mover] of [
		[["P1", "a", "b", "Pc"], "Pc"], // pinned "c" at the far end
		[["x", "P2", "P3", "a"], "x"], // unpinned the first pinned tab
		[["P2", "a", "b", "P1"], "P1"], // pinned tab dragged to the far end
	]) {
		const moves = planMoves(tabs, sort(tabs));
		assert.deepEqual(moves.map((m) => m.item), [mover], tabs.join(","));
		assert.deepEqual(applyMoves(tabs, moves), sort(tabs));
	}
	// Where the changed tab is adjacent to the boundary, moving it or its
	// neighbor gives the same order in one move; either is fine.
	for (const tabs of [
		["P1", "P2", "a", "Pb", "c"], // pinned "b" just past the boundary
		["P1", "a", "P2", "b"], // unpinned "a" dropped inside the pinned block
	]) {
		const moves = planMoves(tabs, sort(tabs));
		assert.equal(moves.length, 1, tabs.join(","));
		assert.deepEqual(applyMoves(tabs, moves), sort(tabs));
	}
});

test("planMoves reaches the target for arbitrary orders (exhaustive, n ≤ 6)", () => {
	// Every pin pattern over every permutation of up to six tabs.
	const permutations = (xs) =>
		xs.length <= 1
			? [xs]
			: xs.flatMap((x, i) =>
					permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
				);
	for (let n = 0; n <= 6; n++) {
		for (let mask = 0; mask < 1 << n; mask++) {
			const base = Array.from({ length: n }, (_, i) =>
				mask & (1 << i) ? `P${i}` : `u${i}`,
			);
			for (const tabs of n <= 4 ? permutations(base) : [base, base.slice().reverse()]) {
				const target = sort(tabs);
				const moves = planMoves(tabs, target);
				assert.deepEqual(applyMoves(tabs, moves), target, tabs.join(","));
				assert.ok(moves.length <= n, "never more moves than tabs");
			}
		}
	}
});

test("planMoves skips (doesn't throw on) a target that isn't a permutation", () => {
	assert.deepEqual(planMoves(["a", "b"], ["c", "a", "b"]), []);
});
