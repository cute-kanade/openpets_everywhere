# OpenPets Plugins

OpenPets now has a first-party plugin platform for optional desktop-pet behaviors. The desktop app remains responsible for rendering pets, tray/window UI, persistence, IPC, permission checks, sandboxing, and safety. Plugins add narrowly scoped behavior such as reminders, focus timers, and developer notifications.

The guiding model is:

> OpenPets is the pet runtime. Plugins are optional, permissioned behaviors that make the pet feel useful and alive.

## Current status

The current implementation includes:

- Manifest v2 JavaScript plugins, with manifest v1 declarative plugin compatibility retained.
- A sandboxed JavaScript plugin host in the desktop app.
- Capability-based SDK access for pet actions, schedules, storage, config, commands, status, logging, and approved HTTP requests.
- Catalog v2 support at `https://openpets.dev/plugins/catalog.v2.json`, with v1 fallback for older/declarative catalog support.
- Local developer plugin loading through explicit environment variables.
- Host-rendered plugin configuration and command UI in the desktop Plugins window.
- Three first-party JavaScript plugins under the web repo:
  - `openpets.daily-reminders`
  - `openpets.pomodoro`
  - `openpets.github-notifications`

The initial public plugin release should include all three first-party plugins together. Daily Reminders proves scheduling and list configuration, Pomodoro proves stateful storage plus commands/status, and GitHub Notifications proves the network proxy and host allowlist model.

## Non-goals for the current release

The platform intentionally does **not** support:

- Arbitrary Node.js plugins.
- Main-process plugin execution.
- Shell, native module, or package-install permissions.
- Broad filesystem access.
- Wildcard network access.
- Plugin-rendered settings UI.
- OAuth, token storage, or private GitHub repository access.
- Unreviewed third-party marketplace installs.
- A generic automation builder or full cron/RRULE engine.

## Plugin types

### Manifest v2 JavaScript plugins

New production plugins should use manifest v2 and `runtime: "javascript"`.

JavaScript plugins provide one browser-compatible JavaScript entry file and register with:

```js
OpenPetsPlugin.register({
  async start(ctx) {
    // Register schedules, commands, status, config listeners, etc.
  },
  async stop() {
    // Optional cleanup.
  },
})
```

The entry file is loaded by the sandbox host. It does not run in Node and cannot import app internals.

### Manifest v1 declarative plugins

The older declarative timer/action runtime remains supported for compatibility. It can still run simple timer-triggered `pet.speak` and `pet.react` actions, but new first-party plugins should use manifest v2 JavaScript because it supports commands, status, storage, config change listeners, and network proxying.

## Runtime architecture

Each enabled JavaScript plugin runs in its own hidden Electron renderer:

- `BrowserWindow({ show: false })`
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- unique non-persistent session partition per plugin run
- denied renderer permission requests
- denied downloads
- denied `window.open`
- prevented navigation/redirects after load
- raw renderer network blocked by session request policy
- storage/cache cleared when the plugin host stops
- startup timeout and crash/unresponsive handling

Plugin code talks to OpenPets only through `plugin-sdk-preload.cjs`, which exposes a small SDK object. All SDK calls cross validated IPC handlers in the main process. Values crossing IPC are normalized to clone-safe data.

The host loads plugin code from the installed/snapshotted plugin entry. For local development and catalog installs, OpenPets validates the manifest path, install root containment, entry containment, and symlink restrictions before running code.

## Lifecycle

For each enabled JavaScript plugin, desktop startup or reload does this:

1. Read the persisted plugin record.
2. Read and validate the installed manifest.
3. Check the plugin is enabled and not catalog-disabled.
4. Verify requested permissions are approved.
5. Verify approved network hosts are a subset of manifest-declared hosts.
6. Resolve the JavaScript entry inside the install directory.
7. Create an isolated plugin host.
8. Inject the SDK preload.
9. Run the plugin registration handshake.
10. Call `start(ctx)`.
11. Keep registered schedules, commands, status, and config listeners in host-managed runtime state.

On reload, disable, uninstall, crash, or startup failure, OpenPets cancels schedules, clears commands/status/listeners, calls plugin `stop()` when possible, removes the SDK IPC handler, destroys the host window, and marks the plugin broken if the failure is actionable.

## Manifest v2 shape

Example:

```json
{
  "manifestVersion": 2,
  "id": "openpets.daily-reminders",
  "name": "Daily Reminders",
  "version": "1.0.0",
  "description": "Recurring local reminders delivered by your pet.",
  "author": "OpenPets",
  "runtime": "javascript",
  "entry": "index.js",
  "sdkVersion": "1.0.0",
  "permissions": ["pet:speak", "pet:reaction", "schedule", "storage", "status", "commands"],
  "configSchema": {}
}
```

