import { App, PluginSettingTab, Setting } from "obsidian";
import type WorkBuddyPlugin from "./main";

export interface WorkBuddySettings {
	port: number;
	host: string;
	evalEnabled: boolean;
	evalTimeoutMs: number;
	dashboardPort: number;
}

export const DEFAULT_SETTINGS: WorkBuddySettings = {
	port: 27125,
	host: "127.0.0.1",
	evalEnabled: true,
	evalTimeoutMs: 10000,
	dashboardPort: 5127,
};

export class WorkBuddySettingTab extends PluginSettingTab {
	plugin: WorkBuddyPlugin;

	constructor(app: App, plugin: WorkBuddyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Bridge configuration").setHeading();

		new Setting(containerEl)
			.setName("Port")
			.setDesc("HTTP server port. Restart plugin after changing.")
			.addText((text) =>
				text
					.setPlaceholder("27125")
					.setValue(String(this.plugin.settings.port))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
							this.plugin.settings.port = parsed;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Dashboard port")
			.setDesc(
				"Port of the work-buddy dashboard service used for inline commands. " +
				"Restart plugin after changing."
			)
			.addText((text) =>
				text
					.setPlaceholder("5127")
					.setValue(String(this.plugin.settings.dashboardPort))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
							this.plugin.settings.dashboardPort = parsed;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Enable eval endpoint")
			.setDesc(
				"Allow executing arbitrary JavaScript via POST /eval. " +
				"Powerful but use with care — localhost only."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.evalEnabled)
					.onChange(async (value) => {
						this.plugin.settings.evalEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Eval timeout (ms)")
			.setDesc("Maximum execution time for eval requests.")
			.addText((text) =>
				text
					.setPlaceholder("10000")
					.setValue(String(this.plugin.settings.evalTimeoutMs))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0) {
							this.plugin.settings.evalTimeoutMs = parsed;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
