import http from "http";
import { App, Modal, Notice, Setting, getAllTags, MarkdownView, TFile } from "obsidian";
import type { WorkBuddySettings } from "./settings";
import type { HandlerResult, RouteParams } from "./server";

// Convenience type alias for handler args
type HArgs = [App, WorkBuddySettings, unknown, RouteParams, URLSearchParams];

/** Plugin version — keep in sync with manifest.json */
const PLUGIN_VERSION = "0.1.1";

/**
 * Compatible work-buddy version range for this plugin release.
 * When work-buddy sends wb_version and it's outside this range,
 * we log a console warning so the user knows an update may be needed.
 * This is a courtesy — the plugin doesn't enforce it.
 */
const WB_VERSION_MIN = "0.1.0";  // oldest work-buddy tested against
const WB_VERSION_MAX = "0.2.0";  // first work-buddy version NOT tested

/**
 * Compare two semver strings. Returns -1 (a<b), 0 (equal), or 1 (a>b).
 */
function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if ((pa[i] || 0) < (pb[i] || 0)) return -1;
		if ((pa[i] || 0) > (pb[i] || 0)) return 1;
	}
	return 0;
}

/**
 * Send an HTTP request to a localhost service. Fire-and-forget pattern:
 * resolves on response, logs errors but doesn't throw.
 */
function localPost(
	port: number,
	path: string,
	payload: string,
	label: string
): Promise<number | null> {
	return new Promise((resolve) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
				},
				timeout: 5000,
			},
			(res: http.IncomingMessage) => {
				// Drain the response body so the socket is freed
				res.resume();
				console.debug(`[work-buddy] ${label} → ${res.statusCode ?? "unknown"}`);
				resolve(res.statusCode ?? null);
			}
		);
		req.on("error", (err: Error) => {
			console.warn(`[work-buddy] ${label} failed: ${err.message}`);
			resolve(null);
		});
		req.write(payload);
		req.end();
	});
}

/**
 * Send an HTTP request to a localhost service and collect the response body.
 */
function localPostWithBody(
	port: number,
	path: string,
	payload: string,
	label: string
): Promise<{ statusCode: number | null; body: string }> {
	return new Promise((resolve) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
				},
				timeout: 15000,
			},
			(res: http.IncomingMessage) => {
				let respData = "";
				res.setEncoding("utf-8");
				res.on("data", (chunk: string) => (respData += chunk));
				res.on("end", () => {
					console.debug(`[work-buddy] ${label} → ${res.statusCode ?? "unknown"}`);
					resolve({ statusCode: res.statusCode ?? null, body: respData });
				});
			}
		);
		req.on("error", (err: Error) => {
			console.warn(`[work-buddy] ${label} failed: ${err.message}`);
			resolve({ statusCode: null, body: err.message });
		});
		req.write(payload);
		req.end();
	});
}

/**
 * GET /health
 * Returns plugin version and vault name.
 * If the caller sends X-Work-Buddy-Version, checks compatibility and
 * warns in the console if the plugin may be outdated.
 */
export function healthHandler(...[app, , , , query]: HArgs): HandlerResult {
	// work-buddy sends its version as a query param: /health?wb_version=0.2.0
	const callerVersion = query.get("wb_version");
	let compatibility: "ok" | "outdated" = "ok";

	if (callerVersion) {
		if (compareSemver(callerVersion, WB_VERSION_MIN) < 0) {
			compatibility = "outdated";
			console.warn(
				`[work-buddy] work-buddy v${callerVersion} may be too old for ` +
				`plugin v${PLUGIN_VERSION} (tested with >= v${WB_VERSION_MIN}). ` +
				`Update work-buddy.`
			);
		} else if (compareSemver(callerVersion, WB_VERSION_MAX) >= 0) {
			compatibility = "outdated";
			console.warn(
				`[work-buddy] Plugin v${PLUGIN_VERSION} may be outdated — ` +
				`work-buddy v${callerVersion} detected (tested up to v${WB_VERSION_MAX}). ` +
				`Update the plugin in Settings → Community plugins.`
			);
		}
	}

	return {
		status: 200,
		body: {
			status: "ok",
			plugin: "work-buddy",
			version: PLUGIN_VERSION,
			vault: app.vault.getName(),
			compatibility,
		},
	};
}

/**
 * GET /tags
 * Returns all vault-wide tags with occurrence counts.
 */
