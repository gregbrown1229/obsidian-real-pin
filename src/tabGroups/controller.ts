import { Menu, Notice, View, WorkspaceLeaf, WorkspaceParent } from "obsidian";
import type RealPinPlugin from "../main";
import {
	GROUP_COLORS,
	groupOfMap,
	nextGroupName,
	reconcile as reconcileMembership,
} from "./model";
import type { GroupColor, GroupPos, TabGroup } from "./model";
import {
	TAB_GROUPS_CLASS,
	buildChip,
	clearHeaderAttrs,
	setHeaderAttrs,
	updateChip,
} from "./overlay";

/**
 * Obsidian models a leaf's stable id and its tab-header element, but neither is
 * on the public type surface. We reach them through a narrow cast (the repo's
 * e2e tests already rely on `tabHeaderEl`) and degrade to inert when absent.
 */
type LeafInternal = WorkspaceLeaf & {
	id: string;
	tabHeaderEl?: HTMLElement;
};

/** A few `WorkspaceTabs` internals, validated by spike S7. Used guardedly. */
type TabsInternal = WorkspaceParent & {
	removeChild?(leaf: WorkspaceLeaf): void;
	insertChild?(index: number, leaf: WorkspaceLeaf): void;
};

const id = (leaf: WorkspaceLeaf): string => (leaf as LeafInternal).id;
const headerEl = (leaf: WorkspaceLeaf): HTMLElement | undefined =>
	(leaf as LeafInternal).tabHeaderEl;

/**
 * Drives Chrome-style tab groups rendered inside the single horizontal tab bar.
 *
 * Design (validated by the Plan 0 spikes): we never reimplement drag or patch
 * Obsidian's layout engine. We keep an explicit, leaf-id-keyed group model and
 * an **idempotent reconcile** that (1) reads each tab strip's order from the
 * DOM, (2) infers membership changes from native reorders via the pure
 * `reconcile` in `model.ts`, and (3) reflects the result as `data-*` attributes
 * on tab headers plus a chip element per group — CSS does the rest. Reconcile is
 * driven by `layout-change` / `active-leaf-change` and a `MutationObserver` on
 * each strip; observers are disconnected while we mutate so we never feed back.
 * Everything reverts on `clear()` (unload, or the feature toggled off).
 */
export class TabGroupController {
	private readonly plugin: RealPinPlugin;

	/** Live groups (source of truth this session). Each group is within one strip. */
	private groups: TabGroup[] = [];
	/** groupId → chip element (for placement + teardown). */
	private readonly chips = new Map<string, HTMLElement>();
	/** Headers we've tagged, so we can clear stragglers (e.g. moved to a sidebar). */
	private tagged = new Set<HTMLElement>();
	/** Last reconciled strip order per container, to detect a drag. */
	private prevOrder = new Map<WorkspaceParent, string[]>();
	private observers: MutationObserver[] = [];
	private scheduled: number | null = null;

	constructor(plugin: RealPinPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		const ws = this.plugin.app.workspace;
		this.plugin.registerEvent(ws.on("layout-change", () => this.schedule()));
		this.plugin.registerEvent(ws.on("active-leaf-change", () => this.schedule()));
		this.plugin.registerEvent(ws.on("window-open", () => this.schedule()));
		this.plugin.register(() => this.clear());
		this.reconcile();
	}

	/** Re-sync to the current settings (called from the settings toggle). */
	apply(): void {
		if (this.plugin.settings.enableTabGroups) this.reconcile();
		else this.clear();
	}

	// --- public group operations (commands / chip menu / tests) -------------

	/** Group the given leaves into a new live group. Returns it, or null. */
	createGroup(memberIds: string[]): TabGroup | null {
		const ids = memberIds.filter((m) => m.length > 0);
		if (ids.length === 0) return null;
		const used = new Set(this.groups.map((g) => g.color));
		const color: GroupColor =
			GROUP_COLORS.find((c) => !used.has(c)) ??
			GROUP_COLORS[this.groups.length % GROUP_COLORS.length];
		const group: TabGroup = {
			id: newId(),
			name: nextGroupName(this.groups.map((g) => g.name)),
			color,
			collapsed: false,
			memberIds: [...ids],
		};
		this.groups.push(group);
		this.reconcile();
		return group;
	}

	createGroupFromActiveLeaf(): void {
		const leaf = this.activeManagedLeaf();
		if (!leaf) {
			new Notice("Focus a tab to start a group.");
			return;
		}
		this.createGroup([id(leaf)]);
	}

