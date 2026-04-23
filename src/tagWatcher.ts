import { TAbstractFile, TFile, requestUrl } from "obsidian";
import type WorkBuddyPlugin from "./main";

const WB_CMD_PREFIX = "#wb/cmd/";

interface TagOccurrence {
	tag: string;
	line: number;
}

export function registerTagWatcher(plugin: WorkBuddyPlugin): void {
	// Last-known #wb/cmd/* tags per file path (tag string only, for diff).
	const perFileTags: Map<string, Set<string>> = new Map();

	const dashboardUrl = (path: string): string =>
		`http://127.0.0.1:${plugin.settings.dashboardPort}${path}`;

	const commandFromTag = (tag: string): string => {
		// Strip leading "#wb/cmd/" — remainder is the command path (e.g. "task/new").
		return tag.startsWith(WB_CMD_PREFIX)
			? tag.slice(WB_CMD_PREFIX.length)
			: tag;
	};

	const collectTags = (file: TFile): TagOccurrence[] => {
		const cache = plugin.app.metadataCache.getFileCache(file);
		if (!cache) return [];
		const out: TagOccurrence[] = [];

		// Inline tags: cache.tags carries position info.
		if (Array.isArray(cache.tags)) {
			for (const t of cache.tags) {
				const raw = t.tag;
				if (!raw) continue;
				const normalized = raw.startsWith("#") ? raw : `#${raw}`;
				if (normalized.startsWith(WB_CMD_PREFIX)) {
					out.push({
						tag: normalized,
						line: t.position?.start?.line ?? 0,
					});
				}
			}
		}

		// Frontmatter tags: no line info, use line 0.
		const fmTags = cache.frontmatter?.tags;
		if (fmTags) {
			const arr = Array.isArray(fmTags) ? fmTags : [fmTags];
			for (const raw of arr) {
				if (typeof raw !== "string") continue;
				const normalized = raw.startsWith("#") ? raw : `#${raw}`;
				if (normalized.startsWith(WB_CMD_PREFIX)) {
					out.push({ tag: normalized, line: 0 });
				}
			}
		}

		return out;
	};

	plugin.registerEvent(
		plugin.app.metadataCache.on("changed", async (file) => {
			if (!(file instanceof TFile)) return;
			const occurrences = collectTags(file);
			const newSet = new Set(occurrences.map((o) => o.tag));
			const previous = perFileTags.get(file.path) ?? new Set<string>();

			const added = [...newSet].filter((t) => !previous.has(t));
			const removed = [...previous].filter((t) => !newSet.has(t));

			if (added.length > 0) {
				let fullText = "";
				try {
					fullText = await plugin.app.vault.read(file);
				} catch (err) {
					console.debug("[work-buddy] tag watcher vault read failed:", err);
				}
				for (const tag of added) {
					const occ = occurrences.find((o) => o.tag === tag);
					try {
						const res = await requestUrl({
							url: dashboardUrl("/inline/invoke"),
							method: "POST",
							contentType: "application/json",
							body: JSON.stringify({
								command: commandFromTag(tag),
								surface: "tag",
								payload: {
									file_path: file.path,
									tag,
									tag_line: occ?.line ?? 0,
									full_text: fullText,
								},
							}),
							throw: false,
						});
						if (res.status < 200 || res.status >= 300) {
							console.debug(
								"[work-buddy] tag invoke non-OK:",
								res.status
							);
						}
					} catch (err) {
						console.debug("[work-buddy] tag invoke failed:", err);
					}
				}
			}

			for (const tag of removed) {
				try {
					const res = await requestUrl({
						url: dashboardUrl("/inline/tag-removed"),
						method: "POST",
						contentType: "application/json",
						body: JSON.stringify({
							file_path: file.path,
							tag,
						}),
						throw: false,
					});
					if (res.status < 200 || res.status >= 300) {
						console.debug(
							"[work-buddy] tag-removed non-OK:",
							res.status
						);
					}
				} catch (err) {
					console.debug("[work-buddy] tag-removed failed:", err);
				}
			}

			perFileTags.set(file.path, newSet);
		})
	);

	plugin.registerEvent(
		plugin.app.vault.on("delete", (file: TAbstractFile) => {
			perFileTags.delete(file.path);
		})
	);

	plugin.registerEvent(
		plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
			const existing = perFileTags.get(oldPath);
			if (existing) {
				perFileTags.delete(oldPath);
				perFileTags.set(file.path, existing);
			}
		})
	);
}
