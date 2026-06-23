import { App, PluginSettingTab, Setting } from "obsidian";
import type RealPinPlugin from "./main";

export interface RealPinSettings {
	/**
	 * When true, closing a pinned tab via a hotkey/command shows a confirmation
	 * modal. When false, that close is blocked outright (no modal, never closes).
	 */
	confirmBeforeClose: boolean;
}

export const DEFAULT_SETTINGS: RealPinSettings = {
	confirmBeforeClose: true,
};

export class RealPinSettingTab extends PluginSettingTab {
	private plugin: RealPinPlugin;

	constructor(app: App, plugin: RealPinPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Confirm before closing a pinned tab")
			.setDesc(
				"On: closing a pinned tab via a hotkey or command asks for confirmation. " +
					"Off: closing a pinned tab that way is blocked entirely.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.confirmBeforeClose)
					.onChange(async (value) => {
						this.plugin.settings.confirmBeforeClose = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
