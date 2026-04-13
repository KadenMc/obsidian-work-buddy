import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, WorkBuddySettingTab } from "./settings";
import type { WorkBuddySettings } from "./settings";
import { BridgeServer } from "./server";
import {
	healthHandler,
	tagsHandler,
	tagFilesHandler,
	filesReadHandler,
	filesWriteHandler,
	metadataHandler,
	searchHandler,
	evalHandler,
	workspaceHandler,
	notificationShowHandler,
	notificationStatusHandler,
	notificationDismissHandler,
	notificationAcknowledgeHandler,
	notificationOpenDashboardHandler,
} from "./handlers";

export default class WorkBuddyPlugin extends Plugin {
	settings: WorkBuddySettings;
	private bridge: BridgeServer | null = null;
	private statusBarEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Settings tab
		this.addSettingTab(new WorkBuddySettingTab(this.app, this));

		// Status bar — clickable "WB Dash" link to open/focus dashboard
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.setText("WB: starting...");
		this.statusBarEl.addClass("mod-clickable");
		this.registerDomEvent(this.statusBarEl, "click", () => {
			fetch(`http://127.0.0.1:${this.settings.port}/notifications/open-dashboard`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ view_id: "dashboard" }),
			}).catch(() => {});
		});

		// Defer server start until layout is ready (Obsidian perf guidance)
		this.app.workspace.onLayoutReady(() => {
			this.startBridge();
		});
	}

	async onunload() {
		await this.stopBridge();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<WorkBuddySettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.bridge) {
			this.bridge.updateSettings(this.settings);
		}
	}

	private async startBridge() {
		try {
			this.bridge = new BridgeServer(this.app, this.settings);

			// Register all routes
			this.bridge.route("GET", "/health", healthHandler);
			this.bridge.route("GET", "/tags", tagsHandler);
			this.bridge.route("GET", "/tags/:tag", tagFilesHandler);
			this.bridge.route("GET", "/files/:path", filesReadHandler);
			this.bridge.route("PUT", "/files/:path", filesWriteHandler);
			this.bridge.route("GET", "/metadata/:path", metadataHandler);
			this.bridge.route("GET", "/search", searchHandler);
			this.bridge.route("POST", "/eval", evalHandler);
			this.bridge.route("GET", "/workspace", workspaceHandler);

			// Notification / request endpoints
			this.bridge.route("POST", "/notifications/show", notificationShowHandler);
			this.bridge.route("GET", "/notifications/status/:id", notificationStatusHandler);
			this.bridge.route("POST", "/notifications/dismiss", notificationDismissHandler);
			this.bridge.route("POST", "/notifications/acknowledge", notificationAcknowledgeHandler);
			this.bridge.route("POST", "/notifications/open-dashboard", notificationOpenDashboardHandler);

			await this.bridge.start(this.settings.port, this.settings.host);

			if (this.statusBarEl) {
				this.statusBarEl.setText("WB Dash");
			}
			console.log(
				`[work-buddy] Bridge server listening on ${this.settings.host}:${this.settings.port}`
			);
		} catch (err) {
			const msg =
				err instanceof Error ? err.message : String(err);
			console.error(`[work-buddy] Failed to start bridge: ${msg}`);
			new Notice(`Work Buddy: Failed to start bridge server — ${msg}`);
			if (this.statusBarEl) {
				this.statusBarEl.setText("WB Dash \u26a0");
			}
		}
	}

	private async stopBridge() {
		if (this.bridge) {
			await this.bridge.stop();
			this.bridge = null;
			console.log("[work-buddy] Bridge server stopped.");
		}
	}
}