export function tagsHandler(...[app]: HArgs): HandlerResult {
	const tagCounts: Record<string, number> = {};

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		const fileTags = getAllTags(cache);
		if (!fileTags) continue;

		for (const tag of fileTags) {
			const normalized = tag.toLowerCase();
			tagCounts[normalized] = (tagCounts[normalized] || 0) + 1;
		}
	}

	return { status: 200, body: { tags: tagCounts } };
}

/**
 * GET /tags/:tag
 * Returns files containing a specific tag.
 * The :tag param should include the # prefix (url-encoded as %23).
 */
export function tagFilesHandler(
	...[app, , , params]: HArgs
): HandlerResult {
	let targetTag = params.tag || "";
	if (!targetTag.startsWith("#")) {
		targetTag = "#" + targetTag;
	}
	targetTag = targetTag.toLowerCase();

	const files: string[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		const fileTags = getAllTags(cache);
		if (!fileTags) continue;

		if (fileTags.some((t) => t.toLowerCase() === targetTag)) {
			files.push(file.path);
		}
	}

	return { status: 200, body: { tag: targetTag, files } };
}

/**
 * GET /files/:path
 * Read file content. Path is vault-relative.
 */
export async function filesReadHandler(
	...[app, , , params]: HArgs
): Promise<HandlerResult> {
	const filePath = params.path || "";
	const file = app.vault.getAbstractFileByPath(filePath);

	if (!file || !(file instanceof TFile)) {
		return { status: 404, body: { error: `File not found: ${filePath}` } };
	}

	const content = await app.vault.read(file);
	return {
		status: 200,
		body: { path: filePath, content },
	};
}

/**
 * PUT /files/:path
 * Write or create file content. Path is vault-relative.
 * Body: { "content": "file content here" }
 */
export async function filesWriteHandler(
	...[app, , body, params]: HArgs
): Promise<HandlerResult> {
	const filePath = params.path || "";
	const content =
		body && typeof body === "object" && "content" in body
			? String((body as { content: unknown }).content)
			: null;

	if (content === null) {
		return {
			status: 400,
			body: { error: 'Request body must include "content" field' },
		};
	}

	const existing = app.vault.getAbstractFileByPath(filePath);

	if (existing && existing instanceof TFile) {
		await app.vault.modify(existing, content);
		// vault.modify() fires Obsidian's `modify` event and updates the
		// TFile + metadataCache, but a MarkdownView in source / live-preview
		// mode keeps its own CodeMirror document state. Without the nudge
		// below, any tab currently viewing this file shows stale content
		// until the user closes + reopens it. Reading mode re-renders on
		// the modify event so we only need to touch the editor doc.
		syncOpenEditorsToDisk(app, filePath, content);
		return { status: 200, body: { path: filePath, created: false } };
	} else {
		await app.vault.create(filePath, content);
		return { status: 201, body: { path: filePath, created: true } };
	}
}

/**
 * Force any open MarkdownView on ``filePath`` to show ``content`` in its
 * CodeMirror editor. Preserves cursor position where possible.
 *
 * Called from filesWriteHandler after vault.modify() to work around CM6's
 * in-memory document state outliving an external write. See the note at
 * the call site for the mode-dependent reason this is needed.
 */
function syncOpenEditorsToDisk(
	app: App,
	filePath: string,
	content: string
): void {
	app.workspace.iterateAllLeaves((leaf) => {
		if (
			leaf.view instanceof MarkdownView &&
			leaf.view.file?.path === filePath
		) {
			const editor = leaf.view.editor;
			if (!editor) return;
			// Skip if editor already matches — avoids a redundant CM6
			// transaction (and the cursor-jump side effect) on every write.
			if (editor.getValue() === content) return;
			const cursor = editor.getCursor();
			editor.setValue(content);
			// Best-effort cursor restore. setCursor clamps to document
			// bounds, so a shorter post-write document just lands the
			// cursor at the end — acceptable.
			try {
				editor.setCursor(cursor);
			} catch {
				/* cursor restoration is best-effort only */
			}
		}
	});
}

/**
 * GET /metadata/:path
 * Returns cached metadata for a file (frontmatter, tags, links, headings, etc.).
 */
