/**
 * Pure, Obsidian-free policy for the "compact pinned tabs" feature.
 *
 * Kept free of any `obsidian` import (and of any non-erasable TypeScript syntax)
 * so it can be unit-tested directly under `node --test` via Node's native
 * type-stripping — see `scripts/compact-logic.test.mjs`. The controller in
 * `compactPinnedTabs.ts` imports the same predicate, so the tested logic is the
 * shipped logic.
 */

/** Marker class the controller toggles on a leaf's tab header element. */
export const COMPACT_MARKER = "real-pin-compact-tab";

/**
 * When `true`, every pinned tab compacts regardless of whether it has an icon.
 * Default `false`: only pinned tabs with an assigned Iconize icon shrink, so
 * icon-less pinned tabs keep their title and stay distinguishable. Flipping this
 * one constant turns the feature into "shrink all pinned".
 */
export const SHRINK_ALL_PINNED = false;

/**
 * Decide whether a tab should be compacted. A tab compacts only when it is
 * pinned and either we're shrinking all pinned tabs or it has an assigned icon.
 */
export function shouldCompact(o: {
	pinned: boolean;
	hasIcon: boolean;
	shrinkAll: boolean;
}): boolean {
	return o.pinned && (o.shrinkAll || o.hasIcon);
}
