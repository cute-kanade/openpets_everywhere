# Desktop App

The desktop app (`apps/desktop/`) is the heart of OpenPets: the only long-lived
process, owner of all state, windows, the tray, pet rendering, the plugin
runtime, and the local IPC server that agents talk to. This doc explains its
process model, the major subsystems, and the rules that keep it secure and
stable. For the pet rendering specifics see [pets.md](pets.md); for the IPC wire
contract see [ipc.md](ipc.md); for plugins see [plugins.md](plugins.md).

Source map: `apps/desktop/codemap.md` and `apps/desktop/src/codemap.md` are the
authoritative file-by-file maps. This doc is the narrative on top of them.

## Process model

Electron gives us a **main process** and multiple **renderer processes**. In
OpenPets:

- The **main process** (`src/main.ts` and the modules it orchestrates) holds all
  authority: state, lifecycle, tray, windows, IPC, leases, catalog/install,
  plugins, i18n.
- **Renderers** are sandboxed and powerless by default. Each gets a *narrow*
  preload bridge exposing only the APIs it needs:
  - The **Control Center** renderer (the React/Tailwind UI) via
    `control-center-preload.cjs`.
  - **Pet windows** (transparent, frameless, always-on-top) via `pet-preload.cjs`.
  - **Plugin JS hosts** and **plugin panels** via `plugin-sdk-preload.cjs`.

There is **no default main window**. The app is tray-first: tray actions open
the singleton Control Center routed to a specific page. A single-instance lock
(`app.requestSingleInstanceLock()`) focuses the existing instance instead of
launching a second one.

## Startup sequence

`main.ts` runs a deterministic bootstrap (see `src/codemap.md` for the exact
order): install lifecycle handlers → initialize app state → initialize the
logger → create the tray → start the local IPC server → initialize the plugin
service (with the Electron JS host) → optionally show the default pet. Shutdown
runs the reverse: stop the plugin service, IPC server, and pet windows on quit.

Key files: `main.ts` (entry/bootstrap), `lifecycle.ts` (app events + cleanup),
`state.ts` (shell pause flag).

## Subsystems

### Tray & windows

- `tray.ts` builds the tray icon (`assets.ts` loads it with a generated
  fallback) and the context menu, including update status and route-targeted
  Control Center entries and a "open logs" action.
- `windows.ts` is the Control Center coordinator: it creates the hardened
  `BrowserWindow`, loads the Vite renderer (dev) or packaged `dist/renderer`
  (prod), targets a route, registers all renderer-facing IPC handlers, builds
  the Dashboard snapshot, and defines the internal asset protocols.
- `display.ts` provides screen-geometry helpers for positioning pet windows.

### Control Center (renderer)

The React/Tailwind UI under `src/renderer/`. Pages: **Dashboard, Pets,
Integrations, Plugins, Settings**. It is a pure consumer of main-process
snapshots and actions exposed over the preload bridge — it holds no privileged
capability of its own. The renderer is the only "frontend" in scope for these
docs (the `web/` marketing site is out of scope). See
`src/renderer/src/codemap.md` for component structure.

### Pet windows

Pet rendering lives in `pet-window.ts` plus the two controllers
(`default-pet-controller.ts`, `agent-pet-controller.ts`) and the motion/mapping
helpers. This is covered in depth in [pets.md](pets.md).

### Local IPC server

`local-ipc.ts` runs a `net.Server` over a Unix socket / Windows named pipe /
TCP, routes a versioned JSON protocol, and writes a discovery file so clients
can find it. The lease manager (`lease-manager.ts`) sits behind it. Full
contract in [ipc.md](ipc.md).

### App state

`app-state.ts` persists a versioned JSON document under
`userData/openpets-state.json` using atomic temp-write + rename. It holds
installed pets, the default-pet config, reaction→animation overrides, onboarding
state, and locale preference. `app-state-core.ts` holds pure helpers (scale
options, onboarding normalization) that are testable without Electron.

### Plugin subsystem

A large, self-contained subsystem (`plugin-*.ts`) covering manifests, state,
runtime, the sandboxed JS host, the permission-checked SDK bridge, catalog/local
install, assets, panels, diagnostics, and platform settings. Fully documented in
[plugins.md](plugins.md) and [sdk.md](sdk.md).

### Agent setup

`agent-setup.ts` detects installed agents and runs configuration actions (MCP
add/replace/remove, hooks install/uninstall/doctor, memory file install),
delegating to the integration packages. `claude-memory.ts` manages the Claude
instructions file. See [agent-integrations.md](agent-integrations.md).

### Catalog & installation