export function metadataHandler(
	...[app, , , params]: HArgs
): HandlerResult {
	const filePath = params.path || "";
	const file = app.vault.getAbstractFileByPath(filePath);

	if (!file || !(file instanceof TFile)) {
		return { status: 404, body: { error: `File not found: ${filePath}` } };
	}

	const cache = app.metadataCache.getFileCache(file);
	if (!cache) {
		return {
			status: 200,
			body: { path: filePath, metadata: null, note: "No cached metadata yet" },
		};
	}

	return {
		status: 200,
		body: {
			path: filePath,
			metadata: {
				frontmatter: cache.frontmatter ?? null,
				tags: cache.tags ?? null,
				allTags: getAllTags(cache) ?? [],
				headings: cache.headings ?? null,
				links: cache.links ?? null,
				embeds: cache.embeds ?? null,
				sections: cache.sections ?? null,
				listItems: cache.listItems ?? null,
				frontmatterLinks: cache.frontmatterLinks ?? null,
			},
		},
	};
}

/**
 * GET /search?q=...
 * Simple file name + content search.
 */
export async function searchHandler(
	...[app, , , , query]: HArgs
): Promise<HandlerResult> {
	const q = query.get("q");
	if (!q) {
		return { status: 400, body: { error: "Missing query parameter: q" } };
	}

	const lowerQ = q.toLowerCase();
	const results: Array<{ path: string; match: "name" | "content" }> = [];
	const maxResults = 50;

	for (const file of app.vault.getMarkdownFiles()) {
		if (results.length >= maxResults) break;

		// Match file name
		if (file.path.toLowerCase().includes(lowerQ)) {
			results.push({ path: file.path, match: "name" });
			continue;
		}

		// Match content (read is async but we limit results)
		try {
			const content = await app.vault.cachedRead(file);
			if (content.toLowerCase().includes(lowerQ)) {
				results.push({ path: file.path, match: "content" });
			}
		} catch {
			// Skip files that can't be read
		}
	}

	return { status: 200, body: { query: q, results } };
}

/**
 * POST /eval
 * Execute arbitrary JavaScript with access to the Obsidian App object.
 * Body: { "code": "return app.vault.getMarkdownFiles().length" }
 *
 * The code is wrapped in an async function that receives `app` as its argument.
 * Return values are JSON-serialized. Promises are awaited.
 */
export async function evalHandler(
	...[app, settings, body]: HArgs
): Promise<HandlerResult> {
	if (!settings.evalEnabled) {
		return {
			status: 403,
			body: { error: "Eval endpoint is disabled in settings" },
		};
	}

	const code =
		body && typeof body === "object" && "code" in body
			? String((body as { code: unknown }).code)
			: null;

	if (!code) {
		return {
			status: 400,
			body: { error: 'Request body must include "code" field' },
		};
	}

	try {
		// Wrap in async function so `return` and `await` work naturally
		// The Function constructor is the eval endpoint's core mechanism — intentionally
		// executes user-provided code, gated behind settings.evalEnabled.
		const fn = new Function("app", `return (async () => { ${code} })()`) as (app: App) => Promise<unknown>;

		// Race against timeout
		const timeout = settings.evalTimeoutMs || 10000;
		const result = await Promise.race([
			fn(app),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error(`Eval timed out after ${timeout}ms`)), timeout)
			),
		]);

		return { status: 200, body: { result } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { status: 500, body: { error: message } };
	}
}

// ---------------------------------------------------------------------------
// Notification / Request endpoints
// ---------------------------------------------------------------------------

/**
 * In-memory store for notification responses.
 * Keyed by notification_id. Written by the modal's button callbacks,
 * read (and cleared) by the poll endpoint.
 */
const notificationResponses: Record<
	string,
	{ status: "responded" | "dismissed" | "gateway"; value: unknown; responded_at: string | null; responded_via?: string }
> = {};

/**
 * In-memory store for open notification modals.
 * Keyed by notification_id. Stored when a modal is opened,
 * removed when the modal closes (via onClose) or is dismissed externally.
 */
const openModals: Record<string, NotificationRequestModal> = {};

/**
 * Risk level → color mapping for the consent modal.
 */
const RISK_COLORS: Record<string, string> = {
	low: "var(--text-success)",
	moderate: "var(--text-warning)",
	high: "var(--text-error)",
};

/**
 * Modal for displaying notification requests and collecting responses.
 * Handles: boolean, choice, range, and freeform response types.
 */
