import { Editor, MarkdownView, Menu, Notice, TFile, requestUrl } from "obsidian";
import type WorkBuddyPlugin from "./main";
import { HintModal } from "./hintModal";

interface InlineCommand {
	command: string;
	label: string;
	description?: string;
	icon?: string;
	surface?: string[];
}

const MANIFEST_REFRESH_MS = 60_000;

export function registerInlineMenu(plugin: WorkBuddyPlugin): void {
	let cachedCommands: InlineCommand[] = [];

	const dashboardUrl = (path: string): string =>
		`http://127.0.0.1:${plugin.settings.dashboardPort}${path}`;

	const refreshManifest = async (): Promise<void> => {
		try {
			const res = await requestUrl({
				url: dashboardUrl("/inline/menu-manifest"),
				method: "GET",
				throw: false,
			});
			if (res.status < 200 || res.status >= 300) {
				console.debug(
					"[work-buddy] inline menu manifest fetch non-OK:",
					res.status
				);
				return;
			}
			const data = res.json as { commands?: InlineCommand[] };
			cachedCommands = Array.isArray(data.commands) ? data.commands : [];
		} catch (err) {
			console.debug("[work-buddy] inline menu manifest fetch failed:", err);
		}
	};

	// Initial fetch + periodic refresh
	void refreshManifest();
	plugin.registerInterval(
		window.setInterval(() => {
			void refreshManifest();
		}, MANIFEST_REFRESH_MS)
	);

	plugin.registerEvent(
		plugin.app.workspace.on(
			"editor-menu",
			(menu: Menu, editor: Editor, view: MarkdownView) => {
				const file = view.file;
				if (!file) return;

				const menuCommands = cachedCommands.filter(
					(cmd) =>
						!cmd.surface ||
						cmd.surface.length === 0 ||
						cmd.surface.includes("menu")
				);
				if (menuCommands.length === 0) return;

				for (const cmd of menuCommands) {
					menu.addItem((item) => {
						item.setTitle(`Work Buddy: ${cmd.label}`);
						if (cmd.icon) item.setIcon(cmd.icon);
						item.onClick(async () => {
							const selection = editor.getSelection();

							// Optional hint capture. User can press Escape to abort.
							const modal = new HintModal(plugin.app, !!selection);
							modal.open();
							const hint = await modal.result;
							if (hint === null) return; // cancelled

							const cursor = editor.getCursor();
							const payload = {
								file_path: file.path,
								selection,
								cursor_line: cursor.line,
								cursor_ch: cursor.ch,
								full_text: editor.getValue(),
								hint,
							};
							try {
								const res = await requestUrl({
									url: dashboardUrl("/inline/invoke"),
									method: "POST",
									contentType: "application/json",
									body: JSON.stringify({
										command: cmd.command,
										surface: "menu",
										payload,
									}),
									throw: false,
								});
								if (res.status >= 200 && res.status < 300) {
									new Notice("Work Buddy: sent to Review");
								} else {
									new Notice(
										`Work Buddy: error (${res.status})`
									);
								}
							} catch (err) {
								console.debug(
									"[work-buddy] inline invoke failed:",
									err
								);
								new Notice("Work Buddy: dashboard unreachable");
							}
						});
					});
				}
				// Touch to keep TFile referenced (appease linter)
				void (file as TFile);
			}
		)
	);
}
