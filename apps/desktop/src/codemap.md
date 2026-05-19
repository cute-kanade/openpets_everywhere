# apps/desktop/src/

## Responsibility

Core TypeScript source for the OpenPets desktop application. Organized into: lifecycle management, state persistence, UI windows, pet rendering, IPC server, agent integrations, pet installation/management, and the manifest-only plugin subsystem.

## Design

- **Modular Controllers**: Separate controllers for default pet vs agent pets (lease-based)
- **Protocol-First IPC**: Versioned JSON protocol over TCP/Unix sockets with token auth
- **Defensive I/O**: All file operations use temp+rename for atomicity, path traversal validation, symlink checks
- **Validation at Boundaries**: Catalog, ZIP entries, pet metadata, and IPC params all strictly validated
- **Lease Pattern**: Agent pets use expiring leases (15s TTL) with heartbeats; default pet is persistent
- **Sandboxed HTML**: All UI is data-URL or file-URL HTML with inline CSS, no external resources
- **Structured Logging**: Scoped logging (app, ipc, lease, pet.*, state, tray, ui) with log rotation and redaction
- **Reaction Animation Mapping**: User-configurable mapping from reaction types to sprite animation states
- **Manifest-Only Plugins**: Plugins are declarative `openpets.plugin.json` manifests with approved permissions, persisted config, safe path checks, and timer-triggered pet actions; JavaScript runtime is recognized but unsupported.

## Flow

**Main Process Flow**:
```
main.ts
├── lifecycle.ts (app events, cleanup)
├── logger.ts (structured logging init)
├── app-state.ts (state init)
├── plugin-service.ts (plugin state/runtime init)
├── tray.ts (tray creation)
├── local-ipc.ts (IPC server start)
└── windows.ts (UI handlers)
```

**IPC Request Flow**:
```
local-ipc.ts → parseIpcRequest() → handleRequest()
├── hello/status/pets.list/pets.install
└── lease.acquire/heartbeat/release
    └── lease-manager.ts
        ├── resolveTarget() (default vs explicit pet)
        ├── onFirstExplicitLease → agent-pet-controller.showAgentPet()
        └── onLastExplicitLease → agent-pet-controller.closeAgentPetIfOpen()
        └── Logging via logger.ts (ipc, lease scopes)
```

**Pet Display Flow**:
```
pet-window.ts
├── createDefaultPetWindow() / createAgentPetWindow()
├── loadDefaultPetContent() / loadExplicitPetContent()
│   ├── HTML generation with CSS sprite animation
│   ├── reaction-animation-mapping.ts (resolveReactionSpriteState)
│   ├── reaction-messages.ts (pickReactionMessage for bubbles)
│   └── Speech bubbles with status badges
└── pet-preload.cjs (renderer IPC for drag/click-through)
```

**Agent Setup Flow**:
```
windows.ts (IPC handlers)
└── agent-setup.ts
    ├── detectClaudeCodeStatus() (claude --version, claude mcp list)
    ├── runAgentSetupAction()
    │   ├── configure/replace/remove (MCP commands)
    │   ├── install-memory (claude-memory.ts)
    │   └── install-hooks/uninstall-hooks/doctor-hooks (@open-pets/claude)
    ├── OpenCode global config management (@open-pets/opencode)
    └── Cursor global MCP config management (@open-pets/cursor)
```

**Pet Installation Flow**:
```
pet-installation.ts
├── installPet()
│   ├── getCatalogPet() → catalog.ts
│   ├── downloadPetZip() → validate ZIP magic
│   ├── extractPetZip() → yauzl with entry validation
│   └── installPetState() → app-state.ts
└── importCodexPet() → codex-pets.ts
```

**Plugin Flow**:
```
main.ts → initializePluginService(userData, defaultPluginPetApi).start()
├── plugin-state.ts reads/writes userData/openpets-plugin-state.json
├── plugin-runtime.ts reloads enabled manifests and schedules timer triggers
│   └── plugin-pet-api.ts → default-pet-controller external say/react APIs
├── plugin-service.ts orchestrates UI actions, permission confirmation, config validation, install/update/uninstall/load-local, and runtime reloads
└── lifecycle.ts → stopPluginService() on quit

Plugins window:
tray.ts → openTaskWindow("plugins") → windows.ts → plugins-window.ts
└── openpets:plugins-* IPC handlers call PluginService methods

Catalog install/update:
plugin-catalog.ts → plugin-catalog-validation.ts
└── plugin-package.ts downloads HTTPS ZIP, validates SHA-256, extracts root manifest only, and installs to userData/plugins/{id}

Local development load:
plugin-local-loader.ts validates selected folder manifest and snapshots only openpets.plugin.json to userData/plugins-dev/{id}
```