class NotificationRequestModal extends Modal {
	private notificationId: string;
	private data: {
		title: string;
		body: string;
		response_type: string;
		choices?: Array<{ key: string; label: string; description?: string }>;
		number_range?: { min: number; max: number; step?: number };
		risk?: string;
		operation?: string;
		default_ttl?: number;
		callback?: { capability: string; params: Record<string, unknown> };
	};

	constructor(
		app: App,
		notificationId: string,
		data: NotificationRequestModal["data"],
	) {
		super(app);
		this.notificationId = notificationId;
		this.data = data;
	}

	onOpen() {
		// Track this modal so it can be dismissed externally
		openModals[this.notificationId] = this;

		const { contentEl } = this;
		const { title, body, response_type, choices, number_range, risk } = this.data;

		// Title
		const titleEl = contentEl.createEl("h2", { text: title });

		// Risk badge (for consent requests)
		if (risk) {
			const badge = titleEl.createEl("span", {
				text: ` ${risk.toUpperCase()}`,
				cls: "wb-risk-badge",
			});
			const color = RISK_COLORS[risk] || "var(--text-muted)";
			badge.setCssProps({
				"--wb-risk-color": color,
			});
		}

		// Body
		if (body) {
			contentEl.createEl("p", { text: body });
		}

		// Response UI based on type
		if (response_type === "choice" && choices?.length) {
			this.renderChoices(contentEl, choices);
		} else if (response_type === "boolean") {
			this.renderBoolean(contentEl);
		} else if (response_type === "range" && number_range) {
			this.renderRange(contentEl, number_range);
		} else if (response_type === "freeform") {
			this.renderFreeform(contentEl);
		} else if (response_type === "none") {
			// Notification only — just an OK button
			new Setting(contentEl).addButton((btn) =>
				btn.setButtonText("OK").setCta().onClick(() => this.close())
			);
		}
	}

	onClose() {
		// Unregister from the open modals tracker
		delete openModals[this.notificationId];
		this.contentEl.empty();
	}

	private respond(value: unknown) {
		// Store in memory for active polling (handles "I'm right here" case)
		notificationResponses[this.notificationId] = {
			status: "responded",
			value,
			responded_at: new Date().toISOString(),
		};

		// Also dispatch via messaging service for deferred resolution.
		// If the polling script already exited, this ensures the response
		// is still acted on. The sidecar's MessagePoller picks up the
		// message and dispatches the consent_grant capability.
		if (this.data.operation && typeof value === "string" && value !== "deny") {
			void this.dispatchConsentGrant(this.data.operation, value);
		}

		this.close();
	}

	/**
	 * POST a consent_grant message to the messaging service (localhost:5123).
	 * The sidecar's MessagePoller dispatches it as a capability call.
	 * Fire-and-forget — errors are logged but don't block the modal.
	 */
	private async dispatchConsentGrant(operation: string, mode: string) {
		const ttlMinutes = mode === "temporary" ? (this.data.default_ttl || 5) : undefined;

		const payload = JSON.stringify({
			sender: "obsidian-consent-modal",
			recipient: "work-buddy",
			type: "result",
			subject: "consent_grant",
			body: JSON.stringify({
				operation,
				mode,
				ttl_minutes: ttlMinutes,
			}),
			priority: "high",
			tags: ["consent-callback", "from-obsidian"],
		});

		await localPost(5123, "/messages", payload, `Consent grant: ${operation} (${mode})`);
	}

	private renderChoices(
		container: HTMLElement,
		choices: Array<{ key: string; label: string; description?: string }>
	) {
		for (const choice of choices) {
			const setting = new Setting(container);
			setting.setName(choice.label);
			if (choice.description) {
				setting.setDesc(choice.description);
			}
			setting.addButton((btn) => {
				btn.setButtonText(choice.label).onClick(() => this.respond(choice.key));
				// Make the first choice the CTA (primary) button
				if (choice === choices[0]) {
					btn.setCta();
				}
			});
		}
	}

	private renderBoolean(container: HTMLElement) {
		new Setting(container)
			.addButton((btn) =>
				btn
					.setButtonText("Yes")
					.setCta()
					.onClick(() => this.respond(true))
			)
			.addButton((btn) =>
				btn.setButtonText("No").onClick(() => this.respond(false))
			);
	}

