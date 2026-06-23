import { Plugin } from "obsidian";
import { around } from "monkey-around";
import { ConfirmCloseModal } from "./ConfirmCloseModal";
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

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new RealPinSettingTab(this.app, this));
		this.patchCloseCommand();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<RealPinSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private patchCloseCommand(): void {
		const registry = (this.app as unknown as { commands: CommandsRegistry })
			.commands;
		const closeCmd = registry?.commands?.["workspace:close"];

		// If a future Obsidian renames the command or changes its callback form,
		// degrade to a no-op rather than throwing on load.
		if (typeof closeCmd?.checkCallback !== "function") return;

		const plugin = this;
		this.register(
			around(closeCmd as { checkCallback: CheckCallback }, {
				checkCallback: (next) =>
					function patchedCheckCallback(this: unknown, checking: boolean) {
						// Availability probe: defer to the original with no side
						// effects, so the command stays enabled exactly when it
						// normally would (pinned or not).
						if (checking) return next.call(this, true);

						const leaf = plugin.app.workspace.activeLeaf;
						// `getViewState().pinned` is the public read accessor for pin
						// state (the bare `leaf.pinned` field isn't typed).
						if (!leaf || !leaf.getViewState().pinned) {
							return next.call(this, false);
						}

						// Pinned. Read the setting live so toggling takes effect
						// immediately, without re-wrapping the command.
						if (!plugin.settings.confirmBeforeClose) {
							// Toggle off: block the close outright.
							return true;
						}

						// Confirm-first: gate the real close behind the modal.
						// Obsidian doesn't await command callbacks, so fire the modal
						// and run the original close only on confirm. Return true to
						// mark the invocation handled.
						void new ConfirmCloseModal(plugin.app)
							.ask()
							.then((confirmed) => {
								if (confirmed) next.call(this, false);
							});
						return true;
					},
			}),
		);
	}
}
