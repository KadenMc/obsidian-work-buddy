import { App, Modal, Setting } from "obsidian";

/**
 * Single-line hint capture. Caller `await`s `.result`:
 *   - Promise resolves to the trimmed string on Send/Enter (empty string is valid)
 *   - Promise resolves to `null` on Escape / Cancel (abort the whole flow)
 */
export class HintModal extends Modal {
	private resolve!: (value: string | null) => void;
	private resolved = false;
	readonly result: Promise<string | null> = new Promise(
		(r) => (this.resolve = r),
	);
	private hasSelection: boolean;

	constructor(app: App, hasSelection: boolean) {
		super(app);
		this.hasSelection = hasSelection;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Send to agent" });

		contentEl.createEl("p", {
			text: this.hasSelection
				? "Optional: tell the agent what you're after. Leave blank to send just the selection."
				: "Optional: add a hint. No selection will be sent.",
			cls: "wb-hint-help",
		});

		const inputEl = contentEl.createEl("input", {
			type: "text",
			cls: "wb-hint-input",
			attr: {
				placeholder: this.hasSelection
					? "Optional hint..."
					: "Optional hint (no selection)",
			},
		});

		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit(inputEl.value);
			}
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Send")
					.setCta()
					.onClick(() => this.submit(inputEl.value)),
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close()),
			);

		// Defer focus so Obsidian finishes rendering the modal first.
		window.setTimeout(() => inputEl.focus(), 0);
	}

	onClose(): void {
		if (!this.resolved) {
			this.resolved = true;
			this.resolve(null);
		}
		this.contentEl.empty();
	}

	private submit(value: string): void {
		if (!this.resolved) {
			this.resolved = true;
			this.resolve(value.trim());
		}
		this.close();
	}
}
