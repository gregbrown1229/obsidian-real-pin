import type RealPinPlugin from "./main";

/**
 * Body class that arms the compact-pinned-tabs rules in `styles.css`. The
 * stylesheet gates everything on this class, so the feature is fully inert until
 * it's present — toggled by the "Compact pinned tabs" setting.
 */
const ENABLE_CLASS = "real-pin-compact-pinned-tabs";

/** CSS variable `styles.css` reads for the compacted tab's max-width. */
const WIDTH_VAR = "--real-pin-compact-tab-width";

/**
 * Drives the "compact pinned tabs" feature — which is otherwise **pure CSS**.
 *
 * Obsidian renders a `.workspace-tab-header-status-icon.mod-pinned` element
 * inside a pinned tab's header (and only when pinned), so `styles.css` selects
 * pinned tabs directly with `:has(...)` and shrinks them. That means there's no
 * per-tab JavaScript at all — no pin/unpin listeners, no reconcile loop, no
 * reading another plugin's state. All this class does is reflect two settings
 * onto each window's `<body>`: the on/off enable class, and the width variable
 * the stylesheet reads. CSS does the rest, reactively.
 */
export class CompactPinnedTabs {
	private readonly plugin: RealPinPlugin;

	constructor(plugin: RealPinPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Apply the current settings and keep new popout windows in sync. Idempotent.
	 * Registers its own teardown, so unload (or disabling the plugin) reverts every
	 * window cleanly.
	 */
	start(): void {
		// A popout opened later has its own <body>; arm it when it appears.
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("window-open", () => this.apply()),
		);
		this.apply();
		this.plugin.register(() => this.clear());
	}

	/**
	 * Reflect the live settings onto every open window's `<body>`: toggle the
	 * enable class and set the width variable. Called on start, when a popout
	 * opens, and from the settings tab so the toggle/slider take effect instantly.
	 */
	apply(): void {
		const { compactPinnedTabs, compactTabWidth } = this.plugin.settings;
		for (const body of this.bodies()) {
			body.classList.toggle(ENABLE_CLASS, compactPinnedTabs);
			body.style.setProperty(WIDTH_VAR, `${compactTabWidth}px`);
		}
	}

	/** Remove the enable class + width variable from every window. */
	clear(): void {
		for (const body of this.bodies()) {
			body.classList.remove(ENABLE_CLASS);
			body.style.removeProperty(WIDTH_VAR);
		}
	}

	/**
	 * Every open window's `<body>` — the main window plus any popouts. Popout
	 * leaves live in their own document, so we reach each via a leaf's view
	 * element (`containerEl.ownerDocument`), all public DOM/API.
	 */
	private bodies(): Set<HTMLElement> {
		const bodies = new Set<HTMLElement>([activeDocument.body]);
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			bodies.add(leaf.view.containerEl.ownerDocument.body);
		});
		return bodies;
	}
}