`catalog.ts` fetches the pet catalog (v3 paginated, with v2/fixture fallback);
`pet-installation.ts` downloads + validates + extracts pet ZIPs; `codex-pets.ts`
imports locally-developed pets. See [catalog.md](catalog.md) and [pets.md](pets.md).

### i18n

`src/i18n/` resolves the active locale and serves localized host UI text and pet
reaction speech, with English fallback. See [i18n.md](i18n.md).

### Updates

`update-checker.ts` polls GitHub releases and surfaces update status to the tray
and Dashboard; `update-version.ts` does version parsing/comparison.

### Logging

`logger.ts` provides scoped, structured logging (scopes: `app`, `ipc`, `lease`,
`pet.*`, `state`, `tray`, `ui`) with log rotation (~2MB) and redaction of
sensitive data, written to `userData/logs/openpets.log`. Renderer diagnostics
should be routed here so failures are visible in the log file, not only DevTools
(see the logging guidance in `AGENTS.md`).

### Desktop analytics

The desktop app has a privacy-preserving PostHog analytics client in
`analytics.ts`. It runs from the main process only, posts to the self-hosted
OpenPets PostHog project, and is disabled in dev unless
`OPENPETS_ANALYTICS_DEBUG=1` is set. Users control capture in Settings with the
**Share privacy-preserving usage analytics** toggle. Remote analytics uses a
random local `distinctId`; local app state also keeps dashboard counters such as
message/reaction totals, per-pet activity counts, first-run/first-reaction
milestone timestamps, and the consent value.

Analytics events are intentionally product/health level: app startup, first run,
pet installs, default-pet changes, agent setup outcomes, IPC connection/leases,
agent reaction categories, plugin install/enable/command usage, and update/check
health. Do not send prompts, code, file paths, repo names, terminal commands,
pet speech, clipboard contents, plugin config values, local usernames, hostnames,
raw stack traces, or raw local pet/plugin/command identifiers. Add only bounded
enum-style properties such as platform, app version, locale, source, agent type,
runtime, result, and safe error codes.

## Security model

This is non-negotiable surface area. The app handles remote content (catalogs,
ZIPs) and runs third-party plugin code, so it is defensive by construction:

- **Sandboxed renderers** with `contextIsolation`; capabilities reach them only
  through narrow `contextBridge` preload APIs.
- **Strict CSP**: `default-src 'none'`, inline styles only. Any new
  renderer-visible URL scheme, image source, dev endpoint, or internal protocol
  **must** be added to the CSP in *both* `apps/desktop/vite.config.ts` and
  `apps/desktop/src/renderer/index.html`. Common pet image protocols:
  `openpets-codex:`, `openpets-installed:`, `openpets-pet-preview:`. Forgetting
  the CSP makes images fall back to the default pet even when install/render
  logic is correct. (This is a documented, easy-to-hit footgun in `AGENTS.md`.)
- **Mock keychain** to avoid OS credential prompts.
- **IPC network security**: TCP mode is restricted to loopback/private
  addresses; public IPs and hostnames are rejected. See [ipc.md](ipc.md).
- **Defensive I/O**: atomic writes everywhere; path-traversal and symlink checks
  on every filesystem boundary; strict ZIP entry validation (`zip-safety.ts`).
- **Plugin sandbox**: plugins run in hidden, session-partitioned BrowserWindows
  with navigation/window-open hardening and permission-gated SDK calls. See
  [plugins.md](plugins.md).

## Packaging

`electron-builder.yml` configures cross-platform packaging (macOS/Windows/Linux)
with ASAR. Bundled mode unpacks the integration binaries from ASAR so hooks/MCP
can spawn them. `scripts/release-local.mjs` automates a macOS-local release with
a GitHub draft. See [development.md](development.md) for the release flow.

## Where to look first

| If you're touching… | Start in |
|---------------------|----------|
| Tray menu / Control Center routing | `tray.ts`, `windows.ts` |
| Pet appearance / animation | `pet-window.ts`, `reaction-animation-mapping.ts` ([pets.md](pets.md)) |
| Agent → pet command path | `local-ipc.ts`, `lease-manager.ts` ([ipc.md](ipc.md)) |
| Persisted settings | `app-state.ts` |
| Plugin behavior | `plugin-service.ts` + `plugin-*.ts` ([plugins.md](plugins.md)) |
| Agent configuration | `agent-setup.ts` ([agent-integrations.md](agent-integrations.md)) |
| Install / catalog | `catalog.ts`, `pet-installation.ts` ([catalog.md](catalog.md)) |
| Anything renderer-visible with a URL | also update the CSP (both files) |
</content>
