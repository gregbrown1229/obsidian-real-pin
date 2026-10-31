import type { WorkspaceLeaf, WorkspaceParent } from "obsidian";

/**
 * The few `WorkspaceTabs` internals we use to reorder tabs (validated by spike
 * S7). Not on the public type surface, so they're modelled narrowly here and
 * every caller degrades to inert when they're absent.
 */
export type TabsInternal = WorkspaceParent & {
	children?: WorkspaceLeaf[];
	currentTab?: number;
	removeChild?(leaf: WorkspaceLeaf): void;
	insertChild?(index: number, leaf: WorkspaceLeaf): void;
	selectTab?(leaf: WorkspaceLeaf): void;
};

/** Whether a tab is pinned, via the public view-state accessor. */
export const isPinned = (leaf: WorkspaceLeaf): boolean =>
	leaf.getViewState().pinned === true;

/**
 * Move an existing leaf to `index` within its tab strip, if the internals exist.
 * `index` is the leaf's position after the move (remove-then-insert semantics).
 *
 * `insertChild` doesn't keep the strip's `currentTab` index in step, so a move at
 * or left of the shown tab would silently switch which tab is displayed. We
 * capture the shown tab first and re-select it afterwards. `selectTab` only
 * changes which tab its own strip shows; it doesn't move workspace focus.
 */
export function moveLeafToIndex(leaf: WorkspaceLeaf, index: number): boolean {
	const parent = leaf.parent as TabsInternal;
	if (typeof parent.removeChild !== "function" || typeof parent.insertChild !== "function") {
		return false;
	}
	const shown =
		parent.currentTab !== undefined ? parent.children?.[parent.currentTab] : undefined;
	parent.removeChild(leaf);
	parent.insertChild(index, leaf);
	if (
		shown &&
		typeof parent.selectTab === "function" &&
		parent.currentTab !== undefined &&
		parent.children?.[parent.currentTab] !== shown
	) {
		parent.selectTab(shown);
	}
	return true;
}
