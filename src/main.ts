import { Plugin, View } from "obsidian";
import { around } from "monkey-around";
import { ConfirmCloseModal } from "./ConfirmCloseModal";
import { CompactPinnedTabs } from "./compactPinnedTabs";
import { TabGroupController } from "./tabGroups/controller";
import { migrateData } from "./tabGroups/model";
import type {
	PersistedData,
	PersistedLiveGroup,
	SavedTabGroup,
} from "./tabGroups/model";
import {
	DEFAULT_SETTINGS,
	RealPinSettings,
	RealPinSettingTab,
} from "./settings";

/**
 * Obsidian's internal command registry isn't part of the public type surface.
 * We model only the sliver we touch — the `workspace:close` command, which is
 * registered with a `checkCallback` — and isolate the unavoidable cast here.
 */
type CheckCallback = (checking: boolean) => unknown;
type CloseCommand = { checkCallback?: CheckCallback };
type CommandsRegistry = { commands: Record<string, CloseCommand | undefined> };

export default class RealPinPlugin extends Plugin {
	settings!: RealPinSettings;
	compactTabs!: CompactPinnedTabs;
	tabGroups!: TabGroupController;
	private data!: PersistedData<RealPinSettings>;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new RealPinSettingTab(this.app, this));
		this.patchCloseCommand();

		// Compact pinned tabs: start once the layout is ready (so any open popout
		// windows are picked up). `start()` registers its own teardown, reverting
		// every window on unload.
		this.compactTabs = new CompactPinnedTabs(this);
		this.app.workspace.onLayoutReady(() => this.compactTabs.start());

		// Tab groups: same lifecycle — start once the layout is ready so existing
		// tabs/popouts are picked up; `start()` registers its own teardown.
		this.tabGroups = new TabGroupController(this);
		this.app.workspace.onLayoutReady(() => this.tabGroups.start());

		this.addCommand({
			id: "new-tab-group",
			name: "New tab group from active tab",
			callback: () => this.tabGroups.createGroupFromActiveLeaf(),
		});
		this.addCommand({
			id: "add-tab-to-group",
			name: "Add active tab to group",
			callback: () => this.tabGroups.addActiveLeafToGroupPrompt(),
		});
		this.addCommand({
			id: "edit-tab-group",
			name: "Edit the active tab's group (name and color)",
			callback: () => this.tabGroups.editActiveGroup(),
		});
		this.addCommand({
			id: "toggle-tab-group-collapse",
			name: "Toggle collapse of the active tab's group",
			callback: () => this.tabGroups.toggleCollapseActive(),
		});
	}

	async loadSettings(): Promise<void> {
		this.data = migrateData(await this.loadData(), DEFAULT_SETTINGS);
		this.settings = this.data.settings;
	}

	async saveSettings(): Promise<void> {
		this.data.settings = this.settings;
		await this.saveData(this.data);
	}

	// Tab-group persistence. Live groups are rebound to leaves on reload; saved
	// groups are the user's reopenable library. Both share the one data file.
	getLiveGroups(): PersistedLiveGroup[] {
		return this.data.liveGroups;
	}

	async saveLiveGroups(groups: PersistedLiveGroup[]): Promise<void> {
		this.data.liveGroups = groups;
		await this.saveData(this.data);
	}

	getSavedGroups(): SavedTabGroup[] {
		return this.data.savedGroups;
	}

	async saveSavedGroups(groups: SavedTabGroup[]): Promise<void> {
		this.data.savedGroups = groups;
		await this.saveData(this.data);
	}

	private patchCloseCommand(): void {
		const registry = (this.app as unknown as { commands: CommandsRegistry })
			.commands;
		const closeCmd = registry?.commands?.["workspace:close"];

		// If a future Obsidian renames the command or changes its callback form,
		// degrade to a no-op rather than throwing on load.
		if (typeof closeCmd?.checkCallback !== "function") return;

		// Capture what the wrapper needs as locals rather than aliasing `this`,
		// so the patched function keeps its own `this` (the command object) for
		// `next.call`. `settings` is mutated in place by the settings tab, so
		// reads through this reference stay live.
		const { app, settings } = this;

		this.register(
			around(closeCmd as { checkCallback: CheckCallback }, {
				checkCallback: (next) =>
					function patchedCheckCallback(this: unknown, checking: boolean) {
						// Availability probe: defer to the original with no side
						// effects, so the command stays enabled exactly when it
						// normally would (pinned or not).
						if (checking) return next.call(this, true);

						// The active view's leaf is the tab the close command targets.
						const leaf = app.workspace.getActiveViewOfType(View)?.leaf;
						// `getViewState().pinned` is the public read accessor for pin
						// state (the bare `leaf.pinned` field isn't typed).
						if (!leaf || !leaf.getViewState().pinned) {
							return next.call(this, false);
						}

						// Pinned. Read the setting live so toggling takes effect
						// immediately, without re-wrapping the command.
						if (!settings.confirmBeforeClose) {
							// Toggle off: block the close outright.
							return true;
						}

						// Confirm-first: gate the real close behind the modal.
						// Obsidian doesn't await command callbacks, so fire the modal
						// and run the original close only on confirm. Return true to
						// mark the invocation handled.
						void new ConfirmCloseModal(app).ask().then((confirmed) => {
							if (confirmed) next.call(this, false);
						});
						return true;
					},
			}),
		);
	}
}