	private renderRange(
		container: HTMLElement,
		range: { min: number; max: number; step?: number }
	) {
		const step = range.step || 1;
		let currentValue = Math.round((range.min + range.max) / 2);

		const display = container.createEl("p", {
			text: `Value: ${currentValue}`,
			cls: "wb-range-display",
		});

		const slider = container.createEl("input");
		slider.type = "range";
		slider.min = String(range.min);
		slider.max = String(range.max);
		slider.step = String(step);
		slider.value = String(currentValue);
		slider.addClass("wb-range-slider");
		slider.addEventListener("input", () => {
			currentValue = Number(slider.value);
			display.textContent = `Value: ${currentValue}`;
		});

		new Setting(container).addButton((btn) =>
			btn
				.setButtonText("Submit")
				.setCta()
				.onClick(() => this.respond(currentValue))
		);
	}

	private renderFreeform(container: HTMLElement) {
		let text = "";
		const textarea = container.createEl("textarea");
		textarea.addClass("wb-freeform-textarea");
		textarea.addEventListener("input", () => {
			text = textarea.value;
		});

		new Setting(container).addButton((btn) =>
			btn
				.setButtonText("Submit")
				.setCta()
				.onClick(() => this.respond(text))
		);
	}
}

// ---------------------------------------------------------------------------
// Custom modal types (triage views moved to dashboard — see dashboard/frontend.py)
// ---------------------------------------------------------------------------

/**
 * POST /notifications/show
 * Show a notification/request modal to the user.
 * Fire-and-forget: returns immediately, user response is polled separately.
 *
 * Body: {
 *   notification_id: string,
 *   title: string,
 *   body?: string,
 *   response_type: "none" | "boolean" | "choice" | "freeform" | "range" | "custom",
 *   choices?: [{key, label, description}],
 *   number_range?: {min, max, step},
 *   risk?: string,       // for consent: "low", "moderate", "high"
 *   custom_template?: object  // custom types routed to dashboard instead
 * }
 */
