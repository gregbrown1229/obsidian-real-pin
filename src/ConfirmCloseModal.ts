import { App, Modal, Setting } from "obsidian";

/**
 * A yes/no confirmation dialog that resolves a Promise<boolean> with the
 * user's choice. Resolves `true` only when the user explicitly confirms;
 * Esc, click-outside, or Cancel all resolve `false`.
 */
export class ConfirmCloseModal extends Modal {
	private resolve!: (confirmed: boolean) => void;
	private settled = false;

	constructor(app: App) {
		super(app);
	}

	/** Open the modal and await the user's decision. */
	ask(): Promise<boolean> {
		this.open();
		return new Promise<boolean>((resolve) => {
			this.resolve = resolve;
		});
	}

	onOpen(): void {
		this.titleEl.setText("Close pinned tab?");
		this.contentEl.createEl("p", {
			text: "This tab is pinned. Are you sure you want to close it?",
		});

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.settle(false);
					this.close();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Close tab")
					.setDestructive()
					.onClick(() => {
						this.settle(true);
						this.close();
					}),
			);
	}

	onClose(): void {
		// Always fires — covers Esc, click-outside, and button-triggered close.
		// `settle` is idempotent, so a prior button click wins.
		this.settle(false);
		this.contentEl.empty();
	}

	private settle(value: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolve(value);
	}
}
