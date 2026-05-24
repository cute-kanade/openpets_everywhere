# Desktop Frontend Refactor

## Current Situation

The desktop app now uses the React Control Center as the production management UI. Pets, Settings, Plugins, and Integrations are routed inside the singleton Control Center window, and tray actions target those routes directly.

The legacy generated task-window UI has been removed: `apps/desktop/preload.cjs`, `apps/desktop/src/plugins-window.ts`, and the legacy plugins-window test are gone. Transparent pet windows and plugin SDK windows remain separate lightweight renderers.

## Goal

Move the desktop management UI from generated HTML/CSS strings and preload-driven DOM updates to a React + Tailwind Control Center, while keeping desktop pet windows lightweight and separate.

## End Goal

The end goal is a single polished desktop management experience for OpenPets:

```text
Tray app
  ├─ animated desktop pet windows
  └─ one React/Tailwind Control Center
       ├─ Dashboard
       ├─ Pets
       ├─ Integrations
       ├─ Plugins
       └─ Settings
```

The Control Center should become the one place where users manage everything:

- choose and install pets
- configure coding-agent integrations
- manage plugins
- tune settings
- inspect status/errors/update prompts

The old separate task windows should eventually disappear. The tray should still exist, but tray actions should route into the Control Center instead of opening independent windows.

The pet windows themselves should stay separate from React. They are performance- and behavior-sensitive transparent desktop windows, so they should remain small, focused renderers responsible only for showing pets, speech bubbles, and reactions.

Final architecture target:

- **Main process**: app lifecycle, tray, state, IPC handlers, services, pet/plugin/integration logic.
- **Control Center renderer**: React UI, routes, forms, visual polish, local UI state.
- **Preloads**: narrow typed bridges only, no DOM rendering.
- **Pet renderers**: lightweight sprite/speech renderers, not part of Control Center.

From a product perspective, the end state should feel like a clean native-quality companion app rather than a set of separate utility dialogs.

## Current Direction

- Keep the app tray-first.
- Keep existing transparent pet windows outside React.
- Use a single Control Center window for management UI.
- Route tray actions into Control Center pages instead of independent task windows.
- Keep transparent pet windows separate from React.

## Phase 1: Pets Preview

Implemented first as a reviewable prototype and now promoted into the primary management shell:

- `Control Center...` opens the React renderer.
- Pet management opens through the Control Center Pets route.
- Renderer lives under `apps/desktop/src/renderer/`.
- Vite outputs packaged assets to `apps/desktop/dist/renderer/`.
- `control-center-preload.cjs` exposes narrow page-specific APIs.

The Pets page includes:

- installed pets
- catalog pets
- catalog pagination
- catalog search
- Codex pets
- pet selection/detail pane
- install/import/set default/remove actions
- animated sprite-frame preview
- styling based on the existing Pet Manager and Integrations pages

## What We Changed

### Renderer foundation

Added a modern renderer stack for the desktop app:

- React
- ReactDOM
- Vite
- TailwindCSS
- PostCSS
- Autoprefixer

New renderer files live in:

```text
apps/desktop/src/renderer/
```

Production renderer output is built to:

```text
apps/desktop/dist/renderer/
```

### Control Center window

Added a dedicated Control Center BrowserWindow in `apps/desktop/src/windows.ts`.

Important details:

- It is a separate singleton window.
- It does not use the old task-window data URL system.
- It keeps the usual Electron hardening:
  - sandbox enabled
  - context isolation enabled
  - Node integration disabled
  - navigation blocked
  - `window.open` blocked
- In development, it can load `OPENPETS_RENDERER_URL`, but only from loopback hosts.
- In packaged builds, it loads `dist/renderer/index.html`.

### Tray integration

Tray items now route to the Control Center singleton:

- `Control Center...`
- `Manage Pets...` → Pets route
- Plugins, Integrations, and Settings → matching Control Center routes

### Narrow preload bridge

Added:

```text
apps/desktop/control-center-preload.cjs
```

It exposes narrow, page-specific methods to the React renderer. It now covers Pets, Settings, Plugins, and Integrations without exposing `ipcRenderer` directly.

Pets methods include:

- `getPetsState`
- `getCatalog`
- `getCatalogPage`
- `getCatalogSearch`
- `getCodexPets`
- `setDefaultPet`
- `installPet`
- `importCodexPet`
- `removePet`

Settings methods include startup preferences, launch-at-login, pet scale, reaction animation mapping, update checks, and default pet position reset.

Plugins methods include plugin snapshots, catalog snapshots, enable/disable, config save, reload, command execution, local plugin loading, catalog install/update, and uninstall.