## Integration Points

- **Within src/**:
  - `main.ts` → all modules (orchestrator)
  - `local-ipc.ts` ↔ `lease-manager.ts` ↔ `agent-pet-controller.ts`
  - `windows.ts` ↔ `app-state.ts`, `agent-setup.ts`, `catalog.ts`, `codex-pets.ts`
  - `windows.ts` ↔ `plugin-service.ts`, `plugins-window.ts` for plugin UI IPC and HTML
  - `pet-window.ts` ↔ `default-pet-controller.ts`, `agent-pet-controller.ts`
  - `pet-installation.ts` ↔ `app-state.ts`, `catalog.ts`, `zip-safety.ts`
  - `plugin-service.ts` ↔ `plugin-state.ts`, `plugin-runtime.ts`, `plugin-catalog.ts`, `plugin-package.ts`, `plugin-local-loader.ts`

- **To packages/**:
  - `@open-pets/claude`: `buildClaudeMcpPreview`, `installClaudeHooks`, `doctorClaudeHooks`, etc.
  - `@open-pets/opencode`: `prepareOpenCodeGlobalSetup`, `doctorOpenCodeGlobalSetup`
  - `@open-pets/cursor`: `planCursorMcpInstall`, `executeCursorMcpWrite`, `buildCursorRulesPreview`, etc.
  - `@open-pets/cli`: Version lookup for bundled mode

- **To System**:
  - File system: `app.getPath("userData")`, `userData/plugins/`, `userData/plugins-dev/`, `~/.codex/pets/`, `~/.claude/`, `~/.opencode/`
  - Network: `fetch()` to openpets.dev, GitHub API, plugin catalog at `https://openpets.dev/plugins/catalog.v1.json`, plugin ZIPs restricted to `https://zip.openpets.dev/plugins/`
  - Processes: `spawn()` for `claude`, `opencode`, `node`

## Key Modules

**Core**:
- `main.ts`: Entry, single-instance lock, bootstrap sequence
- `lifecycle.ts`: App event handlers (quit, window-all-closed, second-instance) with logging; stops plugin service, IPC, and pet windows on quit
- `state.ts`: Simple shell pause state
- `app-state.ts`: Persistent JSON state with V1 schema, atomic writes, reaction animation overrides
- `app-state-core.ts`: Pet scale options, onboarding normalization
- `logger.ts`: Structured logging with scopes (app, ipc, lease, pet.default, pet.agent, pet.window, state, tray, ui), log rotation, redaction

**UI**:
- `tray.ts`: Tray icon (nativeImage), context menu builder, update status integration, plugins entry, logs folder
- `windows.ts`: BrowserWindow factory, IPC handler registration, HTML generators for task windows, reaction animation settings, plugin UI IPC endpoints
- `assets.ts`: Tray icon loading with generated fallback
- `display.ts`: Screen geometry helpers, pet window positioning
- `plugins-window.ts`: Sandboxed data-URL HTML/CSS shell for Installed/Discover/Developer plugin management.

**Pets**:
- `pet-window.ts`: Window creation (transparent, frameless, always-on-top), HTML/CSS generation, sprite animation states, speech bubbles, status badges, transient displays
- `default-pet-controller.ts`: Default pet visibility, position persistence, transient reactions, status badges, logging
- `agent-pet-controller.ts`: Lease-triggered pet windows, dismissal tracking, transient displays, status badges, logging
- `built-in-pet.ts`: Built-in pet constant
- `reaction-messages.ts`: Message pools for each reaction type
- `reaction-animation-mapping.ts`: Reaction-to-animation state mapping, user-configurable overrides, sprite state definitions

**IPC**:
- `local-ipc.ts`: net.Server implementation, request routing, discovery file management, network security (loopback/private address filtering), logging
- `local-ipc-protocol.ts`: Protocol constants, request/response types, validation functions
- `local-ipc-paths.ts`: Platform-specific socket paths and discovery file locations
- `lease-manager.ts`: Lease lifecycle (acquire, heartbeat, release, cleanup), target resolution

**Installation**:
- `pet-installation.ts`: ZIP download, yauzl extraction with safety limits, pet validation
- `pet-paths.ts`: Safe path resolution for pet directories
- `codex-pets.ts`: Import from `~/.codex/pets/` with validation
- `codex-pets-core.ts`: Codex metadata validation constants
- `catalog.ts`: Remote catalog fetch with V3 pagination support, search, fixture fallback
- `catalog-validation.ts`: CatalogV2/V3 schema validation
- `zip-safety.ts`: ZIP entry path validation (traversal prevention, case collision detection)

**Plugins**:
- `plugin-manifest.ts`: Manifest V1 schema/types and validation for declarative runtime, permissions (`timer`, `pet:speak`, `pet:reaction`), config schema, timer triggers, and pet actions.
- `plugin-manifest-reader.ts`: Safe manifest reader with realpath/allowed-root checks, root filename enforcement, size limit, and expected id/version matching.
- `plugin-config.ts`: Config defaulting, replacement validation, and runtime resolution for string/number config references.
- `plugin-state.ts`: Persistent plugin state store (`openpets-plugin-state.json`) with atomic temp+rename writes, normalized records, approved permissions, config, source, and broken reason.
- `plugin-runtime.ts`: Declarative runtime that compiles enabled plugin timer triggers, verifies approved permissions, validates say/react payloads, schedules cancellable timers, and marks broken plugins on validation/action failure.
- `plugin-pet-api.ts`: Narrow adapter from plugin actions to default pet external `say`/`react` controller calls.
- `plugin-service.ts`: Application-facing plugin orchestrator for snapshots, enable/disable, config save, reload, catalog install/update, local load, uninstall, permission prompts, compatibility checks, and runtime reloads.
- `plugin-catalog.ts`: Remote plugin catalog fetch with timeout, redirect rejection, response size cap, cache, and refresh support.
- `plugin-catalog-validation.ts`: Catalog V1 schema validation, duplicate id checks, semver/SHA fields, permissions canonicalization, and optional minimum OpenPets version.
- `plugin-package.ts`: Catalog plugin package download/install with HTTPS host/path allowlist, SHA-256 verification, ZIP size/entry restrictions, manifest/catalog consistency checks, and safe uninstall path resolution.
- `plugin-local-loader.ts`: Developer loader that validates a selected local folder and snapshots only the manifest into `plugins-dev` with symlink/path/size protections.

**Agent Integration**:
- `agent-setup.ts`: Claude/OpenCode/Cursor detection, MCP configuration, hooks management, action journaling
- `claude-memory.ts`: Claude instructions file management (`~/.claude/openpets.md`)
- `update-checker.ts`: GitHub release polling, update status
- `update-version.ts`: Version parsing and comparison

**Tests** (excluded from detailed codemap coverage per repository conventions):
- Behavior tests live in `tests/*.test.ts` (compiled to `.test-dist/tests/`)
- Contract tests live in `contracts/*.contract.ts` (compiled to `.test-dist/contracts/`)
- Runtime checks (`check-*.ts`) remain in `src/` for packaging/validation (compiled to `dist/`)

## Data Flow Summary

| Source | Destination | Data |
|--------|-------------|------|
| Catalog API | `catalog.ts` | `CatalogV2/V3` JSON with pagination |
| ZIP Download | `pet-installation.ts` | Extracted to `userData/pets/{id}/` |
| `app-state.ts` | `userData/openpets-state.json` | Atomic JSON writes with reaction animation overrides |
| CLI via IPC | `local-ipc.ts` | `pet.react`, `pet.say`, `lease.*` |
| `lease-manager.ts` | `agent-pet-controller.ts` | Show/close agent pets |
| `windows.ts` | Renderer | State snapshots via IPC invoke |
| `agent-setup.ts` | Claude/OpenCode/Cursor CLI | MCP add/remove, config writes |
| All modules | `logger.ts` | Structured logs to `userData/logs/openpets.log` |
| Plugin catalog | `plugin-catalog.ts`/`plugin-service.ts` | Discoverable plugin metadata filtered by app version and install state |
| Plugin ZIP/local folder | `plugin-package.ts`/`plugin-local-loader.ts` | Validated manifest snapshot installed under `userData/plugins*` |
| `plugin-state.ts` | `userData/openpets-plugin-state.json` | Installed plugins, enabled flag, approved permissions, config, broken status |
| `plugin-runtime.ts` | `plugin-pet-api.ts` | Timer-triggered pet speech/reactions on the default pet |
| Plugins renderer | `windows.ts`/`plugin-service.ts` | Snapshot, enable, config, reload, install/update/uninstall, local-load operations |
