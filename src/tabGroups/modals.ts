import { App, Modal, Setting, SuggestModal } from "obsidian";
import { GROUP_COLORS } from "./model";
import type { GroupColor, TabGroup } from "./model";

export interface GroupEditResult {
	name: string;
	color: GroupColor;
}

/**
 * Edit a group's name and color. Mirrors `ConfirmCloseModal`'s promise-based
 * `ask()`: resolves the chosen values, or `null` on cancel/Esc/click-outside.
 * The color swatches reuse the same `data-rp-color` → `--rp-c` mapping in
 * `styles.css` as the chips, so there's one source of truth for the palette.
 */
export class GroupEditModal extends Modal {
	private resolve!: (result: GroupEditResult | null) => void;
	private settled = false;
	private name: string;
	private readonly initialName: string;
	private color: GroupColor;
	private readonly heading: string;

	constructor(app: App, initial: GroupEditResult, heading = "Edit group") {
		super(app);
		this.name = initial.name;
		this.initialName = initial.name;
		this.color = initial.color;
		this.heading = heading;
	}

	ask(): Promise<GroupEditResult | null> {
		this.open();
		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);

		new Setting(this.contentEl).setName("Name").addText((text) => {
			text.setValue(this.name).onChange((v) => {
				this.name = v;
			});
			window.setTimeout(() => text.inputEl.select(), 0);
		});

		const swatches = new Map<GroupColor, HTMLElement>();
		const select = (color: GroupColor): void => {
			this.color = color;
			for (const [c, el] of swatches) el.toggleClass("is-selected", c === color);
		};
		new Setting(this.contentEl).setName("Color").then((setting) => {
			const row = setting.controlEl.createDiv({ cls: "real-pin-color-swatches" });
			for (const color of GROUP_COLORS) {
				const swatch = row.createDiv({ cls: "real-pin-color-swatch" });
				swatch.dataset.rpColor = color;
				swatch.setAttribute("role", "button");
				swatch.setAttribute("aria-label", color);
				swatch.tabIndex = 0;
				swatch.addEventListener("click", () => select(color));
				swatch.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						select(color);
					}
				});
				swatches.set(color, swatch);
			}
			select(this.color);
		});

		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => {
					this.settle(null);
					this.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						this.settle({
							name: this.name.trim() || this.initialName,
							color: this.color,
						});
						this.close();
					}),
			);
	}

	onClose(): void {
		this.settle(null);
		this.contentEl.empty();
	}

	private settle(result: GroupEditResult | null): void {
		if (this.settled) return;
		this.settled = true;
		this.resolve(result);
	}
}

/** A choice in the "add tab to group" picker: an existing group, or a new one. */
export type GroupChoice = { kind: "new" } | { kind: "group"; group: TabGroup };

/** Pick a group to add the active tab to (or "New group"). */
export class GroupSuggestModal extends SuggestModal<GroupChoice> {
	private readonly choices: GroupChoice[];
	private readonly onChoose: (choice: GroupChoice) => void;

	constructor(
		app: App,
		groups: readonly TabGroup[],
		onChoose: (choice: GroupChoice) => void,
	) {
		super(app);
		this.choices = [
			{ kind: "new" },
			...groups.map((group): GroupChoice => ({ kind: "group", group })),
		];
		this.onChoose = onChoose;
		this.setPlaceholder("Add tab to group…");
	}

	getSuggestions(query: string): GroupChoice[] {
		const q = query.toLowerCase();
		return this.choices.filter(
			(c) => c.kind === "new" || c.group.name.toLowerCase().includes(q),
		);
	}

	renderSuggestion(choice: GroupChoice, el: HTMLElement): void {
		if (choice.kind === "new") {
			el.setText("New group");
			return;
		}
		const wrap = el.createDiv({ cls: "real-pin-suggest-group" });
		const dot = wrap.createSpan({ cls: "real-pin-color-swatch is-dot" });
		dot.dataset.rpColor = choice.group.color;
		wrap.createSpan({ text: choice.group.name });
	}

	onChooseSuggestion(choice: GroupChoice): void {
		this.onChoose(choice);
	}
}
