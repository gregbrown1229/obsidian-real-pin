import { debounce } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import type RealPinPlugin from "./main";
import { COMPACT_MARKER, SHRINK_ALL_PINNED, shouldCompact } from "./compactPolicy";

/** CSS variable `styles.css` reads for the compacted tab's max-width. */
const WIDTH_VAR = "--real-pin-compact-tab-width";

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
	/** The main window's document, captured at start so width updates always land there. */
	private compactDoc: Document | null = null;

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
		// One trailing-edge debounce shared by every trigger. `layout-change` is the
		// primary signal (pin/unpin, open/close/move); `active-leaf-change` is a
		// safety net for deferred/focus re-renders. A per-leaf `pinned-change`
		// listener would be redundant with `layout-change` and only add leak surface.
		const onChange = debounce(() => this.refresh(), 50, true);
		this.plugin.registerEvent(workspace.on("layout-change", onChange));
		this.plugin.registerEvent(workspace.on("active-leaf-change", onChange));

		// Iconize loads its data and paints tab icons asynchronously — often after
		// our first reconcile — so a pinned tab can gain its icon a beat later and
		// otherwise never compact (the "sometimes it doesn't shrink" race). Watch
		// for tab-header DOM changes and re-reconcile. We observe `childList` only
		// (not attributes), so our own marker-class toggles can't re-trigger us, and
		// the callback ignores mutations outside a tab header so editor churn is free.
		this.compactDoc = activeDocument;
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				const target = record.target;
				if (
					target.instanceOf(Element) &&
					target.closest(".workspace-tab-header-container")
				) {
					onChange();
					return;
				}
			}
		});
		observer.observe(this.compactDoc.body, { childList: true, subtree: true });
		this.plugin.register(() => observer.disconnect());

		this.applyWidth();
		this.plugin.register(() => this.clearWidth());

		this.refresh();
	}

	/**
	 * Push the configured compact width into the `--real-pin-compact-tab-width` CSS
	 * variable that `styles.css` reads. Driven by the settings slider; called on
	 * start and on every change so it updates live.
	 */
	applyWidth(): void {
		// Setting a CSS *variable* (a config value the stylesheet consumes), not a
		// static visual style — the width is user-tunable, so it can't live in
		// styles.css.
		this.compactDoc?.body.style.setProperty(
			WIDTH_VAR,
			`${this.plugin.settings.compactTabWidth}px`,
		);
	}

	private clearWidth(): void {
		this.compactDoc?.body.style.removeProperty(WIDTH_VAR);
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
