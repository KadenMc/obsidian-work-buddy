import http from "http";
import type { App } from "obsidian";
import type { WorkBuddySettings } from "./settings";

/** Parsed result from a route match. */
export interface RouteParams {
	[key: string]: string;
}

/** What a handler returns. */
export interface HandlerResult {
	status: number;
	body: unknown;
}

/** Handler signature: receives app, parsed body, route params, and query params. */
export type RouteHandler = (
	app: App,
	settings: WorkBuddySettings,
	body: unknown,
	params: RouteParams,
	query: URLSearchParams
) => Promise<HandlerResult>;

interface Route {
	method: string;
	pattern: RegExp;
	paramNames: string[];
	handler: RouteHandler;
}

/**
 * Lightweight HTTP server that runs inside Obsidian.
 * Uses Node's built-in http module (externalized by esbuild).
 */
export class BridgeServer {
	private server: http.Server | null = null;
	private routes: Route[] = [];
	private app: App;
	private settings: WorkBuddySettings;

	constructor(app: App, settings: WorkBuddySettings) {
		this.app = app;
		this.settings = settings;
	}

	/** Register a route. :param in the path becomes a named capture group. */
	route(method: string, path: string, handler: RouteHandler): void {
		const paramNames: string[] = [];
		// Convert :param segments to regex capture groups.
		// Use (.+) for the last param to capture paths with slashes (e.g. file paths).
		const parts = path.split("/").filter(Boolean);
		const regexParts = parts.map((part, i) => {
			if (part.startsWith(":")) {
				paramNames.push(part.slice(1));
				// Last param captures everything including slashes (for file paths)
				return i === parts.length - 1 ? "(.+)" : "([^/]+)";
			}
			return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		});
		const pattern = new RegExp("^/" + regexParts.join("/") + "(?:\\?.*)?$");
		this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
	}

	/** Update settings reference (e.g. after settings change). */
	updateSettings(settings: WorkBuddySettings): void {
		this.settings = settings;
	}

	/** Start listening. Returns a promise that resolves once the server is up. */
	start(port: number, host: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				this.handleRequest(req, res);
			});

			this.server.on("error", (err) => {
				reject(err);
			});

			this.server.listen(port, host, () => {
				resolve();
			});
		});
	}

	/** Stop the server gracefully. */
	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => resolve());
				this.server = null;
			} else {
				resolve();
			}
		});
	}

	private async handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse
	): Promise<void> {
		// CORS headers for localhost clients
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = req.url || "/";
		const parts = url.split("?", 2);
		const pathname = parts[0] || "/";
		const query = new URLSearchParams(parts[1] || "");
		const method = (req.method || "GET").toUpperCase();

		const start = Date.now();

		// Find matching route
		for (const route of this.routes) {
			if (route.method !== method) continue;
			const match = pathname.match(route.pattern);
			if (!match) continue;

			// Extract params
			const params: RouteParams = {};
			route.paramNames.forEach((name, i) => {
				params[name] = decodeURIComponent(match[i + 1] || "");
			});

			try {
				const body = await this.parseBody(req);
				const result = await route.handler(this.app, this.settings, body, params, query);
				this.sendJson(res, result.status, result.body);
				this.logRequest(method, pathname, result.status, Date.now() - start);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.sendJson(res, 500, { error: message });
				this.logRequest(method, pathname, 500, Date.now() - start);
			}
			return;
		}

		// No route matched
		this.sendJson(res, 404, { error: `Not found: ${method} ${pathname}` });
		this.logRequest(method, pathname, 404, Date.now() - start);
	}

	private logRequest(method: string, path: string, status: number, durationMs: number): void {
		console.log(`[work-buddy] ${method} ${path} → ${status} (${durationMs}ms)`);
	}

	private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
		const json = JSON.stringify(body);
		res.writeHead(status, {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(json),
		});
		res.end(json);
	}

	private parseBody(req: http.IncomingMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			// Only parse body for methods that typically have one
			if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
				resolve(null);
				return;
			}

			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf-8");
				if (!raw) {
					resolve(null);
					return;
				}
				try {
					resolve(JSON.parse(raw));
				} catch {
					resolve(raw);
				}
			});
			req.on("error", reject);
		});
	}
}
