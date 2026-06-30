/**
 * Pure, `obsidian`-free decision core for Chrome-style tab groups.
 *
 * Everything in this module is plain data + plain functions with no dependency
 * on Obsidian or the DOM, so it can be unit-tested directly under `node --test`
 * (Node ≥ 22.18 strips the types). The Obsidian-facing controller stays thin and
 * delegates every non-trivial decision here.
 *
 * The hard part is `reconcile`: when Obsidian's *native* tab drag reorders the
 * tab strip, we don't reimplement the drag — we observe the new order and infer
 * how group membership should change, the way Chrome does (drop a tab inside a
 * group → it joins; drag a member out → it leaves; drop inside another group →
 * it switches). See `reconcile` for the exact, deliberately-conservative rules.
 */

/** The nine Google-Chrome tab-group colors. */
export const GROUP_COLORS = [
	"grey",
	"blue",
	"red",
	"yellow",
	"green",
	"pink",
	"purple",
	"cyan",
	"orange",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export const DEFAULT_GROUP_COLOR: GroupColor = "blue";

export function isGroupColor(value: unknown): value is GroupColor {
	return (
		typeof value === "string" &&
		(GROUP_COLORS as readonly string[]).includes(value)
	);
}

/**
 * A live group: a named, colored, contiguous run of tabs inside a single tab
 * container. Membership is explicit (`memberIds`, ordered to match the strip)
 * and keyed by Obsidian's stable per-leaf `id` (persisted in workspace.json).
 */
export interface TabGroup {
	id: string;
	name: string;
	color: GroupColor;
	collapsed: boolean;
	/** Member leaf ids, in strip order. */
	memberIds: string[];
}

/** Where a member sits within its contiguous run — drives CSS end-rounding. */
export type GroupPos = "solo" | "first" | "mid" | "last";

export function posFor(index: number, length: number): GroupPos {
	if (length <= 1) return "solo";
	if (index === 0) return "first";
	if (index === length - 1) return "last";
	return "mid";
}

/** Minimal serializable view state — what `leaf.getViewState()` round-trips. */
export interface SerializableViewState {
	type: string;
	state?: Record<string, unknown>;
}

/** One saved tab: enough to reopen it later via `leaf.setViewState()`. */
export interface SavedMember {
	viewState: SerializableViewState;
	pinned: boolean;
}

/** A persisted group library entry (Chrome's "saved group"). */
export interface SavedTabGroup {
	id: string;
	name: string;
	color: GroupColor;
	members: SavedMember[];
	createdAt: number;
	updatedAt: number;
	/** When set, this saved group mirrors a live group for auto-sync. */
	linkedLiveGroupId?: string;
}

/** Build a `SavedMember` from a leaf's view state, dropping volatile fields. */
export function memberFromViewState(
	viewState: SerializableViewState,
	pinned: boolean,
): SavedMember {
	return {
		viewState: { type: viewState.type, state: viewState.state },
		pinned,
	};
}

/** Pick the lowest unused "Group N" name. */
export function nextGroupName(existing: readonly string[]): string {
	const taken = new Set(existing);
	for (let n = 1; ; n++) {
		const candidate = `Group ${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Map leaf id → owning group id (or undefined when ungrouped). */
export function groupOfMap(groups: readonly TabGroup[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const g of groups) {
		for (const id of g.memberIds) map.set(id, g.id);
	}
	return map;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * Every tab that, if removed from both orderings, makes the rest identical —
 * i.e. the candidate(s) for "the one tab that moved". A clean single move has
 * exactly one; an adjacent swap has two (it's genuinely ambiguous which tab the
 * user dragged), and `reconcile` disambiguates by intent. Empty when the change
 * isn't a single in-place move (e.g. an open/close changed the set).
 */
export function findMovedCandidates(
	prevOrder: readonly string[],
	newOrder: readonly string[],
): string[] {
	if (prevOrder.length !== newOrder.length) return [];
	if (arraysEqual(prevOrder, newOrder)) return [];
	const out: string[] = [];
	for (const id of newOrder) {
		const prevWithout = prevOrder.filter((x) => x !== id);
		const newWithout = newOrder.filter((x) => x !== id);
		if (arraysEqual(prevWithout, newWithout)) out.push(id);
	}
	return out;
}

/** The first move candidate, or null. Convenience over `findMovedCandidates`. */
export function findMovedId(
	prevOrder: readonly string[],
	newOrder: readonly string[],
): string | null {
	const candidates = findMovedCandidates(prevOrder, newOrder);
	return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Decide the moved tab's new group from its neighbors in the new order.
 *
 * Deliberately conservative so behavior is predictable without live pointer
 * feedback:
 *  - Dropped **inside** a uniform region (both neighbors same group, or both
 *    ungrouped) → that region's group. This is the "join a group" / "reorder
 *    within a group" / "land in open space" case.
 *  - At a **boundary** (neighbors differ): stay in the tab's own previous group
 *    iff it's still touching it (handles reordering to a group's edge); else
 *    ungroup. Growing a group by dropping at its outer edge is intentionally
 *    NOT inferred from a drag — use the explicit "add to group" action.
 */
export function groupForMoved(
	leftGroup: string | undefined,
	rightGroup: string | undefined,
	prevGroup: string | undefined,
): string | undefined {
	if (leftGroup === rightGroup) return leftGroup;
	if (prevGroup !== undefined && (leftGroup === prevGroup || rightGroup === prevGroup)) {
		return prevGroup;
	}
	return undefined;
}

export interface ReconcileResult {
	groups: TabGroup[];
	/** Ids present in the strip but in no group, in strip order. */
	ungrouped: string[];
}

/**
 * The group a moved tab should belong to after landing at its new spot, given
 * current membership. Applies the `groupForMoved` rule plus singleton
 * protection: dragging the sole member of a group never dissolves it (Chrome
 * carries a one-tab group with the tab); only an explicit action empties it.
 */
function computeNext(
	moved: string,
	groupOf: ReadonlyMap<string, string>,
	newOrder: readonly string[],
): string | undefined {
	const i = newOrder.indexOf(moved);
	const leftId = i > 0 ? newOrder[i - 1] : undefined;
	const rightId = i < newOrder.length - 1 ? newOrder[i + 1] : undefined;
	const leftGroup = leftId !== undefined ? groupOf.get(leftId) : undefined;
	const rightGroup = rightId !== undefined ? groupOf.get(rightId) : undefined;
	const prevGroup = groupOf.get(moved);
	let next = groupForMoved(leftGroup, rightGroup, prevGroup);
	if (next === undefined && prevGroup !== undefined) {
		let othersInPrev = false;
		for (const [id, gid] of groupOf) {
			if (id !== moved && gid === prevGroup) {
				othersInPrev = true;
				break;
			}
		}
		if (!othersInPrev) next = prevGroup;
	}
	return next;
}

/**
 * Reconcile group membership against the strip's new tab order, handling tabs
 * that were opened (new ids → ungrouped), closed (gone ids → dropped), and a
 * single drag-move (membership inferred via `groupForMoved`). Group member
 * order is always resynced to the strip; emptied groups are removed.
 *
 * Pure: returns fresh group objects, never mutates the input.
 */
export function reconcile(
	groups: readonly TabGroup[],
	prevOrder: readonly string[],
	newOrder: readonly string[],
): ReconcileResult {
	const newSet = new Set(newOrder);
	const prevSet = new Set(prevOrder);

	// Membership after dropping closed tabs; moved-tab handling adjusts below.
	const groupOf = new Map<string, string>();
	for (const g of groups) {
		for (const id of g.memberIds) {
			if (newSet.has(id)) groupOf.set(id, g.id);
		}
	}

	// A single move among the tabs common to both orders => maybe re-group it.
	// An adjacent swap yields two candidates; pick the one whose regrouping is
	// most "intentional": joining/staying in a real group beats leaving one,
	// which beats no change. This makes "drag a tab into a group" win over the
	// equally-valid reading "the displaced neighbor left the group".
	const commonPrev = prevOrder.filter((id) => newSet.has(id));
	const commonNew = newOrder.filter((id) => prevSet.has(id));
	const candidates = findMovedCandidates(commonPrev, commonNew);
	if (candidates.length > 0) {
		let best = candidates[0];
		let bestScore = -1;
		for (const c of candidates) {
			const next = computeNext(c, groupOf, newOrder);
			const changed = next !== groupOf.get(c);
			const score = !changed ? 0 : next !== undefined ? 2 : 1;
			if (score > bestScore) {
				bestScore = score;
				best = c;
			}
		}
		const next = computeNext(best, groupOf, newOrder);
		if (next === undefined) groupOf.delete(best);
		else groupOf.set(best, next);
	}

	// Rebuild each group's members from the strip order; drop empty groups.
	const rebuilt: TabGroup[] = [];
	for (const g of groups) {
		const memberIds = newOrder.filter((id) => groupOf.get(id) === g.id);
		if (memberIds.length > 0) {
			rebuilt.push({ ...g, memberIds });
		}
	}

	const grouped = new Set(rebuilt.flatMap((g) => g.memberIds));
	const ungrouped = newOrder.filter((id) => !grouped.has(id));
	return { groups: rebuilt, ungrouped };
}

// ---------------------------------------------------------------------------
// Persisted data shape + migration
// ---------------------------------------------------------------------------

/** Bump when the on-disk shape changes incompatibly. */
export const SCHEMA_VERSION = 2;

/**
 * Everything the plugin persists. Settings keep their legacy keys; tab-group
 * state lives alongside under a versioned wrapper.
 */
export interface PersistedData<TSettings> {
	schemaVersion: number;
	settings: TSettings;
	savedGroups: SavedTabGroup[];
	/** Live groups, persisted so they survive a reload (rebound by leaf id). */
	liveGroups: PersistedLiveGroup[];
}

/** A live group as stored on disk (scoped to its container for rebind). */
export interface PersistedLiveGroup {
	id: string;
	name: string;
	color: GroupColor;
	collapsed: boolean;
	memberIds: string[];
}

/**
 * Normalize whatever `loadData()` returns into the current shape. Pre-tab-group
 * `data.json` is the flat settings object (no `schemaVersion`); wrap it,
 * preserving the user's existing settings.
 */
export function migrateData<TSettings>(
	raw: unknown,
	defaultSettings: TSettings,
): PersistedData<TSettings> {
	const fresh = (): PersistedData<TSettings> => ({
		schemaVersion: SCHEMA_VERSION,
		settings: { ...defaultSettings },
		savedGroups: [],
		liveGroups: [],
	});

	if (raw === null || typeof raw !== "object") return fresh();
	const obj = raw as Record<string, unknown>;

	if (obj.schemaVersion === SCHEMA_VERSION) {
		return {
			schemaVersion: SCHEMA_VERSION,
			settings: { ...defaultSettings, ...(obj.settings as object) },
			savedGroups: Array.isArray(obj.savedGroups)
				? (obj.savedGroups as SavedTabGroup[])
				: [],
			liveGroups: Array.isArray(obj.liveGroups)
				? (obj.liveGroups as PersistedLiveGroup[])
				: [],
		};
	}

	// Legacy: the whole object was the flat settings blob.
	return {
		schemaVersion: SCHEMA_VERSION,
		settings: { ...defaultSettings, ...(obj as TSettings) },
		savedGroups: [],
		liveGroups: [],
	};
}