Integrations methods include agent setup snapshots, setup actions, and command path updates for Claude Code, OpenCode, and Cursor.

It does not expose `ipcRenderer` directly.

### Narrow page state

The Control Center does not receive the full app state. It receives narrowed page snapshots only.

The Pets page receives:

- default pet id
- installed pets

The Settings page receives only settings preferences/options needed by the route.

The Plugins page receives safe plugin and catalog records from `PluginService`, intentionally excluding raw install paths and manifest paths.

The Integrations page receives the existing narrowed agent setup snapshot used by the legacy task window: status/details for Claude Code, OpenCode, Cursor, Pi guidance, command paths, pet routing choices, and safe previews.

This avoids exposing unrelated state to the new renderer.

### Pets page UI

The new Pets page now supports:

- installed pet list
- remote catalog pets
- catalog pagination
- catalog search
- Codex pets
- search/filter UI
- set default
- install catalog pet
- import Codex pet
- remove pet
- detail panel
- animated sprite-frame preview

### Settings page UI

The Control Center Settings page now supports:

- show-pet-on-launch preference
- launch-at-login preference
- pet scale selection
- reaction-to-animation mapping
- default pet position reset
- compact system/update status
- default-pet reaction previews using the `openpets-pet-preview:` protocol
- bottom-center floating notifications that do not shift layout

Settings is now served by the Control Center route.

### Plugins page UI

The Control Center Plugins page now supports:

- gallery-first plugin hub
- installed/catalog/local/broken filters
- catalog refresh and local plugin loading in the bottom utility row
- plugin install from catalog
- enable/disable directly from plugin cards
- on-demand configuration modal instead of a persistent split inspector
- dynamic config forms for supported plugin schema fields
- command execution when plugins expose commands
- reload, update, and uninstall actions
- safe no-op/cancel feedback for install/update/local-load flows

Plugins is now served by the Control Center route; broken plugins cannot be re-enabled until fixed.

### Integrations page UI

The Control Center Integrations page now supports:

- grid-first integration hub with icons and status pills
- direct install/connect actions from Claude Code, OpenCode, and Cursor cards
- detail inspector opened by Configure/View setup buttons
- Claude MCP setup, replace/remove, hooks, instructions, pet routing, command paths, and advanced previews
- OpenCode global setup, remove, pet routing, command paths, and config preview
- Cursor MCP setup, replace/remove, pet routing, MCP preview, and Cursor rules preview
- Pi manual setup guidance
- polished disabled cards for future editor integrations

Integrations is now served by the Control Center route, including command-source selection for published, bundled, or local development CLI modes.

### Dashboard UI

The Control Center Dashboard now supports:

- default companion overview with animated sprite preview
- quick navigation into pet selection
- message and reaction activity totals
- top companion and top reaction summaries
- last-interaction timestamp
- compact system health for installed pets, plugins, catalog, updates, and app version

Dashboard is now the default Control Center landing route.

### Build/test integration

Updated desktop scripts/configs so the new renderer participates in normal validation.

Important files:

- `apps/desktop/package.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/tailwind.config.cjs`
- `apps/desktop/postcss.config.cjs`
- `apps/desktop/tsconfig.renderer.json`
- `apps/desktop/electron-builder.yml`
- `apps/desktop/scripts/run-tests.mjs`

Validated with:

```bash
pnpm --filter @open-pets/desktop typecheck
pnpm --filter @open-pets/desktop build
pnpm --filter @open-pets/desktop test
node --check apps/desktop/control-center-preload.cjs
```

All passed.

## Styling Principles

Reuse the current polished desktop visual language:

- light blue gradient background
- white glass cards
- soft blue shadows
- navy text
- brand blue CTAs
- rounded mono buttons and status pills
- orange Originals filter accent
- two-column gallery/detail layout

## Security Constraints

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- no direct `ipcRenderer` exposure
- deny navigation, redirects, and `window.open`
- dev renderer URL allowed only for loopback hosts in non-packaged builds
- Control Center receives narrow page snapshots, not full app state

## Migration Status and Next Order

Completed phases:

- Manual Pets review and refinement
- Control Center routing/shell
- Settings migration
- Plugins migration
- Integrations migration
- Tray route switch to Control Center
- Legacy generated task-window UI removal

Remaining follow-up:

- Continue manual smoke coverage for tray route retargeting, plugin workflows, and integration setup flows.

## Validation Commands

Use these after each phase:

```bash
pnpm --filter @open-pets/desktop typecheck
pnpm --filter @open-pets/desktop build
pnpm --filter @open-pets/desktop test
node --check apps/desktop/control-center-preload.cjs
```
