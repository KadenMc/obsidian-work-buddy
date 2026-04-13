# Agent Instructions

Instructions for AI agents working on this codebase.

## Project Context

This is the companion Obsidian plugin for [work-buddy](https://github.com/KadenMc/work-buddy). It runs an HTTP bridge server inside Obsidian that exposes the TypeScript Plugin API to the work-buddy Python package.

## Environment & Tooling

- **Language:** TypeScript with `"strict": true`
- **Package manager:** npm
- **Bundler:** esbuild (config in `esbuild.config.mjs`)
- **Target:** Obsidian Community Plugin — bundles to a single `main.js`
- **Desktop only** — uses Node.js `http` module

## Build

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm run lint     # ESLint
```

## File Structure

```
src/
  main.ts       # Plugin lifecycle (keep minimal)
  server.ts     # HTTP server with pattern-matching router
  handlers.ts   # All endpoint handlers
  settings.ts   # Settings interface and settings tab
styles.css      # Status bar and modal styling
```

## Key Conventions

- **Keep `main.ts` small.** Only plugin lifecycle: load settings, start bridge, register routes. All logic belongs in other modules.
- **No external runtime dependencies.** Only `obsidian` types at runtime. Everything bundles into `main.js`.
- **Externalized modules:** `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, and all Node.js builtins are external in esbuild.
- **localhost only.** The server binds to `127.0.0.1`. No outbound network requests.
- **Eval is gated.** The `/eval` endpoint is controlled by a settings toggle.
- Use `this.register*` helpers for all listeners and intervals (cleanup on unload).
- Use stable command IDs — don't rename after release.

## Release Process

1. Bump `version` in `package.json`
2. Run `npm version <new-version>` (auto-bumps `manifest.json` and `versions.json`)
3. Push the tag — GitHub Actions builds and creates the release with `main.js`, `manifest.json`, `styles.css`

## Do / Don't

**Do:**
- Add endpoints as handler functions in `handlers.ts`
- Follow Obsidian's developer policies and plugin guidelines
- Test by copying build artifacts to a vault's plugin directory

**Don't:**
- Add network calls without clear justification and documentation
- Ship telemetry or external service calls without opt-in
- Commit build artifacts (`main.js` is gitignored)
- Import from `work_buddy` Python — this plugin is TypeScript only
