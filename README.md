# Obsidian Work Buddy

Companion Obsidian plugin for [**work-buddy**](https://github.com/KadenMc/work-buddy) — the personal agent framework built on Claude Code and Obsidian.

> **This plugin does nothing on its own.** It exposes an HTTP bridge that the work-buddy Python package connects to. If you haven't set up [work-buddy](https://github.com/KadenMc/work-buddy), start there.

<p>
    <a href="https://github.com/KadenMc/work-buddy"><img src="https://img.shields.io/badge/requires-work--buddy-E47150" alt="Requires work-buddy"></a>
    <img src="https://img.shields.io/badge/status-beta-yellow" alt="Beta">
    <img src="https://img.shields.io/badge/desktop-only-blue" alt="Desktop only">
</p>

---

## What This Does

Runs a lightweight HTTP server inside Obsidian (default port `27125`) that exposes the Obsidian TypeScript Plugin API to external callers. The work-buddy framework connects to this bridge, giving agents and Python scripts access to:

- **Vault-wide tag queries** via MetadataCache
- **File read/write** through the Vault API
- **Cached metadata** — frontmatter, links, headings, sections, embeds
- **Workspace state** — open tabs, active file
- **Search** across vault files by name and content
- **JavaScript execution** against the full Plugin API (configurable, off by default for security)
- **Notification modals** — consent requests, decision prompts, and user notifications from work-buddy agents

## Why a Plugin?

Obsidian's Local REST API plugin provides basic file I/O, but work-buddy needs deeper access: MetadataCache queries, workspace state, plugin-level JavaScript execution, and a notification surface for human-in-the-loop agent workflows. This plugin provides all of that through a single bridge that the framework manages automatically.

```
work-buddy agents ──MCP──> work-buddy Python ──HTTP──> this plugin ──> Obsidian API
                                                        :27125
```

## Installation

### From Community Plugins (recommended)

1. Open **Settings > Community plugins**
2. Search for **"Work Buddy"**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/KadenMc/obsidian-work-buddy/releases/latest)
2. Create a folder: `<your-vault>/.obsidian/plugins/obsidian-work-buddy/`
3. Copy the three files into that folder
4. Restart Obsidian and enable the plugin in **Settings > Community plugins**

### From Source

```bash
git clone https://github.com/KadenMc/obsidian-work-buddy.git
cd obsidian-work-buddy
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin directory.

## Configuration

Open **Settings > Work Buddy Bridge** to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| **Port** | `27125` | HTTP server port. Restart the plugin after changing. |
| **Enable eval endpoint** | Off | Allow executing arbitrary JavaScript via `POST /eval`. Powerful but use with care. |
| **Eval timeout** | `10000` ms | Maximum execution time for eval requests. |

In your work-buddy `config.yaml`, set the bridge port to match:

```yaml
obsidian:
  bridge_port: 27125  # must match the plugin setting
```

## API Reference

All endpoints are served on `http://127.0.0.1:27125` (localhost only).

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns plugin version, vault name, status |
| `GET` | `/tags` | All vault tags with occurrence counts |
| `GET` | `/tags/:tag` | Files containing a specific tag |
| `GET` | `/files/:path` | Read file content (vault-relative path) |
| `PUT` | `/files/:path` | Write or create a file. Body: `{"content": "..."}` |
| `GET` | `/metadata/:path` | Cached metadata — frontmatter, tags, links, headings, sections, embeds |
| `GET` | `/search?q=...` | Search vault by file name and content (max 50 results) |
| `POST` | `/eval` | Execute JavaScript with access to the `app` object. Body: `{"code": "..."}` |
| `GET` | `/workspace` | Open files and active file |

### Notification Endpoints

These are used by work-buddy's [notification system](https://github.com/KadenMc/work-buddy#you-stay-in-control) for human-in-the-loop agent workflows.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/notifications/show` | Display a modal (consent, boolean, choice, freeform, range) |
| `GET` | `/notifications/status/:id` | Poll for user response (one-shot read) |
| `POST` | `/notifications/dismiss` | Close a modal dismissed from another surface |
| `POST` | `/notifications/acknowledge` | Relay acknowledgement to the dashboard |
| `POST` | `/notifications/open-dashboard` | Deep-link to the work-buddy dashboard |

### Example: Health Check

```bash
curl http://127.0.0.1:27125/health
```

```json
{
  "status": "ok",
  "plugin": "obsidian-work-buddy",
  "version": "0.1.0",
  "vault": "MyVault"
}
```

### Example: Read a File

```bash
curl http://127.0.0.1:27125/files/journal/2026-04-13.md
```

### Example: Query Tags

```bash
curl http://127.0.0.1:27125/tags
# → {"tags": {"#project/my-app": 42, "#status/active": 15, ...}}
```

## Security

- **Localhost only.** The server binds to `127.0.0.1` — it is not accessible from other machines on your network.
- **Eval is gated.** The `/eval` endpoint is disabled by default and must be explicitly enabled in settings. When enabled, it allows executing arbitrary JavaScript with full access to the Obsidian `app` object.
- **No telemetry.** This plugin makes no outbound network requests. All communication is local, initiated by the work-buddy framework connecting to this plugin.
- **Desktop only.** This plugin uses Node.js APIs (`http` module) and is not compatible with Obsidian Mobile.

## How It Fits Into work-buddy

This plugin is one piece of the work-buddy architecture. The full framework provides:

- **90+ capabilities** and **15+ structured workflows** for task management, journaling, contract tracking, and more
- **Persistent memory** across agent sessions via [Hindsight](https://github.com/anthropics/hindsight)
- **Multi-surface notifications** — this plugin provides the Obsidian surface; Telegram and the web dashboard provide the others
- **Context collection** from git, Obsidian, Chrome, calendar, and conversations

See the [work-buddy README](https://github.com/KadenMc/work-buddy) for the full picture.

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│ Claude Code  │────>│  MCP Gateway │────>│  work-buddy Python│
│   Session    │     │  (4 tools)   │     │     package       │
└─────────────┘     └──────────────┘     └────────┬──────────┘
                                                   │
                    ┌──────────────────────────────┤
                    │              │                │
              ┌─────▼─────┐ ┌─────▼─────┐  ┌──────▼──────┐
              │ This Plugin│ │ Dashboard │  │  Telegram   │
              │  (Obsidian │ │ (Web UI)  │  │   (Mobile)  │
              │   Bridge)  │ │ :5127     │  │   :5125     │
              │   :27125   │ └───────────┘  └─────────────┘
              └────────────┘
```

## Development

```bash
npm install
npm run dev      # watch mode — rebuilds on file changes
npm run build    # production build (minified, no sourcemaps)
npm run lint     # run ESLint
```

After building, reload Obsidian (**Ctrl+R** / **Cmd+R**) or use the [Hot Reload](https://github.com/pjeby/hot-reload) plugin.

### Project Structure

```
src/
  main.ts       # Plugin lifecycle — loads settings, starts bridge, registers routes
  server.ts     # HTTP server with pattern-matching router
  handlers.ts   # All endpoint handlers (vault, eval, notifications)
  settings.ts   # Settings interface, defaults, and settings tab
styles.css      # Status bar and modal styling
```

## Contributing

Bug reports and pull requests are welcome. If you're contributing to the broader work-buddy ecosystem, see the [main repo's contributing guide](https://github.com/KadenMc/work-buddy/blob/main/CONTRIBUTING.md).

## License

[MIT](LICENSE) — see the [work-buddy project](https://github.com/KadenMc/work-buddy) for the full framework license.
