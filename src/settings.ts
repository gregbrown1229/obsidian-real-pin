import { App, PluginSettingTab, Setting } from "obsidian";
import type RealPinPlugin from "./main";

export interface RealPinSettings {
	/**
	 * When true, closing a pinned tab via a hotkey/command shows a confirmation
	 * modal. When false, that close is blocked outright (no modal, never closes).
	 */
	confirmBeforeClose: boolean;

	/**
	 * When true, pinned tabs that have an Iconize-assigned icon shrink to
	 * icon-only (title hidden). Requires the Iconize plugin with its "Toggle icon
	 * in tabs" setting on; otherwise the feature stays inert.
	 */
	compactPinnedTabs: boolean;

	/**
	 * How narrow a compacted pinned tab shrinks to, in pixels. Applied as the
	 * tab's max-width via the `--real-pin-compact-tab-width` CSS variable, since
	 * Obsidian's tab layout won't size tabs to their content.
	 */
	compactTabWidth: number;
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
};

/** Iconize's community-plugin id; its presence gates the compact feature. */
const ICONIZE_ID = "obsidian-icon-folder";

/**
 * The sliver of Iconize we read in settings: only its tab-icon switch, so we can
 * hint the user when Iconize is installed but wouldn't be painting tab icons.
 */
interface IconizeForSettings {
	settings?: { iconInTabsEnabled?: boolean };
}

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
	}

	private addCompactPinnedTabsSetting(containerEl: HTMLElement): void {
		// `getPlugin` returns the instance only when Iconize is installed AND
		// enabled — exactly the gate we want. Reached via a narrow cast, mirroring
		// how `main.ts` casts `app` to reach `commands`.
		const iconize = (
			this.app as unknown as {
				plugins: { getPlugin(id: string): unknown };
			}
		).plugins.getPlugin(ICONIZE_ID) as IconizeForSettings | null;

		let desc =
			"Pinned tabs with an Iconize icon shrink to icon-only (hover shows the title). " +
			"Icon-less pinned tabs keep their title. Takes effect immediately.";
		if (!iconize) {
			desc += " Requires the Iconize plugin.";
		} else if (iconize.settings?.iconInTabsEnabled === false) {
			desc += " Enable Iconize's “Toggle icon in tabs” for this to apply.";
		}

		new Setting(containerEl)
			.setName("Compact pinned tabs")
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle
					.setDisabled(!iconize)
					.setValue(this.plugin.settings.compactPinnedTabs)
					.onChange(async (value) => {
						this.plugin.settings.compactPinnedTabs = value;
						await this.plugin.saveSettings();
						// Apply live (undebounced) so the toggle feels instant.
						this.plugin.compactTabs.refresh();
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
						this.plugin.compactTabs.applyWidth();
					}),
			);
	}
}