Important fields:

- `manifestVersion`: `2` for JavaScript plugins.
- `id`: stable package id, using reverse-DNS style for first-party plugins.
- `version`: semver plugin version.
- `runtime`: currently `"javascript"` or `"declarative"`.
- `entry`: relative path to the single plugin JS entry.
- `sdkVersion`: SDK contract version expected by the plugin.
- `permissions`: declared capabilities.
- `network.hosts`: exact approved external hostnames the plugin may request through SDK HTTP.
- `configSchema`: host-rendered settings schema.

## Permissions

Current JavaScript plugin permissions:

- `pet:speak`: show pet speech bubbles.
- `pet:reaction`: trigger pet reactions.
- `schedule`: schedule one-shot, interval, or daily callbacks.
- `storage`: use per-plugin persisted state.
- `status`: show status text/tone in the Plugins UI.
- `commands`: register host-rendered commands/buttons.
- `network`: request approved HTTPS hosts through OpenPets' HTTP proxy.

Permission changes require reapproval. Network host changes also require reapproval, even if `network` was already approved.

## SDK v1

The SDK is intentionally small and capability-based.

```ts
type OpenPetsPluginContext = {
  pet: {
    speak(message: string): Promise<void>
    react(reaction: string): Promise<void>
  }
  schedule: {
    once(id: string, delayMs: number, handler: () => void | Promise<void>): Promise<void>
    every(id: string, intervalMs: number, handler: () => void | Promise<void>): Promise<void>
    daily(id: string, spec: string | { time: string; days?: number[] }, handler: () => void | Promise<void>): Promise<void>
    cancel(id: string): Promise<void>
    cancelAll(): Promise<void>
  }
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }
  config: {
    get<T = unknown>(): Promise<T>
    onChange(handler: (config: T) => void | Promise<void>): () => void
  }
  commands: {
    register(command: { id: string; title: string; description?: string }, handler: () => void | Promise<void>): Promise<void>
    unregister(id: string): Promise<void>
  }
  status: {
    set(status: string | { text: string; tone?: "info" | "success" | "warning" | "error" }): Promise<void>
    clear(): Promise<void>
  }
  http: {
    fetch(url: string, options?: { method?: "GET"; headers?: Record<string, string>; timeoutMs?: number }): Promise<{
      status: number
      ok: boolean
      headers: Record<string, string>
      text: string
      json?: unknown
    }>
  }
  log: {
    debug(...args: unknown[]): Promise<void>
    info(...args: unknown[]): Promise<void>
    warn(...args: unknown[]): Promise<void>
    error(...args: unknown[]): Promise<void>
  }
}
```

### SDK validation and quotas

The main-process SDK bridge validates and limits plugin behavior:

- Pet messages/reactions go through normal OpenPets validation.
- Schedule ids and command ids must be short safe identifiers.
- Interval schedules have a minimum delay.
- Daily schedules require `HH:mm` and optional weekdays `0-6`.
- Storage keys are restricted and plugin storage has a size quota.
- Commands have title/description length limits.
- Status text/tone is validated.
- HTTP is GET-only, HTTPS-only, redirect-blocked, response-size capped, and host allowlisted.
- HTTP hostnames are DNS-checked to avoid private/loopback metadata targets.
- Pet actions, logs, and HTTP calls have per-minute rate limits.

## Config schema and Plugins UI

OpenPets renders plugin configuration itself. Plugins declare fields in `configSchema`; they do not render arbitrary settings UI.

Supported config field types include:

- text/string fields
- numbers
- booleans
- selects
- times
- lists
- multi-selects

The Plugins window can:

- show installed plugins
- show enabled/broken/deprecated/catalog-disabled state
- enable/disable plugins
- save config
- reload plugins
- load local plugins
- display plugin status
- display and run registered plugin commands
- discover/install/update/uninstall catalog plugins

## Plugin persistence

Plugin install/runtime state is stored separately from plugin data.

The plugin state record tracks:

- id/version
- install and manifest paths
- source: `catalog` or `local`
- manifest version and runtime
- SDK version
- enabled/broken state
- approved permissions
- approved network hosts
- catalog disabled/deprecated metadata
- user config

`ctx.storage` data is stored outside config in per-plugin JSON files under app data. Writes are immediate and atomic; uninstall removes the plugin's storage file.

## Catalog publishing

Catalog v2 is the JavaScript plugin catalog. The desktop app defaults to:

```txt
https://openpets.dev/plugins/catalog.v2.json
```

and falls back to v1 where needed.

