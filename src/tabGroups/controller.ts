import { Menu, Notice, View, WorkspaceLeaf, WorkspaceParent } from "obsidian";
import type RealPinPlugin from "../main";
import {
	GROUP_COLORS,
	groupOfMap,
	memberFromViewState,
	nextGroupName,
	reconcile as reconcileMembership,
} from "./model";
import type {
	GroupColor,
	GroupPos,
	PersistedLiveGroup,
	SavedMember,
	TabGroup,
} from "./model";
import {
	TAB_GROUPS_CLASS,
	buildChip,
	clearHeaderAttrs,
	setHeaderAttrs,
	updateChip,
} from "./overlay";
import { GroupEditModal, GroupSuggestModal } from "./modals";
import { SavedGroupsView, VIEW_TYPE_SAVED_GROUPS } from "./SavedGroupsView";

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
	children?: WorkspaceLeaf[];
};

/**
 * `getLeafById` is Obsidian's own id→leaf lookup. It's the reliable way to ask
 * "is this tab still open?" — unlike `iterateAllLeaves`, it resolves deferred
 * (background) tabs and returns null exactly when a leaf has been closed. Not on
 * the public type surface, so reached through a guarded narrow cast.
 */
type WorkspaceWithLeafById = {
	getLeafById?(id: string): WorkspaceLeaf | null;
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
	private saveTimer: number | null = null;
	/** Signature of the last persisted group state, to avoid redundant writes. */
	private lastSig = "";
	/** Documents we've already wired the delegated chip click listener onto. */
	private readonly delegatedDocs = new WeakSet<Document>();
	/** The group being dragged by its pill (HTML5 drag), or null. */
	private draggingGroupId: string | null = null;
	/**
	 * Each group's collapsed state captured when a pill drag folds them all, so
	 * they can be restored on drop/cancel; null when no pill drag is folding them.
	 */
	private groupDragRestore: Map<string, boolean> | null = null;
	/**
	 * Pending rAF that folds the groups one frame after a pill drag starts, with
	 * the window it was scheduled on (a popout has its own — cancel must match).
	 */
	private collapseRaf: { view: Window; id: number } | null = null;

	constructor(plugin: RealPinPlugin) {
		this.plugin = plugin;
	}

	start(): void {
		// Rebind groups persisted last session; reconcile drops any whose member
		// leaves no longer exist (matched by the stable leaf id).
		this.groups = this.plugin.getLiveGroups().map((g) => ({
			id: g.id,
			name: g.name,
			color: g.color,
			collapsed: g.collapsed,
			memberIds: [...g.memberIds],
		}));

		const ws = this.plugin.app.workspace;
		this.plugin.registerEvent(ws.on("layout-change", () => this.schedule()));
		this.plugin.registerEvent(
			ws.on("active-leaf-change", (leaf) => {
				this.expandGroupOf(leaf);
				this.schedule();
			}),
		);
		this.plugin.registerEvent(ws.on("window-open", () => this.schedule()));
		this.plugin.registerEvent(
			ws.on("file-menu", (menu, _file, source, leaf) => {
				if (source === "tab-header" && leaf) {
					this.addTabHeaderMenuItems(menu, leaf);
				}
			}),
		);
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
		return this.createGroupNamed(
			ids,
			nextGroupName(this.groups.map((g) => g.name)),
			color,
		);
	}

	private createGroupNamed(
		memberIds: string[],
		name: string,
		color: GroupColor,
	): TabGroup {
		const group: TabGroup = {
			id: newId(),
			name,
			color,
			collapsed: false,
			memberIds: [...memberIds],
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

	/**
	 * Expand the group the newly-focused leaf belongs to (Chrome auto-expands a
	 * collapsed group when one of its tabs becomes active). Only flips the flag;
	 * the scheduled reconcile repaints. No-op mid pill-drag, where we keep
	 * everything folded on purpose.
	 */
	private expandGroupOf(leaf: WorkspaceLeaf | null): void {
		if (!this.plugin.settings.enableTabGroups || this.groupDragRestore) return;
		if (!leaf) return;
		const g = this.groups.find((x) => x.memberIds.includes(id(leaf)));
		if (g && g.collapsed) g.collapsed = false;
	}

	ungroup(groupId: string): void {
		this.groups = this.groups.filter((g) => g.id !== groupId);
		this.reconcile();
	}

	renameGroup(groupId: string, name: string): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		g.name = name;
		this.reconcile();
	}

	recolorGroup(groupId: string, color: GroupColor): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		g.color = color;
		this.reconcile();
	}

	/** Open the name/color editor for a group and apply the result. */
	editGroup(groupId: string): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		void new GroupEditModal(this.plugin.app, {
			name: g.name,
			color: g.color,
		})
			.ask()
			.then((result) => {
				if (!result) return;
				const live = this.groups.find((x) => x.id === groupId);
				if (!live) return;
				live.name = result.name;
				live.color = result.color;
				this.reconcile();
			});
	}

	editActiveGroup(): void {
		const leaf = this.activeManagedLeaf();
		const g = leaf
			? this.groups.find((x) => x.memberIds.includes(id(leaf)))
			: undefined;
		if (g) this.editGroup(g.id);
		else new Notice("The active tab isn't in a group.");
	}

	/**
	 * Move a leaf into a group (removing it from any other) and snap it next to
	 * the group's run so the group stays a contiguous block.
	 */
	addLeafToGroup(leafId: string, groupId: string): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		for (const other of this.groups) {
			if (other !== g) {
				other.memberIds = other.memberIds.filter((m) => m !== leafId);
			}
		}
		if (!g.memberIds.includes(leafId)) g.memberIds.push(leafId);
		this.groups = this.groups.filter((x) => x.memberIds.length > 0);

		const leaf = this.leafById(leafId);
		const order = leaf ? this.orderInParent(leaf) : null;
		if (leaf && order) {
			const otherPos = g.memberIds
				.filter((m) => m !== leafId)
				.map((m) => order.indexOf(m))
				.filter((i) => i >= 0);
			if (otherPos.length > 0) {
				this.moveLeafAfter(leaf, order[Math.max(...otherPos)]);
			}
		}
		this.reconcile();
	}

	/**
	 * Remove a leaf from whatever group it's in (dropping emptied groups). If the
	 * tab was in the middle of the group's run, eject it just past the group so
	 * the group stays contiguous and never visually contains a non-member.
	 */
	removeLeafFromGroup(leafId: string): void {
		const g = this.groups.find((x) => x.memberIds.includes(leafId));
		if (!g) return;
		g.memberIds = g.memberIds.filter((m) => m !== leafId);
		this.groups = this.groups.filter((x) => x.memberIds.length > 0);

		if (g.memberIds.length > 0) {
			const leaf = this.leafById(leafId);
			const order = leaf ? this.orderInParent(leaf) : null;
			if (leaf && order) {
				const removedPos = order.indexOf(leafId);
				const memberPos = g.memberIds
					.map((m) => order.indexOf(m))
					.filter((i) => i >= 0);
				const min = Math.min(...memberPos);
				const max = Math.max(...memberPos);
				// Only move when it's stranded *between* members; an edge tab is
				// already outside the run.
				if (memberPos.length > 0 && removedPos > min && removedPos < max) {
					this.moveLeafAfter(leaf, order[max]);
				}
			}
		}
		this.reconcile();
	}

	/** Add our grouping items to a tab's native right-click menu. */
	addTabHeaderMenuItems(menu: Menu, leaf: WorkspaceLeaf): void {
		if (!this.plugin.settings.enableTabGroups || !this.isManaged(leaf)) return;
		const leafId = id(leaf);
		const current = this.groups.find((g) => g.memberIds.includes(leafId));
		const others = this.groups.filter((g) => g.id !== current?.id);

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Add tab to new group")
				.setIcon("plus")
				.onClick(() => this.createGroup([leafId])),
		);
		if (others.length > 0) {
			menu.addItem((item) =>
				item
					.setTitle("Add tab to existing group…")
					.setIcon("layers")
					.onClick(() =>
						new GroupSuggestModal(
							this.plugin.app,
							others,
							(choice) => {
								if (choice.kind === "group") {
									this.addLeafToGroup(leafId, choice.group.id);
								}
							},
							false,
						).open(),
					),
			);
		}
		if (current) {
			menu.addItem((item) =>
				item
					.setTitle("Remove tab from group")
					.setIcon("minus")
					.onClick(() => this.removeLeafFromGroup(leafId)),
			);
		}
	}

	/** Prompt for which group to add the active tab to (or make a new one). */
	addActiveLeafToGroupPrompt(): void {
		const leaf = this.activeManagedLeaf();
		if (!leaf) {
			new Notice("Focus a tab to add it to a group.");
			return;
		}
		const leafId = id(leaf);
		if (this.groups.length === 0) {
			this.createGroup([leafId]);
			return;
		}
		new GroupSuggestModal(this.plugin.app, this.groups, (choice) => {
			if (choice.kind === "new") this.createGroup([leafId]);
			else this.addLeafToGroup(leafId, choice.group.id);
		}).open();
	}

	/** Snapshot for tests/inspection. */
	getGroups(): readonly TabGroup[] {
		return this.groups;
	}

	// --- saved-group library (Chrome's "saved groups") ----------------------

	/** Save a live group to the library (or update its linked saved entry). */
	saveGroup(groupId: string): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		const members = this.snapshotMembers(g);
		if (members.length === 0) {
			new Notice("Nothing to save in this group.");
			return;
		}
		const saved = this.plugin.getSavedGroups();
		const now = Date.now();
		const existing = saved.find((s) => s.linkedLiveGroupId === g.id);
		if (existing) {
			existing.members = members;
			existing.name = g.name;
			existing.color = g.color;
			existing.updatedAt = now;
		} else {
			saved.push({
				id: newId(),
				name: g.name,
				color: g.color,
				members,
				createdAt: now,
				updatedAt: now,
				linkedLiveGroupId: g.id,
			});
		}
		void this.plugin.saveSavedGroups(saved);
		this.refreshSavedView();
		new Notice(`Saved group "${g.name}".`);
	}

	saveActiveGroup(): void {
		const leaf = this.activeManagedLeaf();
		const g = leaf
			? this.groups.find((x) => x.memberIds.includes(id(leaf)))
			: undefined;
		if (g) this.saveGroup(g.id);
		else new Notice("The active tab isn't in a group.");
	}

	/** Reopen a saved group into the current tab area, as a live group. */
	async openSavedGroup(savedId: string): Promise<void> {
		const saved = this.plugin.getSavedGroups().find((s) => s.id === savedId);
		if (!saved) return;
		const ws = this.plugin.app.workspace;
		const newIds: string[] = [];
		for (const member of saved.members) {
			let leaf: WorkspaceLeaf;
			try {
				leaf = ws.getLeaf("tab");
			} catch {
				// No tab group exists yet (everything was closed) — create one.
				leaf = ws.getLeaf(false);
			}
			await leaf.setViewState({
				type: member.viewState.type,
				state: member.viewState.state,
			});
			if (member.pinned) leaf.setPinned(true);
			newIds.push(id(leaf));
		}
		if (newIds.length === 0) return;
		const group = this.createGroupNamed(newIds, saved.name, saved.color);
		saved.linkedLiveGroupId = group.id;
		void this.plugin.saveSavedGroups(this.plugin.getSavedGroups());
	}

	deleteSavedGroup(savedId: string): void {
		const next = this.plugin
			.getSavedGroups()
			.filter((s) => s.id !== savedId);
		void this.plugin.saveSavedGroups(next);
		this.refreshSavedView();
	}

	editSavedGroup(savedId: string): void {
		const s = this.plugin.getSavedGroups().find((x) => x.id === savedId);
		if (!s) return;
		void new GroupEditModal(this.plugin.app, { name: s.name, color: s.color })
			.ask()
			.then((result) => {
				if (!result) return;
				const live = this.plugin
					.getSavedGroups()
					.find((x) => x.id === savedId);
				if (!live) return;
				live.name = result.name;
				live.color = result.color;
				live.updatedAt = Date.now();
				void this.plugin.saveSavedGroups(this.plugin.getSavedGroups());
				this.refreshSavedView();
				if (live.linkedLiveGroupId) {
					const lg = this.groups.find((g) => g.id === live.linkedLiveGroupId);
					if (lg) {
						lg.name = result.name;
						lg.color = result.color;
						this.reconcile();
					}
				}
			});
	}

	/** Re-snapshot a saved group from its still-open linked live group. */
	updateSavedFromLinked(savedId: string): void {
		const s = this.plugin.getSavedGroups().find((x) => x.id === savedId);
		if (!s) return;
		const live = s.linkedLiveGroupId
			? this.groups.find((g) => g.id === s.linkedLiveGroupId)
			: undefined;
		if (!live) {
			new Notice("This group isn't open right now.");
			return;
		}
		const members = this.snapshotMembers(live);
		if (members.length === 0) return;
		s.members = members;
		s.name = live.name;
		s.color = live.color;
		s.updatedAt = Date.now();
		void this.plugin.saveSavedGroups(this.plugin.getSavedGroups());
		this.refreshSavedView();
		new Notice(`Updated "${s.name}".`);
	}

	private snapshotMembers(group: TabGroup): SavedMember[] {
		const members: SavedMember[] = [];
		for (const memberId of group.memberIds) {
			const leaf = this.leafById(memberId);
			if (!leaf) continue;
			const vs = leaf.getViewState();
			members.push(
				memberFromViewState(
					{ type: vs.type, state: vs.state },
					vs.pinned ?? false,
				),
			);
		}
		return members;
	}

	private leafById(leafId: string): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (id(leaf) === leafId) found = leaf;
		});
		return found;
	}

	/** Leaf-id order (DOM order) of the strip that `leaf` lives in, or null. */
	private orderInParent(leaf: WorkspaceLeaf): string[] | null {
		const strip = headerEl(leaf)?.parentElement;
		if (!strip) return null;
		const parent = leaf.parent;
		const leaves: WorkspaceLeaf[] = [];
		this.plugin.app.workspace.iterateAllLeaves((l) => {
			if (l.parent === parent) leaves.push(l);
		});
		return readOrder(strip, leaves).order;
	}

	/** Move `leaf` to sit immediately after `afterLeafId` within its strip. */
	private moveLeafAfter(leaf: WorkspaceLeaf, afterLeafId: string): void {
		const order = this.orderInParent(leaf);
		if (!order) return;
		const from = order.indexOf(id(leaf));
		const to = order.indexOf(afterLeafId);
		if (from < 0 || to < 0 || from === to + 1) return; // already right after
		moveLeafToIndex(leaf, from < to ? to : to + 1);
	}

	private refreshSavedView(): void {
		this.plugin.app.workspace
			.getLeavesOfType(VIEW_TYPE_SAVED_GROUPS)
			.forEach((leaf) => {
				if (leaf.view instanceof SavedGroupsView) leaf.view.render();
			});
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

	/**
	 * Drop groups whose tabs have all been closed — a group with no live member
	 * ceases to exist. Uses `getLeafById` (reliable for deferred/background tabs)
	 * rather than `iterateAllLeaves`, which under-reports and would delete live
	 * groups. Only mutates `this.groups`; the caller (reconcile) renders the rest.
	 */
	private pruneClosedGroups(): void {
		const ws = this.plugin.app.workspace as unknown as WorkspaceWithLeafById;
		if (typeof ws.getLeafById !== "function") return; // can't verify → keep all
		const isOpen = (leafId: string): boolean => ws.getLeafById!(leafId) != null;
		const next = this.groups.filter((g) => g.memberIds.some(isOpen));
		if (next.length !== this.groups.length) this.groups = next;
	}

	/**
	 * Persist live groups (debounced) so they survive a reload, and keep any
	 * linked saved groups in sync (Chrome's "living" saved group). Gated on a
	 * signature so unchanged reconciles (e.g. active-leaf-change) don't write.
	 */
	private schedulePersist(): void {
		// Don't persist the transient all-collapsed state a pill drag installs;
		// the real state is written when the drag restores it.
		if (this.groupDragRestore) return;
		if (this.saveTimer !== null) return;
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			const sig = this.groupsSignature();
			if (sig === this.lastSig) return;
			this.lastSig = sig;
			void this.plugin.saveLiveGroups(this.serializeLiveGroups());
			if (this.syncLinkedSaved()) {
				void this.plugin.saveSavedGroups(this.plugin.getSavedGroups());
				this.refreshSavedView();
			}
		}, 400);
	}

	private groupsSignature(): string {
		return JSON.stringify(
			this.groups.map((g) => [
				g.id,
				g.name,
				g.color,
				g.collapsed,
				g.memberIds,
			]),
		);
	}

	private serializeLiveGroups(): PersistedLiveGroup[] {
		return this.groups.map((g) => ({
			id: g.id,
			name: g.name,
			color: g.color,
			collapsed: g.collapsed,
			memberIds: [...g.memberIds],
		}));
	}

	private syncLinkedSaved(): boolean {
		const saved = this.plugin.getSavedGroups();
		let changed = false;
		for (const s of saved) {
			if (!s.linkedLiveGroupId) continue;
			const live = this.groups.find((g) => g.id === s.linkedLiveGroupId);
			if (!live) continue;
			const members = this.snapshotMembers(live);
			if (members.length === 0) continue;
			s.members = members;
			s.name = live.name;
			s.color = live.color;
			s.updatedAt = Date.now();
			changed = true;
		}
		return changed;
	}

	private reconcile(): void {
		if (!this.plugin.settings.enableTabGroups) {
			this.clear();
			return;
		}
		this.setBodyClass(true);
		// Mutate with observers off so our own writes never re-trigger us.
		this.disconnectObservers();
		// Drop groups emptied by closed tabs first, so their chips aren't rendered.
		this.pruneClosedGroups();

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
		this.schedulePersist();
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

		this.attachDelegation(strip.ownerDocument);

		for (const g of groups) {
			const firstId = order.find((m) => groupOf.get(m) === g.id);
			if (firstId === undefined) continue;
			const firstHeader = headerById.get(firstId);
			if (!firstHeader) continue;

			let chip = this.chips.get(g.id);
			if (!chip) {
				chip = buildChip(strip.ownerDocument);
				this.chips.set(g.id, chip);
			}
			chip.dataset.rpGroupId = g.id;
			updateChip(chip, g.name, g.color, g.collapsed);
			if (chip.parentElement !== strip || chip.nextElementSibling !== firstHeader) {
				strip.insertBefore(chip, firstHeader);
			}
			seenGroupIds.add(g.id);
		}

		// Drop any chips Obsidian cloned from ours (clones aren't in our cache).
		const live = new Set(this.chips.values());
		strip
			.querySelectorAll<HTMLElement>(".real-pin-group-chip")
			.forEach((el) => {
				if (!live.has(el)) el.remove();
			});
	}

	/**
	 * One delegated listener per window document handles chip clicks (and the
	 * right-click menu + keyboard). Delegation — rather than a listener on each
	 * chip — because Obsidian re-renders the strip by cloning its children, which
	 * would drop per-element listeners; the `data-rp-group-id` attribute survives
	 * cloning, so a single document-level handler stays correct.
	 */
	private attachDelegation(doc: Document): void {
		if (this.delegatedDocs.has(doc)) return;
		this.delegatedDocs.add(doc);
		const groupIdOf = (e: Event): string | undefined =>
			(e.target as HTMLElement | null)?.closest<HTMLElement>(
				".real-pin-group-chip",
			)?.dataset.rpGroupId;

		this.plugin.registerDomEvent(doc, "click", (e) => {
			const groupId = groupIdOf(e);
			if (groupId) this.toggleCollapse(groupId);
		});
		this.plugin.registerDomEvent(doc, "contextmenu", (e) => {
			const groupId = groupIdOf(e);
			if (!groupId) return;
			e.preventDefault();
			this.showChipMenu(groupId, e);
		});
		this.plugin.registerDomEvent(doc, "keydown", (e) => {
			if (e.key !== "Enter" && e.key !== " ") return;
			const groupId = groupIdOf(e);
			if (!groupId) return;
			e.preventDefault();
			this.toggleCollapse(groupId);
		});

		// Drag the pill to reorder the whole group (HTML5 drag).
		this.plugin.registerDomEvent(doc, "dragstart", (e) => {
			const groupId = groupIdOf(e);
			if (!groupId) return;
			this.draggingGroupId = groupId;
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", groupId);
			}
			// Fold every group to just its chip so you rearrange them without
			// minding how many tabs each holds. This MUST be deferred: mutating the
			// DOM inside dragstart makes Chromium/Electron abort the native drag
			// (bug 168544). A frame later the drag is established and safe to touch.
			const view = doc.defaultView;
			if (view) {
				const id = view.requestAnimationFrame(() => {
					this.collapseRaf = null;
					if (this.draggingGroupId === groupId) this.collapseAllForDrag();
				});
				this.collapseRaf = { view, id };
			}
		});
		this.plugin.registerDomEvent(doc, "dragover", (e) => {
			if (!this.draggingGroupId) return;
			const overStrip = (e.target as HTMLElement | null)?.closest?.(
				".workspace-tab-header-container-inner",
			);
			if (!overStrip) return;
			e.preventDefault(); // allow drop
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		});
		this.plugin.registerDomEvent(doc, "drop", (e) => {
			const groupId = this.draggingGroupId;
			this.draggingGroupId = null;
			if (!groupId) return;
			const strip = (e.target as HTMLElement | null)?.closest?.(
				".workspace-tab-header-container-inner",
			);
			if (strip) {
				e.preventDefault();
				this.moveGroup(groupId, this.dropBeforeLeafId(e));
			}
			this.restoreAfterGroupDrag();
		});
		this.plugin.registerDomEvent(doc, "dragend", () => {
			this.draggingGroupId = null;
			this.restoreAfterGroupDrag();
		});
	}

	/**
	 * Fold every group to just its chip for the duration of a pill drag,
	 * remembering each group's prior state. Only ever called from a deferred
	 * (post-dragstart) callback so it can't abort the native drag.
	 */
	private collapseAllForDrag(): void {
		if (!this.plugin.settings.enableTabGroups) return;
		this.groupDragRestore = new Map(
			this.groups.map((g) => [g.id, g.collapsed] as const),
		);
		let changed = false;
		for (const g of this.groups) {
			if (!g.collapsed) {
				g.collapsed = true;
				changed = true;
			}
		}
		if (changed) this.reconcile();
	}

	/** Restore each group's pre-drag collapsed state after a pill drag ends. */
	private restoreAfterGroupDrag(): void {
		this.cancelCollapseRaf();
		const restore = this.groupDragRestore;
		if (!restore) return;
		this.groupDragRestore = null;
		let changed = false;
		for (const g of this.groups) {
			const was = restore.get(g.id);
			if (was !== undefined && g.collapsed !== was) {
				g.collapsed = was;
				changed = true;
			}
		}
		if (changed) this.reconcile();
		else this.schedulePersist();
	}

	/** The leaf a pill-drop should land the group *before* (null = end of strip). */
	private dropBeforeLeafId(e: DragEvent): string | null {
		const target = e.target as HTMLElement | null;

		// Dropped on a group chip: left half → before that whole group (this is how
		// you land before the first group — its chip is the leftmost element), right
		// half → after it.
		const chip = target?.closest<HTMLElement>(".real-pin-group-chip");
		if (chip) {
			const gid = chip.dataset.rpGroupId;
			const rect = chip.getBoundingClientRect();
			return this.leftHalf(e, rect)
				? this.firstMemberOf(gid)
				: this.afterGroup(gid);
		}

		const header = target?.closest<HTMLElement>(".workspace-tab-header");
		if (!header) return null;
		const leaf = this.leafForHeader(header);
		if (!leaf) return null;
		const rect = header.getBoundingClientRect();
		const leftHalf = this.leftHalf(e, rect);

		// Never land inside another group's run — snap to that group's outer
		// boundary so groups reorder *around* each other instead of splitting or
		// absorbing one another.
		const memberGroup = this.groups.find(
			(g) => g.id !== this.draggingGroupId && g.memberIds.includes(id(leaf)),
		);
		if (memberGroup) {
			return leftHalf
				? this.firstMemberOf(memberGroup.id)
				: this.afterGroup(memberGroup.id);
		}

		if (leftHalf) return id(leaf);
		// Dropped on the right half — land before the next tab (or at the end).
		const order = this.orderInParent(leaf);
		if (!order) return id(leaf);
		const next = order[order.indexOf(id(leaf)) + 1];
		return next ?? null;
	}

	private leftHalf(e: DragEvent, rect: DOMRect): boolean {
		return e.clientX <= rect.left + rect.width / 2;
	}

	/** The id of a group's first member in strip order, or null. */
	private firstMemberOf(groupId: string | undefined): string | null {
		const order = this.groupOrder(groupId);
		return order ? order[0] : null;
	}

	/** The id of the leaf just past a group's last member (null = end of strip). */
	private afterGroup(groupId: string | undefined): string | null {
		const order = this.groupOrder(groupId);
		if (!order) return null;
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return null;
		const last = order[order.length - 1];
		const stripOrder = this.orderInParentById(last);
		if (!stripOrder) return null;
		return stripOrder[stripOrder.indexOf(last) + 1] ?? null;
	}

	/** A group's member ids in strip order, or null when it isn't rendered. */
	private groupOrder(groupId: string | undefined): string[] | null {
		const g = groupId ? this.groups.find((x) => x.id === groupId) : undefined;
		if (!g || g.memberIds.length === 0) return null;
		const anyMember = this.leafById(g.memberIds[0]);
		const order = anyMember ? this.orderInParent(anyMember) : null;
		if (!order) return null;
		const inStrip = order.filter((m) => g.memberIds.includes(m));
		return inStrip.length > 0 ? inStrip : null;
	}

	/** Strip order for the container holding `leafId`, or null. */
	private orderInParentById(leafId: string): string[] | null {
		const leaf = this.leafById(leafId);
		return leaf ? this.orderInParent(leaf) : null;
	}

	private leafForHeader(header: HTMLElement): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (headerEl(leaf) === header) found = leaf;
		});
		return found;
	}

	/**
	 * Move a whole group so its run sits immediately before `beforeLeafId` (null =
	 * end of the strip). Operates on the container's `children` model (mutated
	 * synchronously by removeChild/insertChild) rather than the DOM, which lags —
	 * so extracting the members then re-inserting them contiguously is exact.
	 */
	private moveGroup(groupId: string, beforeLeafId: string | null): void {
		const g = this.groups.find((x) => x.id === groupId);
		if (!g) return;
		if (beforeLeafId !== null && g.memberIds.includes(beforeLeafId)) return;
		// Suppress reconcile while the members are mid-move: a member momentarily
		// separated from its group would otherwise be read as "dragged out" and
		// ejected. One reconcile runs at the end, when the run is contiguous again.
		this.cancelScheduled();
		this.disconnectObservers();
		for (const memberId of g.memberIds.slice()) {
			const leaf = this.leafById(memberId);
			if (!leaf) continue;
			const parent = leaf.parent as TabsInternal;
			const children = parent.children;
			if (!children) continue;
			const from = children.indexOf(leaf);
			if (from < 0) continue;
			let to = beforeLeafId
				? children.findIndex((l) => id(l) === beforeLeafId)
				: children.length;
			if (to < 0) to = children.length;
			const target = from < to ? to - 1 : to;
			if (from !== target) moveLeafToIndex(leaf, target);
		}
		this.reconcile();
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
				.setTitle("Edit name and color…")
				.setIcon("pencil")
				.onClick(() => this.editGroup(groupId)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Save group")
				.setIcon("save")
				.onClick(() => this.saveGroup(groupId)),
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
		this.draggingGroupId = null;
		this.groupDragRestore = null;
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
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		this.cancelCollapseRaf();
	}

	/** Cancel a pending fold-on-drag frame callback on its own window. */
	private cancelCollapseRaf(): void {
		if (this.collapseRaf) {
			this.collapseRaf.view.cancelAnimationFrame(this.collapseRaf.id);
			this.collapseRaf = null;
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