	toggleCollapse(groupId: string): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		g.collapsed = !g.collapsed;
		this.reconcile();
	}

	toggleCollapseActive(): void {
		const leaf = this.activeManagedLeaf();
		if (!leaf) return;
		const g = this.groups.find((x) => x.memberIds.includes(id(leaf)));
		if (g) this.toggleCollapse(g.id);
	}

	ungroup(groupId: string): void {
		this.groups = this.groups.filter((g) => g.id !== groupId);
		this.reconcile();
	}

	/** Snapshot for tests/inspection. */
	getGroups(): readonly TabGroup[] {
		return this.groups;
	}

	// --- reconcile + render --------------------------------------------------

	private schedule(): void {
		if (!this.plugin.settings.enableTabGroups) return;
		if (this.scheduled !== null) return;
		this.scheduled = window.setTimeout(() => {
			this.scheduled = null;
			this.reconcile();
		}, 30);
	}

	private reconcile(): void {
		if (!this.plugin.settings.enableTabGroups) {
			this.clear();
			return;
		}
		this.setBodyClass(true);
		// Mutate with observers off so our own writes never re-trigger us.
		this.disconnectObservers();

		const byContainer = new Map<WorkspaceParent, WorkspaceLeaf[]>();
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!this.isManaged(leaf)) return;
			const parent = leaf.parent;
			const arr = byContainer.get(parent);
			if (arr) arr.push(leaf);
			else byContainer.set(parent, [leaf]);
		});

		const newTagged = new Set<HTMLElement>();
		const seenGroupIds = new Set<string>();
		const strips: HTMLElement[] = [];

		for (const [parent, leaves] of byContainer) {
			const strip = stripOf(leaves);
			if (!strip) continue;
			strips.push(strip);

			const { order, headerById } = readOrder(strip, leaves);
			if (order.length === 0) continue;

			const here = this.groups.filter((g) =>
				g.memberIds.some((m) => headerById.has(m)),
			);
			const prev = this.prevOrder.get(parent) ?? order;
			const result = reconcileMembership(here, prev, order);

			const stale = new Set(here);
			this.groups = this.groups
				.filter((g) => !stale.has(g))
				.concat(result.groups);
			this.prevOrder.set(parent, order);

			this.renderStrip(strip, order, headerById, result.groups, newTagged, seenGroupIds);
		}

		// Clear attrs from headers tagged previously but not this pass.
		for (const header of this.tagged) {
			if (!newTagged.has(header)) clearHeaderAttrs(header);
		}
		this.tagged = newTagged;

		// Remove chips for groups that no longer exist.
		for (const [gid, chip] of this.chips) {
			if (!seenGroupIds.has(gid)) {
				chip.remove();
				this.chips.delete(gid);
			}
		}

		this.observe(strips);
	}

	private renderStrip(
		strip: HTMLElement,
		order: string[],
		headerById: Map<string, HTMLElement>,
		groups: TabGroup[],
		newTagged: Set<HTMLElement>,
		seenGroupIds: Set<string>,
	): void {
		const groupOf = groupOfMap(groups);
		const byId = new Map(groups.map((g) => [g.id, g] as const));

		for (let i = 0; i < order.length; i++) {
			const header = headerById.get(order[i]);
			if (!header) continue;
			const gid = groupOf.get(order[i]);
			const g = gid ? byId.get(gid) : undefined;
			if (!g) {
				clearHeaderAttrs(header);
				continue;
			}
			const leftSame = i > 0 && groupOf.get(order[i - 1]) === g.id;
			const rightSame =
				i < order.length - 1 && groupOf.get(order[i + 1]) === g.id;
			const pos: GroupPos =
				!leftSame && !rightSame
					? "solo"
					: !leftSame
						? "first"
						: !rightSame
							? "last"
							: "mid";
			setHeaderAttrs(header, g.id, g.color, pos, g.collapsed);
			newTagged.add(header);
		}

		for (const g of groups) {
			const firstId = order.find((m) => groupOf.get(m) === g.id);
			if (firstId === undefined) continue;
			const firstHeader = headerById.get(firstId);
			if (!firstHeader) continue;

			let chip = this.chips.get(g.id);
			if (!chip) {
				chip = buildChip(strip.ownerDocument, {
					onToggle: () => this.toggleCollapse(g.id),
					onContextMenu: (evt) => this.showChipMenu(g.id, evt),
				});
				this.chips.set(g.id, chip);
			}
			updateChip(chip, g.name, g.color, g.collapsed);
			if (chip.parentElement !== strip || chip.nextElementSibling !== firstHeader) {
				strip.insertBefore(chip, firstHeader);
			}
			seenGroupIds.add(g.id);
		}
	}

	private showChipMenu(groupId: string, evt: MouseEvent): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle(g.collapsed ? "Expand group" : "Collapse group")
				.setIcon(g.collapsed ? "chevrons-up-down" : "chevrons-down-up")
				.onClick(() => this.toggleCollapse(groupId)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Ungroup")
				.setIcon("ungroup")
				.onClick(() => this.ungroup(groupId)),
		);
		menu.showAtMouseEvent(evt);
	}

	// --- teardown ------------------------------------------------------------

	clear(): void {
		this.cancelScheduled();
		this.disconnectObservers();
		for (const header of this.tagged) clearHeaderAttrs(header);
		this.tagged = new Set();
		for (const chip of this.chips.values()) chip.remove();
		this.chips.clear();
		this.prevOrder = new Map();
		this.setBodyClass(false);
	}

	// --- helpers -------------------------------------------------------------

	private isManaged(leaf: WorkspaceLeaf): boolean {
		if (!headerEl(leaf)) return false;
		const root = leaf.getRoot();
		const ws = this.plugin.app.workspace;
		return root !== ws.leftSplit && root !== ws.rightSplit;
	}

	private activeManagedLeaf(): WorkspaceLeaf | null {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(View)?.leaf;
		return leaf && this.isManaged(leaf) ? leaf : null;
	}

	private bodies(): Set<HTMLElement> {
		const ws = this.plugin.app.workspace;
		const set = new Set<HTMLElement>([ws.containerEl.ownerDocument.body]);
		ws.iterateAllLeaves((leaf) => {
			set.add(leaf.view.containerEl.ownerDocument.body);
		});
		return set;
	}

	private setBodyClass(on: boolean): void {
		for (const body of this.bodies()) body.classList.toggle(TAB_GROUPS_CLASS, on);
	}

	private observe(strips: HTMLElement[]): void {
		this.disconnectObservers();
		for (const strip of strips) {
			const view = strip.ownerDocument.defaultView;
			if (!view) continue;
			const observer = new view.MutationObserver(() => this.schedule());
			observer.observe(strip, { childList: true });
			this.observers.push(observer);
		}
	}

	private disconnectObservers(): void {
		for (const observer of this.observers) observer.disconnect();
		this.observers = [];
	}

	private cancelScheduled(): void {
		if (this.scheduled !== null) {
			window.clearTimeout(this.scheduled);
			this.scheduled = null;
		}
	}
}

