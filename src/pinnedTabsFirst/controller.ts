import type { EventRef, WorkspaceLeaf } from "obsidian";
import type RealPinPlugin from "../main";
import { isPinned, moveLeafToIndex } from "../workspaceTabs";
import type { TabsInternal } from "../workspaceTabs";
import { pinnedFirstOrder, planMoves } from "./model";

/**
 * Drives "Keep pinned tabs first": every main-area tab strip (each split, and
 * popout windows; never the sidebars) keeps its pinned tabs before all others,
 * like Chrome.
 *
 * It's an idempotent sort, run on `layout-change` (which Obsidian fires when a
 * tab is opened, closed, or dragged) and on each tab's `pinned-change` (pinning
 * fires only that per-leaf event, not `layout-change`). We don't intercept the
 * native drag; a drop across the pinned boundary is simply snapped back by the
 * next sort. The decision (a stable partition) lives in the pure `model.ts`; this
 * class only reads each strip's tabs and applies the planned moves.
 *
 * Turning the setting off just stops enforcing. Tab order is the user's layout,
 * not plugin decoration, so there's nothing to revert.
 */
export class PinnedTabsFirst {
	private readonly plugin: RealPinPlugin;
	/** Tabs whose `pinned-change` we listen to, so each can be released. */
	private readonly watched = new Map<WorkspaceLeaf, EventRef>();

	constructor(plugin: RealPinPlugin) {
		this.plugin = plugin;
	}

	/** Sort now, then on every layout / pin change. Unwinds on unload. */
	start(): void {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("layout-change", () => this.apply()),
		);
		this.plugin.register(() => this.unwatchAll());
		this.apply();
	}

	/**
	 * Re-sort every main-area strip if the setting is on, and watch any tab not
	 * yet watched. Idempotent: our own moves fire a (debounced, async)
	 * `layout-change`, whose re-run is a no-op.
	 */
	apply(): void {
		if (!this.plugin.settings.pinnedTabsFirst) return;
		for (const strip of this.strips()) {
			this.sortStrip(strip);
			strip.children?.forEach((leaf) => this.watch(leaf));
		}
		this.pruneWatched();
	}

	private onPinnedChange(): void {
		if (!this.plugin.settings.pinnedTabsFirst) return;
		this.apply();
		// Pinned tabs can't be grouped; a pin that needs no move fires no
		// `layout-change`, so tell tab groups directly.
		this.plugin.tabGroups.apply();
	}

	private watch(leaf: WorkspaceLeaf): void {
		if (this.watched.has(leaf)) return;
		this.watched.set(leaf, leaf.on("pinned-change", () => this.onPinnedChange()));
	}

	/** Release closed tabs (a detached leaf has no parent). */
	private pruneWatched(): void {
		for (const [leaf, ref] of this.watched) {
			if (leaf.parent) continue;
			leaf.offref(ref);
			this.watched.delete(leaf);
		}
	}

	private unwatchAll(): void {
		for (const [leaf, ref] of this.watched) leaf.offref(ref);
		this.watched.clear();
	}

	private sortStrip(strip: TabsInternal): void {
		// `children` is the strip's complete, synchronously-updated tab model,
		// including deferred (background) tabs; the DOM lags behind it.
		const children = strip.children;
		if (!children) return;
		const moves = planMoves(children, pinnedFirstOrder(children, isPinned));
		for (const { item, to } of moves) {
			if (!moveLeafToIndex(item, to)) return; // internals absent → inert
		}
	}

	/**
	 * Every main-area tab strip. `iterateAllLeaves` can omit deferred tabs, but
	 * here it only has to reach one tab per strip: each strip's own `children`
	 * supplies the complete list we sort.
	 */
	private strips(): Set<TabsInternal> {
		const ws = this.plugin.app.workspace;
		const strips = new Set<TabsInternal>();
		ws.iterateAllLeaves((leaf) => {
			const root = leaf.getRoot();
			if (root === ws.leftSplit || root === ws.rightSplit) return;
			const parent = leaf.parent as TabsInternal | null;
			if (parent && Array.isArray(parent.children)) strips.add(parent);
		});
		return strips;
	}
}