export function notificationShowHandler(
	...[app, , body]: HArgs
): HandlerResult {
	if (!body || typeof body !== "object") {
		return { status: 400, body: { error: "JSON body required" } };
	}

	const data = body as Record<string, unknown>;
	const notificationId = data.notification_id as string;

	if (!notificationId) {
		return {
			status: 400,
			body: { error: "notification_id is required" },
		};
	}

	const responseType = (data.response_type as string) || "none";
	const isGateway = Boolean(data.gateway);

	// Gateway mode MUST be checked before the "none" early-return below,
	// because gateway applies to ALL non-consent notifications including NONE.
	// Gateway mode: Obsidian acts as a lightweight notification surface.
	// Two variants based on expandable flag:
	//   - Non-expandable: simple dismiss toast (click to acknowledge)
	//   - Expandable: toast with "Open in dashboard" deep-link
	// Consent requests bypass gateway entirely (handled by modal below).
	if (isGateway) {
		const title = (data.title as string) || "Notification";
		const bodyText = (data.body as string) || "";
		const shortId = (data.short_id as string) || "";
		const isExpandable = Boolean(data.expandable);

		const fragment = document.createDocumentFragment();

		const header = document.createElement("div");
		header.addClass("wb-notice-header");
		header.textContent = shortId ? `[#${shortId}] ${title}` : title;
		fragment.appendChild(header);

		if (isExpandable) {
			// --- Expandable: show body summary + "Open in dashboard" button ---
			if (bodyText) {
				const bodyEl = document.createElement("div");
				bodyEl.addClass("wb-notice-body");
				bodyEl.textContent = bodyText.length > 120 ? bodyText.slice(0, 117) + "..." : bodyText;
				fragment.appendChild(bodyEl);
			}

			const btn = document.createElement("button");
			btn.textContent = "Open in dashboard";
			btn.className = "mod-cta wb-notice-action";
			fragment.appendChild(btn);

			// Persistent until user dismisses or clicks through
			const notice = new Notice(fragment, 0);
			btn.addEventListener("click", () => {
				// Route through the bridge (port 27125) — fetch() from Notice
				// click handlers can reach the bridge (CORS *) but not other
				// ports. The bridge relays to dashboard → Chrome extension.
				fetch("http://127.0.0.1:27125/notifications/open-dashboard", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ view_id: notificationId }),
				}).catch((err: unknown) => {
					console.warn(`[work-buddy] Open dashboard failed: ${err instanceof Error ? err.message : String(err)}`);
				});
				notice.hide();
			});
		} else {
			// --- Non-expandable: simple dismiss toast ---
			// Shows title + short body with a Dismiss button.
			if (bodyText) {
				const bodyEl = document.createElement("div");
				bodyEl.addClass("wb-notice-body");
				bodyEl.textContent = bodyText;
				fragment.appendChild(bodyEl);
			}

			const dismissBtn = document.createElement("button");
			dismissBtn.textContent = "Dismiss";
			dismissBtn.className = "mod-muted wb-notice-dismiss";
			fragment.appendChild(dismissBtn);

			// All gateway notices are persistent — transient ones are too easy to miss
			const notice = new Notice(fragment, 0);

			// Dismiss button: acknowledge via the bridge's own /notifications/acknowledge
			// endpoint (port 27125), which relays to the messaging service.
			// Uses fetch() because require("http") doesn't work from Notice click
			// handlers (esbuild bundling issue). The bridge has CORS * so fetch works.
			dismissBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				console.debug(`[work-buddy] Acknowledge clicked for ${notificationId}`);

				fetch("http://127.0.0.1:27125/notifications/acknowledge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ notification_id: notificationId }),
				})
					.then((res) => console.debug(`[work-buddy] Acknowledge: ${res.status}`))
					.catch((err: unknown) => console.warn(`[work-buddy] Acknowledge failed: ${err instanceof Error ? err.message : String(err)}`));

				notice.hide();
			});
		}

		// Track for external dismiss
		notificationResponses[notificationId] = {
			status: "gateway",
			value: null,
			responded_at: null,
		};

		return { status: 200, body: { shown: true, type: isExpandable ? "gateway-expandable" : "gateway-dismiss" } };
	}

	// Simple notification without gateway (direct bridge calls, legacy)
	if (responseType === "none") {
		const title = (data.title as string) || "Notification";
		const bodyStr = typeof data.body === "string" ? data.body : "";
		const msg = bodyStr ? `${title}: ${bodyStr}` : title;
		new Notice(msg, data.priority === "urgent" ? 0 : 10000);

		notificationResponses[notificationId] = {
			status: "responded",
			value: null,
			responded_at: new Date().toISOString(),
		};

		return { status: 200, body: { shown: true, type: "notice" } };
	}

	// Custom types are handled by the dashboard, not Obsidian modals.
	if (responseType === "custom") {
		return {
			status: 400,
			body: { error: "Custom response types should use the dashboard transport, not Obsidian" },
		};
	}

	// Standard request types — show a modal (consent requests reach here)
	const modal = new NotificationRequestModal(app, notificationId, {
		title: (data.title as string) || "Request",
		body: (data.body as string) || "",
		response_type: responseType,
		choices: data.choices as NotificationRequestModal["data"]["choices"],
		number_range: data.number_range as NotificationRequestModal["data"]["number_range"],
		risk: data.risk as string,
		operation: data.operation as string,
		default_ttl: data.default_ttl as number,
		callback: data.callback as NotificationRequestModal["data"]["callback"],
	});
	modal.open();

	return { status: 200, body: { shown: true, type: "modal" } };
}

/**
 * GET /notifications/status/:id
 * Poll for a notification response.
 * Returns {status: "pending"} if no response yet,
 * or {status: "responded", value: ...} if the user has responded.
 * The response is cleared after reading (one-shot).
 */
export function notificationStatusHandler(
	...[, , , params]: HArgs
): HandlerResult {
	const id = params.id || "";
	if (!id) {
		return { status: 400, body: { error: "Notification ID required" } };
	}

	const response = notificationResponses[id];
	if (!response) {
		return { status: 200, body: { status: "pending" } };
	}

	// Clear after reading (one-shot)
	delete notificationResponses[id];

	return {
		status: 200,
		body: response,
	};
}

/**
 * POST /notifications/acknowledge
 * Relay an acknowledge signal to the dashboard (port 5127).
 * Used by gateway dismiss buttons that can't reach external services directly
 * from Notice click handlers (esbuild bundling breaks require("http") in
 * dynamically created DOM event listeners).
 *
 * Body: { notification_id: string }
 */
