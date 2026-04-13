<p align="center">
    <img src="docs/logo.svg" width="140" />
</p>

<h1 align="center">Obsidian Work Buddy</h1>

<p align="center">
    Companion Obsidian plugin for <a href="https://github.com/KadenMc/work-buddy"><b>work-buddy</b></a> — the personal agent framework built on Claude Code and Obsidian.
</p>

<p align="center">
    <a href="https://github.com/KadenMc/work-buddy"><img src="https://img.shields.io/badge/requires-work--buddy-E47150" alt="Requires work-buddy"></a>
    <img src="https://img.shields.io/badge/status-beta-yellow" alt="Beta">
</p>

> **This plugin does nothing on its own.** It exposes an HTTP bridge that the work-buddy Python package connects to. If you haven't set up [work-buddy](https://github.com/KadenMc/work-buddy), start there.

---

## What This Does

Runs a lightweight HTTP server inside Obsidian (default port `27125`) that exposes the Obsidian TypeScript Plugin API to external callers. The work-buddy framework connects to this bridge, giving agents and Python scripts access to:

- **Vault-wide tag queries** via MetadataCache
- **File read/write** through the Vault API
- **Cached metadata** — frontmatter, links, headings, sections, embeds
- **Workspace state** — open tabs, active file
- **Search** across vault files by name and content
- **JavaScript execution** against the full Plugin API (configurable, disabled by default)
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

## Security

- **Localhost only.** The server binds to `127.0.0.1` — not accessible from other machines on your network.
- **Eval is gated.** The `/eval` endpoint is disabled by default and must be explicitly enabled in settings. When enabled, it allows executing arbitrary JavaScript with full access to the Obsidian `app` object.
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
git clone https://github.com/KadenMc/obsidian-work-buddy.git
cd obsidian-work-buddy
npm install
npm run dev      # watch mode — rebuilds on file changes
npm run build    # production build (minified, no sourcemaps)
npm run lint     # run ESLint
```

After building, copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin directory (`<vault>/.obsidian/plugins/obsidian-work-buddy/`). Reload Obsidian (**Ctrl+R** / **Cmd+R**) or use the [Hot Reload](https://github.com/pjeby/hot-reload) plugin.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, the fork-and-pull workflow, and PR checklist. The same contributing guidelines from the [main work-buddy repo](https://github.com/KadenMc/work-buddy/blob/main/CONTRIBUTING.md) apply here.

## License

[MIT](LICENSE) — see the [work-buddy project](https://github.com/KadenMc/work-buddy) for the full framework license.
