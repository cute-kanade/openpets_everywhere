# Desktop Frontend Refactor

## Current Situation

The desktop app currently has two UI systems:

1. **Existing production task windows**
   - Built from TypeScript-generated HTML/CSS strings in `apps/desktop/src/windows.ts` and `apps/desktop/src/plugins-window.ts`.
   - Rendered with manual DOM logic inside `apps/desktop/preload.cjs`.
   - Still used for the current production windows:
     - Pet Manager
     - Integrations
     - Plugins
     - Settings
     - Onboarding

2. **New React/Tailwind Control Center preview**
   - Added as a separate preview path.
   - Only the Pets page has been migrated so far.
   - Opened from the tray via `Control Center Preview...`.
   - Does not replace the old `Manage Pets...` window yet.

This means the refactor is intentionally incremental: the new UI can be reviewed without risking the existing desktop workflow.

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
       ├─ Settings
       └─ Onboarding
```

The Control Center should become the one place where users manage everything:

- choose and install pets
- configure coding-agent integrations
- manage plugins
- tune settings
- complete onboarding
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
- Preserve old task windows during migration as fallback.
- Introduce a single Control Center window for management UI.
- Migrate one page at a time, starting with Pets.

## Phase 1: Pets Preview

Implemented as a reviewable prototype behind a separate tray entry:

- `Control Center Preview...` opens the new React renderer.
- Existing `Manage Pets...` remains unchanged.
- Renderer lives under `apps/desktop/src/renderer/`.
- Vite outputs packaged assets to `apps/desktop/dist/renderer/`.
- `control-center-preload.cjs` exposes a narrow Pets-only API.

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

Added a new tray item:

```text
Control Center Preview...
```

The old item remains:

```text
Manage Pets...
```

So you can compare old and new UIs side-by-side.

### Narrow preload bridge

Added:

```text
apps/desktop/control-center-preload.cjs
```

It exposes only Pets-related methods to the React renderer:

- `getPetsState`
- `getCatalog`
- `getCatalogPage`
- `getCatalogSearch`
- `getCodexPets`
- `setDefaultPet`
- `installPet`
- `importCodexPet`
- `removePet`

It does not expose `ipcRenderer` directly.

### Pets-only state

The Control Center does not receive the full app state. It receives a narrowed pets snapshot only:

- default pet id
- installed pets

This avoids exposing unrelated settings/integration state to the new renderer.

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
- Control Center receives pets-only state, not full app state

## Future Migration Order

Suggested next phases after Pets UI review:

1. **Manual UI review**
   - Launch the app.
   - Open `Control Center Preview...` from the tray.
   - Compare it against the old `Manage Pets...` window.
   - Confirm the visual direction: spacing, cards, colors, buttons, details, preview behavior.

2. **Refine Pets page**
   - Polish anything that feels off before migrating more pages.
   - Possible areas:
     - better sprite preview states
     - richer pet detail layout
     - improved empty/loading/error states
     - more exact parity with old Pet Manager behavior
     - responsive layout polish

3. **Add Control Center routing/shell**
   - Add a real sidebar/top navigation.
   - Keep Pets as the first route.
   - Prepare route slots for Settings, Plugins, Integrations, and Onboarding.

4. **Migrate Settings**
   - Startup behavior
   - launch at login
   - pet scale
   - reaction animation mapping
   - update checker

5. **Migrate Plugins**
   - plugin hub
   - catalog/install/update
   - config forms
   - local developer plugin loading

6. **Migrate Integrations**
   - Claude Code
   - OpenCode
   - Cursor
   - Pi manual setup
   - command path configuration
   - preview/advanced sections

7. **Migrate Onboarding**
   - Make onboarding an overlay or route inside the Control Center.
   - Stop opening separate setup windows during onboarding.

8. **Switch tray actions to Control Center routes**
   - `Manage Pets...` opens Control Center `/pets`.
   - `Settings...` opens `/settings`.
   - `Plugins...` opens `/plugins`.
   - `Integrations...` opens `/integrations`.

9. **Remove legacy UI code**
   - Remove generated task-window HTML/CSS.
   - Remove DOM-rendering logic from `preload.cjs`.
   - Keep preloads as narrow API bridges only.

## Validation Commands

Use these after each phase:

```bash
pnpm --filter @open-pets/desktop typecheck
pnpm --filter @open-pets/desktop build
pnpm --filter @open-pets/desktop test
node --check apps/desktop/control-center-preload.cjs
```
