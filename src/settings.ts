import { App, PluginSettingTab, Setting } from "obsidian";
import type RealPinPlugin from "./main";

export interface RealPinSettings {
	/**
	 * When true, closing a pinned tab via a hotkey/command shows a confirmation
	 * modal. When false, that close is blocked outright (no modal, never closes).
	 */
	confirmBeforeClose: boolean;

	/**
	 * When true, pinned tabs shrink to icon-only (title hidden). Pure CSS, keyed
	 * on Obsidian's own pin element — no dependency on any other plugin. A pinned
	 * tab with an Iconize (or similar) icon reads as that icon; one without shows
	 * Obsidian's default file icon.
	 */
	compactPinnedTabs: boolean;

	/**
	 * How narrow a compacted pinned tab shrinks to, in pixels. Applied as the
	 * tab's max-width via the `--real-pin-compact-tab-width` CSS variable, since
	 * Obsidian's tab layout won't size tabs to their content.
	 */
	compactTabWidth: number;

	/**
	 * When true, Chrome-style tab groups are active: tabs can be organized into
	 * named, colored, collapsible groups within the tab bar. Off by default
	 * (opt-in), since it injects a chip + tags tab headers in the tab strip.
	 */
	enableTabGroups: boolean;
}

/** Bounds for the compact-tab-width slider (pixels). */
export const COMPACT_WIDTH_MIN = 40;
export const COMPACT_WIDTH_MAX = 200;
export const COMPACT_WIDTH_STEP = 2;
export const COMPACT_WIDTH_DEFAULT = 72;

export const DEFAULT_SETTINGS: RealPinSettings = {
	confirmBeforeClose: true,
	compactPinnedTabs: false,
	compactTabWidth: COMPACT_WIDTH_DEFAULT,
	enableTabGroups: false,
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

		this.addCompactPinnedTabsSetting(containerEl);
		this.addTabGroupsSetting(containerEl);
	}

	private addTabGroupsSetting(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Tab groups").setHeading();

		new Setting(containerEl)
			.setName("Enable tab groups")
			.setDesc(
				"Organize tabs into named, colored, collapsible Chrome-style groups in the " +
					"tab bar. Group a tab from its command or the group chip's menu, then drag " +
					"tabs in or out. Takes effect immediately.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableTabGroups)
					.onChange(async (value) => {
						this.plugin.settings.enableTabGroups = value;
						await this.plugin.saveSettings();
						this.plugin.tabGroups.apply();
					}),
			);
	}

	private addCompactPinnedTabsSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Compact pinned tabs")
			.setDesc(
				"Shrink pinned tabs to icon-only (hover shows the title). For a row of " +
					"distinct icons, assign them with a plugin like Iconize — a pinned tab " +
					"without one shows Obsidian's default file icon. Takes effect immediately.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.compactPinnedTabs)
					.onChange(async (value) => {
						this.plugin.settings.compactPinnedTabs = value;
						await this.plugin.saveSettings();
						// Apply live (undebounced) so the toggle feels instant.
						this.plugin.compactTabs.apply();
					}),
			);

		new Setting(containerEl)
			.setName("Compact tab width")
			.setDesc(
				"How narrow a compacted pinned tab shrinks to (pixels). Increase it if " +
					"a wider icon or the unpin button looks cramped.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(COMPACT_WIDTH_MIN, COMPACT_WIDTH_MAX, COMPACT_WIDTH_STEP)
					.setValue(this.plugin.settings.compactTabWidth)
					.onChange(async (value) => {
						this.plugin.settings.compactTabWidth = value;
						await this.plugin.saveSettings();
						// Live update the CSS variable the stylesheet reads.
						this.plugin.compactTabs.apply();
					}),
			);
	}
}
