import { debounce } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import type RealPinPlugin from "./main";
import { COMPACT_MARKER, SHRINK_ALL_PINNED, shouldCompact } from "./compactPolicy";

/**
 * The tab header element a leaf is rendered into. It's real (Iconize depends on
 * it too) but not part of Obsidian's public type surface, so we model only the
 * sliver we touch and reach it through a narrow cast — mirroring how `main.ts`
 * casts `app` to reach `commands`.
 */
interface LeafWithTabHeader {
	tabHeaderEl?: HTMLElement;
}

/**
 * The sliver of Iconize (`obsidian-icon-folder`) we read. All members are
 * optional and every call is `typeof`-guarded, so a future Iconize change
 * degrades to "no icon" / inert rather than throwing.
 */
interface IconizePlugin {
	getIconNameFromPath?(path: string): string | undefined;
	settings?: {
		iconInTabsEnabled?: boolean;
		iconInFrontmatterFieldName?: string;
	};
}

/**
 * Shrinks pinned tabs that carry an Iconize icon down to icon-only. Real Pin
 * never renders icons or touches Iconize's nodes — it only toggles a marker
 * class (which the bundled `styles.css` styles) and an `aria-label` on the tab
 * header, then clears both on teardown.
 */
export class CompactPinnedTabs {
	private readonly plugin: RealPinPlugin;
	private started = false;

	constructor(plugin: RealPinPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Wire up the reconcile loop. Idempotent — safe to call more than once. Runs
	 * on `onLayoutReady` so tab headers exist for the first paint and we don't
	 * fight the `layout-change` storm of workspace deserialization.
	 */
	start(): void {
		if (this.started) return;
		this.started = true;

		const { workspace } = this.plugin.app;
		// One trailing-edge debounce shared by both events. `layout-change` is the
		// primary signal (pin/unpin, open/close/move); `active-leaf-change` is a
		// safety net for deferred/focus re-renders. A per-leaf `pinned-change`
		// listener would be redundant with `layout-change` and only add leak surface.
		const onChange = debounce(() => this.refresh(), 50, true);
		this.plugin.registerEvent(workspace.on("layout-change", onChange));
		this.plugin.registerEvent(workspace.on("active-leaf-change", onChange));

		this.refresh();
	}

	/**
	 * Reconcile every tab to the current setting. Reads the live setting each
	 * time, so toggling takes effect immediately. Collapses to `clearAll()`
	 * whenever the feature can't apply (setting off, or Iconize absent / not
	 * painting tab icons).
	 */
	refresh(): void {
		const iconize = this.getIconize();
		if (!this.plugin.settings.compactPinnedTabs || !iconize) {
			this.clearAll();
			return;
		}
		// `iterateRootLeaves` covers the main window and popouts; sidebars are
		// excluded by design (their tabs aren't part of the pinned-tab strip).
		this.plugin.app.workspace.iterateRootLeaves((leaf) => {
			this.reconcile(leaf, iconize);
		});
	}

	/** Remove every marker + aria-label we set, across all leaves and windows. */
	clearAll(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const header = (leaf as unknown as LeafWithTabHeader).tabHeaderEl;
			// Only touch headers we actually compacted, so we never clobber an
			// aria-label set by something else.
			if (!header?.classList.contains(COMPACT_MARKER)) return;
			header.classList.remove(COMPACT_MARKER);
			header.removeAttribute("aria-label");
		});
	}

	private reconcile(leaf: WorkspaceLeaf, iconize: IconizePlugin): void {
		const header = (leaf as unknown as LeafWithTabHeader).tabHeaderEl;
		if (!header) return;

		const on = shouldCompact({
			pinned: leaf.getViewState().pinned ?? false,
			hasIcon: this.hasAssignedIcon(leaf, iconize),
			shrinkAll: SHRINK_ALL_PINNED,
		});

		// `toggle(cls, force)` auto-removes the marker from tabs that stop
		// qualifying, so no separate tracking is needed.
		header.classList.toggle(COMPACT_MARKER, on);
		if (on) header.setAttribute("aria-label", leaf.getDisplayText());
		else header.removeAttribute("aria-label");
	}

	/**
	 * Iconize, but only when it would actually be painting tab icons — i.e. it's
	 * installed/enabled (`getPlugin` returns the instance only then) and its
	 * `iconInTabsEnabled` setting isn't off. Otherwise `null`, so the feature
	 * stays inert instead of hiding titles with nothing to show.
	 */
	private getIconize(): IconizePlugin | null {
		const instance = (
			this.plugin.app as unknown as {
				plugins: { getPlugin(id: string): unknown };
			}
		).plugins.getPlugin("obsidian-icon-folder");
		if (!instance) return null;
		const iconize = instance as IconizePlugin;
		if (iconize.settings?.iconInTabsEnabled === false) return null;
		return iconize;
	}

	/**
	 * Whether this leaf's file has an Iconize icon. Checks Iconize's path map and
	 * falls back to the frontmatter field, because `getIconNameFromPath` is
	 * path-map-only and would miss frontmatter-assigned icons Iconize still renders.
	 */
	private hasAssignedIcon(leaf: WorkspaceLeaf, iconize: IconizePlugin): boolean {
		// `file` lives on `FileView`, not the base `View`; read it defensively.
		const file = (leaf.view as { file?: TFile }).file;
		if (!file) return false;

		if (
			typeof iconize.getIconNameFromPath === "function" &&
			iconize.getIconNameFromPath(file.path)
		) {
			return true;
		}

		const fieldName = iconize.settings?.iconInFrontmatterFieldName ?? "icon";
		const frontmatter =
			this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		return frontmatter?.[fieldName] != null;
	}
}