/** The inner strip element that actually holds the `.workspace-tab-header`s. */
function stripOf(leaves: WorkspaceLeaf[]): HTMLElement | null {
	for (const leaf of leaves) {
		const el = headerEl(leaf);
		if (el?.parentElement) return el.parentElement;
	}
	return null;
}

/** Read the strip's leaf-id order (DOM order) + an id→header map. */
function readOrder(
	strip: HTMLElement,
	leaves: WorkspaceLeaf[],
): { order: string[]; headerById: Map<string, HTMLElement> } {
	const byHeader = new Map<HTMLElement, WorkspaceLeaf>();
	for (const leaf of leaves) {
		const el = headerEl(leaf);
		if (el) byHeader.set(el, leaf);
	}
	const order: string[] = [];
	const headerById = new Map<string, HTMLElement>();
	strip
		.querySelectorAll<HTMLElement>(":scope > .workspace-tab-header")
		.forEach((header) => {
			const leaf = byHeader.get(header);
			if (!leaf) return;
			const leafId = id(leaf);
			order.push(leafId);
			headerById.set(leafId, header);
		});
	return { order, headerById };
}

function newId(): string {
	const c = window.crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `g-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Move an existing leaf to `index` within its strip, if the internals exist. */
export function moveLeafToIndex(leaf: WorkspaceLeaf, index: number): boolean {
	const parent = leaf.parent as TabsInternal;
	if (typeof parent.removeChild !== "function" || typeof parent.insertChild !== "function") {
		return false;
	}
	parent.removeChild(leaf);
	parent.insertChild(index, leaf);
	return true;
}