export async function notificationAcknowledgeHandler(
	...[, , body]: HArgs
): Promise<HandlerResult> {
	if (!body || typeof body !== "object") {
		return { status: 400, body: { error: "JSON body required" } };
	}

	const data = body as Record<string, unknown>;
	const notificationId = data.notification_id as string;

	if (!notificationId) {
		return { status: 400, body: { error: "notification_id is required" } };
	}

	const payload = JSON.stringify({ responded_via: "obsidian" });
	const result = await localPostWithBody(
		5127,
		`/api/notifications/${notificationId}/acknowledge`,
		payload,
		`Acknowledge ${notificationId}`
	);

	if (result.statusCode === null) {
		return { status: 502, body: { error: `Dashboard unreachable: ${result.body}` } };
	}

	return {
		status: 200,
		body: { acknowledged: true, dashboard_status: result.statusCode },
	};
}

/**
 * POST /notifications/open-dashboard
 * Relay to the dashboard's /api/open-dashboard endpoint, which uses the
 * Chrome extension to focus or create a dashboard tab with deep-link.
 *
 * Body: { view_id: string }
 */
export async function notificationOpenDashboardHandler(
	...[, , body]: HArgs
): Promise<HandlerResult> {
	if (!body || typeof body !== "object") {
		return { status: 400, body: { error: "JSON body required" } };
	}

	const data = body as Record<string, unknown>;
	const viewId = (data.view_id as string) || "";

	const payload = JSON.stringify({ view_id: viewId });
	const result = await localPostWithBody(
		5127,
		"/api/open-dashboard",
		payload,
		`Open dashboard for ${viewId}`
	);

	if (result.statusCode === null) {
		return { status: 502, body: { error: `Dashboard unreachable: ${result.body}` } };
	}

	return {
		status: 200,
		body: { relayed: true, dashboard_status: result.statusCode },
	};
}

/**
 * POST /notifications/dismiss
 * Dismiss a notification that was responded to on another transport.
 * Closes the modal if it's still open and marks the notification as dismissed.
 *
 * Body: { notification_id: string, responded_via?: string }
 *
 * Returns { dismissed: true } on success (modal closed or already gone),
 * or { dismissed: false } if the notification_id was never seen.
 */
export function notificationDismissHandler(
	...[, , body]: HArgs
): HandlerResult {
	if (!body || typeof body !== "object") {
		return { status: 400, body: { error: "JSON body required" } };
	}

	const data = body as Record<string, unknown>;
	const notificationId = data.notification_id as string;

	if (!notificationId) {
		return {
			status: 400,
			body: { error: "notification_id is required" },
		};
	}

	const respondedVia = (data.responded_via as string) || "unknown";

	// Check if there's an open modal for this notification
	const modal = openModals[notificationId];
	if (modal) {
		// Close the modal — onClose() will clean up openModals entry
		modal.close();
		console.debug(`[work-buddy] Dismissed modal ${notificationId} (responded via ${respondedVia})`);

		// If the user hasn't already responded via this modal, mark as dismissed
		// so poll doesn't return "pending" forever
		if (!notificationResponses[notificationId]) {
			notificationResponses[notificationId] = {
				status: "dismissed",
				value: null,
				responded_at: new Date().toISOString(),
				responded_via: respondedVia,
			};
		}

		return { status: 200, body: { dismissed: true } };
	}

	// No open modal — check if we at least know about this notification
	if (notificationResponses[notificationId]) {
		console.debug(`[work-buddy] Dismiss no-op for ${notificationId} (already ${notificationResponses[notificationId].status})`);
		return { status: 200, body: { dismissed: true } };
	}

	console.debug(`[work-buddy] Dismiss miss: ${notificationId} not found`);
	return { status: 200, body: { dismissed: false } };
}

/**
 * GET /workspace
 * Returns current workspace state: open files, active file, and leaf layout.
 */
export function workspaceHandler(
	...[app]: HArgs
): HandlerResult {
	// Active file
	const activeFile = app.workspace.getActiveFile();

	// All open markdown leaves with their file paths
	const openFiles: Array<{ path: string; active: boolean }> = [];
	const seen = new Set<string>();

	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view instanceof MarkdownView && leaf.view.file) {
			const path = leaf.view.file.path;
			if (!seen.has(path)) {
				seen.add(path);
				openFiles.push({
					path,
					active: activeFile?.path === path,
				});
			}
		}
	});

	return {
		status: 200,
		body: {
			active_file: activeFile?.path ?? null,
			open_files: openFiles,
			open_count: openFiles.length,
		},
	};
}
