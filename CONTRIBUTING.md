# Contributing to obsidian-work-buddy

Thank you for your interest in contributing! This is the companion Obsidian plugin for [work-buddy](https://github.com/KadenMc/work-buddy). The same contributing philosophy applies here — see the [main repo's contributing guide](https://github.com/KadenMc/work-buddy/blob/main/CONTRIBUTING.md) for the broader context.

## Before You Start

- **Search existing issues:** Check if your idea or bug has already been reported.
- **Open an issue first:** For significant changes (new endpoint categories, architectural changes), please open an issue to discuss your proposal before writing code.
- **Small fixes are welcome without discussion** — typos, bug fixes, documentation improvements, and minor enhancements can go straight to a PR.

## Development Setup

### Prerequisites

- Node.js 20+ (LTS recommended)
- npm
- [Obsidian](https://obsidian.md/) desktop app (for testing)

### Install and Build

```bash
git clone https://github.com/YOUR-USERNAME/obsidian-work-buddy.git
cd obsidian-work-buddy
npm install
npm run build    # production build
npm run dev      # or watch mode for development
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin directory (`<vault>/.obsidian/plugins/obsidian-work-buddy/`) and reload Obsidian.

### Linting

```bash
npm run lint
```

## The Fork and Pull Workflow

1. **Fork** the repository to your own GitHub account.
2. **Clone** your fork locally.
3. **Add the upstream remote** to stay synced:
   ```bash
   git remote add upstream https://github.com/KadenMc/obsidian-work-buddy.git
   ```
4. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```
5. **Make your changes**, commit with clear messages.
6. **Push** and open a Pull Request against `main`.

## Project Structure

```
src/
  main.ts       # Plugin lifecycle (keep minimal — only startup, settings, route registration)
  server.ts     # HTTP server with pattern-matching router
  handlers.ts   # All endpoint handlers (vault, eval, notifications)
  settings.ts   # Settings interface and settings tab
styles.css      # Status bar and modal styling
```

### Key Conventions

- **Keep `main.ts` small.** Only plugin lifecycle belongs here. All logic goes in other modules.
- **No external runtime dependencies.** Only `obsidian` types at runtime. Everything bundles into `main.js`.
- **Localhost only.** The server binds to `127.0.0.1`. No outbound network requests.
- **Eval is gated.** The `/eval` endpoint is controlled by a settings toggle.
- Use `this.register*` helpers for all listeners and intervals (cleanup on unload).
- Use stable command IDs — don't rename after release.

### Adding an Endpoint

1. Write a handler function in `src/handlers.ts`
2. Register the route in `src/main.ts` via `this.bridge.route()`
3. Test manually by calling the endpoint with `curl`

## Pull Request Checklist

- [ ] `npm run build` succeeds without errors
- [ ] `npm run lint` passes
- [ ] Tested manually in Obsidian (copy build artifacts, reload, verify)
- [ ] PR title is descriptive and concise
- [ ] Linked to a relevant issue if one exists

## License

By contributing, you agree that your work will be licensed under the [MIT License](LICENSE).
