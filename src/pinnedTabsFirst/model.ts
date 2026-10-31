/**
 * Pure, `obsidian`-free decision core for "Keep pinned tabs first".
 *
 * Plain data + plain functions, unit-tested directly under `node --test` (Node
 * ≥ 22.18 strips the types). The controller only reads each strip's tabs, asks
 * this module for the moves, and applies them.
 *
 * One rule covers every case, Chrome-style: a **stable partition** — pinned tabs
 * first, each side keeping its relative order. Because the strip already
 * satisfies the rule before any single change, that one partition yields:
 *  - pin a tab → it lands at the end of the pinned block;
 *  - unpin a tab → it lands first among the unpinned tabs;
 *  - drag a tab across the boundary → it snaps back to the boundary;
 *  - reorder within either block → untouched.
 */

/** Stable partition: pinned tabs first, each side in its original order. */
export function pinnedFirstOrder<T>(
	tabs: readonly T[],
	isPinned: (tab: T) => boolean,
): T[] {
	const pinned: T[] = [];
	const unpinned: T[] = [];
	for (const tab of tabs) (isPinned(tab) ? pinned : unpinned).push(tab);
	return pinned.concat(unpinned);
}

/** One step: remove `item` from the list, then insert it at index `to`. */
export interface Move<T> {
	item: T;
	to: number;
}

/**
 * The fewest moves, applied in order, that turn `current` into `target` (the
 * same items, reordered). Each move is remove-then-insert, matching how a tab
 * strip reorders a child. Empty when already in order.
 *
 * Minimal: the longest run of items already in target order stays put, and only
 * the rest move — so a single pin, unpin, or drag snap-back is exactly one move
 * of one tab, never a shuffle of its neighbors.
 */
export function planMoves<T>(
	current: readonly T[],
	target: readonly T[],
): Move<T>[] {
	const kept = longestInOrder(target.map((item) => current.indexOf(item)));
	const work = current.slice();
	const moves: Move<T>[] = [];
	for (let i = 0; i < target.length; i++) {
		if (kept.has(i)) continue;
		const item = target[i];
		const from = work.indexOf(item);
		if (from < 0) continue; // not a permutation of `current`; skip, don't throw
		work.splice(from, 1);
		// Place it right after its target predecessor. Items are placed in target
		// order and kept items are already in order, so that predecessor is
		// always in its final relative position.
		const to = i === 0 ? 0 : work.indexOf(target[i - 1]) + 1;
		work.splice(to, 0, item);
		moves.push({ item, to });
	}
	return moves;
}

/**
 * Indices of a longest strictly-increasing subsequence of `seq` (negative values
 * — items missing from `current` — never qualify). O(n²), ample for a tab strip.
 */
function longestInOrder(seq: readonly number[]): Set<number> {
	const len: number[] = [];
	const prev: number[] = [];
	let best = -1;
	for (let i = 0; i < seq.length; i++) {
		len[i] = seq[i] < 0 ? 0 : 1;
		prev[i] = -1;
		if (seq[i] < 0) continue;
		for (let j = 0; j < i; j++) {
			if (seq[j] >= 0 && seq[j] < seq[i] && len[j] + 1 > len[i]) {
				len[i] = len[j] + 1;
				prev[i] = j;
			}
		}
		if (best < 0 || len[i] > len[best]) best = i;
	}
	const kept = new Set<number>();
	for (let i = best; i >= 0; i = prev[i]) kept.add(i);
	return kept;
}