Catalog entries include compatibility/status metadata such as runtime, SDK version, min/max OpenPets version, disabled/deprecated flags, and network host information. Disabled catalog entries cannot be newly enabled and are disabled locally when catalog metadata marks them disabled.

Plugin ZIP installs validate:

- catalog id/version match
- SHA-256 package hash
- ZIP path safety
- manifest presence and size
- manifest id/version match
- JavaScript entry presence inside package
- safe install/uninstall path containment

The web repo builds catalog artifacts with:

```bash
cd web
node scripts/sync-plugins.js --dry-run --skip-r2
```

Publishing uploads plugin ZIPs and regenerates public catalog files.

## Local development workflow

Local plugin loading is explicit and development-only. Desktop reads path lists from environment variables:

- `OPENPETS_DEV_PLUGIN_ROOTS`: path-list of directories whose child folders are scanned for `openpets.plugin.json`.
- `OPENPETS_DEV_PLUGIN_PATHS`: path-list of exact plugin folders.

For this repository, run from the root:

```bash
pnpm dev:desktop:plugins
```

This points desktop at `web/plugins/official`, snapshots each official plugin into the app data `plugins-dev` directory, auto-approves permissions for those explicit dev paths, preserves enabled state when permissions/hosts remain compatible, and starts the runtime.

To load one plugin manually:

```bash
OPENPETS_DEV_PLUGIN_PATHS=/absolute/path/to/plugin pnpm dev:desktop
```

Local plugin snapshots copy `openpets.plugin.json` and the declared JavaScript entry into app data. After editing plugin source, restart desktop or reload/load the plugin again through the Plugins UI/dev command path so the snapshot updates.

## First-party plugins

### Daily Reminders

Purpose: user-defined recurring reminders delivered by the pet.

Uses:

- `schedule` for interval and daily reminders
- `pet:speak` and `pet:reaction` for reminder delivery
- `storage` for last-triggered metadata
- `commands` for test/reload actions
- `status` for current reminder summary
- `config.onChange` to reschedule after config edits

Config includes reminder list items with message, reaction, schedule type, time, days, interval, and enabled state.

### Pomodoro

Purpose: focus/break session timer with pet feedback and controls.

Uses:

- `storage` for current phase/session state
- `schedule` for phase-end timers
- `commands` for start, pause/resume, stop/reset, and break controls
- `status` for current phase/remaining state
- `pet:speak` and `pet:reaction` for start/complete feedback

Config includes focus length, break lengths, long-break cadence, auto-start options, and custom messages/reactions.

### GitHub Notifications

Purpose: public repository release/workflow notifications for developers.

Initial scope is intentionally public-only. There is no OAuth, no tokens, and no private repository access.

Uses:

- `network` through the SDK HTTP proxy
- approved host: `api.github.com`
- `storage` for baselines, etags, and last check state
- `schedule` for polling
- `commands` for check now and reset baseline
- `status` for poll/check summaries
- `pet:speak` and `pet:reaction` for notifications

Config includes repository list, poll interval, notification toggles, and message/reaction templates.

## Logging and troubleshooting

Desktop logs are written by the existing logger to:

```txt
<Electron userData>/logs/openpets.log
```

Plugin runtime events use the `plugin` log scope. Important messages include:

- `plugin started`
- `plugin marked broken`
- `plugin log`
- dev plugin path/root load failures

Plugin UI may sanitize detailed broken reasons for users, but the log should preserve enough detail for development while still using the logger's redaction rules.

Common development failures:

- Entry path missing or outside install path.
- Permission or network host not approved after manifest changes.
- Invalid config value according to manifest schema.
- Invalid schedule/command/storage/status input.
- HTTP host not in manifest `network.hosts` or not approved.
- Attempting to pass non-cloneable values through SDK IPC.

## Validation commands

Desktop plugin/runtime validation:

```bash
pnpm --filter @open-pets/desktop test
```

Web plugin catalog dry-run:

```bash
cd web
node scripts/sync-plugins.js --dry-run --skip-r2
```

Manual dogfood:

```bash
pnpm dev:desktop:plugins
```

Then open tray → Plugins, enable/configure plugins, run commands, and verify status/log output.

## Future work

Potential later additions:

1. Calendar plugin, starting with local or `.ics` support before OAuth.
2. Local webhook/plugin for automation tools.
3. More host-rendered config field types.
4. Signed reviewed third-party plugin submissions.
5. Plugin marketplace/search only after trust, review, and update policies are mature.
6. OAuth/private GitHub support only after secure token storage and account UX are designed.
7. A no-code rules UI for safe user-created automations.

Do not add arbitrary executable third-party plugin support until sandboxing, permissions, catalog review, update rollback, and support processes are mature.
