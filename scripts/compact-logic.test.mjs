import { test } from "node:test";
import assert from "node:assert/strict";
// Imports the real predicate straight from the TypeScript source via Node's
// native type-stripping (on by default in Node >= 22.18 and Node 24, which CI
// uses). `compactPolicy.ts` is erasable-syntax-only, so the strip is valid and
// the tested logic is exactly the shipped logic.
import {
	COMPACT_MARKER,
	SHRINK_ALL_PINNED,
	shouldCompact,
} from "../src/compactPolicy.ts";

test("pinned with an assigned icon compacts", () => {
	assert.equal(
		shouldCompact({ pinned: true, hasIcon: true, shrinkAll: false }),
		true,
	);
});

test("pinned without an icon stays full-size (the default)", () => {
	assert.equal(
		shouldCompact({ pinned: true, hasIcon: false, shrinkAll: false }),
		false,
	);
});

test("pinned without an icon compacts when shrinkAll is on", () => {
	assert.equal(
		shouldCompact({ pinned: true, hasIcon: false, shrinkAll: true }),
		true,
	);
});

test("an unpinned tab never compacts, regardless of icon or shrinkAll", () => {
	assert.equal(
		shouldCompact({ pinned: false, hasIcon: true, shrinkAll: false }),
		false,
	);
	assert.equal(
		shouldCompact({ pinned: false, hasIcon: true, shrinkAll: true }),
		false,
	);
	assert.equal(
		shouldCompact({ pinned: false, hasIcon: false, shrinkAll: true }),
		false,
	);
});

test("exported constants hold the expected defaults", () => {
	assert.equal(COMPACT_MARKER, "real-pin-compact-tab");
	assert.equal(SHRINK_ALL_PINNED, false);
});
