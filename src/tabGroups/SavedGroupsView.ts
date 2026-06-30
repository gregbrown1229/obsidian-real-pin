import { ItemView, Menu, WorkspaceLeaf, setIcon } from "obsidian";
import type RealPinPlugin from "../main";
import type { SavedMember } from "./model";

export const VIEW_TYPE_SAVED_GROUPS = "real-pin-saved-groups";

/** Sidebar panel listing the saved-group library (Chrome's "saved groups"). */
export class SavedGroupsView extends ItemView {
	private readonly plugin: RealPinPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: RealPinPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SAVED_GROUPS;
	}

	getDisplayText(): string {
		return "Saved tab groups";
	}

	getIcon(): string {
		return "layers";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	/** Rebuild the list. Called on open and whenever saved groups change. */
	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("real-pin-saved-groups");

		const saved = this.plugin.getSavedGroups();
		if (saved.length === 0) {
			root.createEl("p", {
				cls: "real-pin-saved-empty",
				text: "No saved groups yet. Create a tab group, then save it from the chip menu.",
			});
			return;
		}

		for (const group of saved) {
			const row = root.createDiv({ cls: "real-pin-saved-group" });

			const header = row.createDiv({ cls: "real-pin-saved-group-header" });
			const dot = header.createSpan({ cls: "real-pin-color-swatch is-dot" });
			dot.dataset.rpColor = group.color;
			header.createSpan({
				cls: "real-pin-saved-group-name",
				text: group.name,
			});
			header.createSpan({
				cls: "real-pin-saved-group-count",
				text: `${group.members.length}`,
			});

			const actions = row.createDiv({ cls: "real-pin-saved-group-actions" });
			const openBtn = actions.createEl("button", {
				cls: "mod-cta",
				text: "Open",
			});
			openBtn.addEventListener("click", () => {
				void this.plugin.tabGroups.openSavedGroup(group.id);
			});
			const moreBtn = actions.createEl("button", {
				attr: { "aria-label": "More actions" },
			});
			setIcon(moreBtn, "more-vertical");
			moreBtn.addEventListener("click", (evt) =>
				this.showMenu(group.id, evt),
			);

			const list = row.createEl("ul", {
				cls: "real-pin-saved-group-members",
			});
			for (const member of group.members) {
				list.createEl("li", { text: memberLabel(member) });
			}
		}
	}

	private showMenu(savedId: string, evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Open")
				.setIcon("layout-grid")
				.onClick(() => void this.plugin.tabGroups.openSavedGroup(savedId)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Update from open group")
				.setIcon("refresh-cw")
				.onClick(() => this.plugin.tabGroups.updateSavedFromLinked(savedId)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Edit name and color…")
				.setIcon("pencil")
				.onClick(() => this.plugin.tabGroups.editSavedGroup(savedId)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => this.plugin.tabGroups.deleteSavedGroup(savedId)),
		);
		menu.showAtMouseEvent(evt);
	}
}

/** A readable label for a saved member: the note's basename, else the view type. */
function memberLabel(member: SavedMember): string {
	const file = member.viewState.state?.file;
	if (typeof file === "string") {
		const base = file.split("/").pop() ?? file;
		return base.replace(/\.md$/, "");
	}
	return member.viewState.type;
}
