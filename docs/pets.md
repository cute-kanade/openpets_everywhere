# Pets: Model, Installation & Rendering

A "pet" is an animated character that lives in a transparent desktop window and
reacts to agent activity. This doc covers the whole pet lifecycle: what a pet is
made of, how it gets onto disk, how reactions become animations, and how the
windows behave. For the catalog that ships pets see [catalog.md](catalog.md);
for the command path that triggers reactions see [ipc.md](ipc.md).

Source maps: `apps/desktop/src/codemap.md` (pet windows, controllers,
installation), `packages/install-pet/codemap.md` (standalone installer).

## What a pet is

A pet package is small and asset-driven:

- **`pet.json`** — metadata: `id`, `displayName`, `description`,
  `spritesheetPath`, and optional `category` / `subcategory` / `sourceUrl` /
  `xHandle`. (Catalog entries carry the same identity plus hosting URLs — see
  [catalog.md](catalog.md).)
- **`spritesheet.webp`** — a grid of animation frames. Frames are at least
  `192x208`; thumbnails are derived from the spritesheet.

There are three sources a pet can come from at runtime:

1. **Built-in pet** (`built-in-pet.ts`) — a bundled spritesheet that always
   works as a fallback, even offline with nothing installed.
2. **Catalog pets** — downloaded from the public catalog and extracted into
   `userData/pets/{id}/`.
3. **Codex pets** — locally-developed pets imported from `~/.codex/pets/`
   (`codex-pets.ts`), the dev workflow for authoring a new pet before
   publishing it.

## Default pet vs agent pets

Two distinct window roles, two controllers:

- **Default pet** (`default-pet-controller.ts`) — the always-on companion shown
  when enabled. Persistent. Remembers its position. Shows transient reactions
  and status badges. Not lease-bound.
- **Agent pets** (`agent-pet-controller.ts`) — shown on explicit agent request,
  routed by a **lease**. The first lease opens the window; the last lease
  released closes it. This lets several agents each get their own pet without
  colliding with the default pet. See the lease model in [ipc.md](ipc.md).

Both are created by `pet-window.ts` as transparent, frameless, always-on-top
windows, driven through `pet-preload.cjs` for drag and click-through behavior.

## Reactions → animations → speech

A **reaction** is a categorical pet state (thinking, editing, testing, waiting
for permission, success, error, idle, …). The rendering pipeline turns a
reaction into something visible:

1. `reaction-animation-mapping.ts` resolves a reaction to a **sprite animation
   state** (`resolveReactionSpriteState`). This mapping is **user-configurable** —
   users can override which animation a reaction plays, and overrides persist in
   app state. The selectable animation states include idle, review, running,
   waiting, waving, jumping, and failed; `waving` covers attention/notification
   style reactions.
2. `reaction-messages.ts` picks a **speech message** from the pool for that
   reaction; `i18n/reactions/` provides the localized pools so speech matches the
   active locale (see [i18n.md](i18n.md)).
3. `pet-window.ts` renders the chosen animation via CSS sprite animation, and
   shows speech bubbles, alert indicators, pinned HUDs, and status badges as
   requested.

This separation — mapping vs message vs render — is deliberate: agents and
plugins speak in *reactions*, and the host owns *how* those look and sound.

## Motion

Plugin-driven pet movement uses a small physics/interpolation engine
(`pet-motion-engine.ts`) rather than embedding movement math in window code. The
SDK routes (`plugin-sdk-routes.ts` → `plugin-pet-registry.ts`) feed target
vectors to the engine, which ticks interpolated positions for spawned and
default pets (target-following behavior). See [plugins.md](plugins.md) and
[sdk.md](sdk.md) for the plugin side.

## Installation

Two install paths exist; they share the same safety rules.

### Through the running app (preferred)

`pet-installation.ts`:

1. `getCatalogPet()` resolves the pet from the catalog (`catalog.ts`).
2. `downloadPetZip()` streams the ZIP from `zip.openpets.dev`, validating magic
   bytes.
3. `extractPetZip()` extracts with `yauzl` under strict entry validation
   (`zip-safety.ts`): no path traversal, no symlinks, case-collision detection,
   size/file-count caps.
4. Extraction is atomic (temp dir → rename) into `userData/pets/{id}/`, and
   `installPetState()` records it in app state.

### Standalone installer (`install-pet`)

`packages/install-pet/` is a standalone CLI (`install-pet <pet-id>` or
`npx -y install-pet <pet-id>`). It prefers the running app via
`@open-pets/client` and **falls back** to a direct download + extract when the
app is unavailable. Direct mode uses a lock file (`.install-pet.lock`, 10-min
stale timeout) to prevent concurrent installs, the same ZIP safety limits (50MB
download / 200MB extracted / 500 files / 100MB per file), and the same
platform-specific user-data path resolution. This is what powers
"`npx install-pet <id>`" without requiring the app to be open.

### ZIP safety (shared)

Both paths enforce: HTTPS-only catalog/ZIP hosts on an allowlist, no encrypted
entries, only stored/deflate compression, valid Unix modes, required files
(`pet.json` + `spritesheet.webp`), and atomic extraction with private
permissions. The pet `id` must match `^[a-z0-9][a-z0-9_-]{0,63}$` and cannot be
`builtin`.

## Codex pets (local authoring)

`codex-pets.ts` imports pets from `~/.codex/pets/` with the same metadata
validation, so an author can iterate on a pet locally before it is published to
the catalog. The publishing path (zipping, thumbnailing, uploading to R2,
regenerating the catalog) lives in `web/`'s sync scripts and is documented in
`web/docs/pet_publishing.md`; the contract those produce is in [catalog.md](catalog.md).

## Image protocols & CSP

Pet images are served to renderers through internal protocols
(`openpets-codex:`, `openpets-installed:`, `openpets-pet-preview:`). Any new
protocol or image source must be added to the CSP in **both**
`apps/desktop/vite.config.ts` and `apps/desktop/src/renderer/index.html`, or
images silently fall back to the default pet. This is the single most common
"why is my pet showing the wrong sprite" bug — see [desktop.md](desktop.md).

## Where to look first

| If you're touching… | Start in |
|---------------------|----------|
| How a reaction looks | `reaction-animation-mapping.ts` |
| What a pet says | `reaction-messages.ts` + `i18n/reactions/` |
| Window behavior (drag, click-through) | `pet-window.ts`, `pet-preload.cjs` |
| Default vs agent visibility | `default-pet-controller.ts`, `agent-pet-controller.ts` |
| Installing / extracting | `pet-installation.ts`, `zip-safety.ts` |
| Standalone install | `packages/install-pet/` |
| Local pet authoring | `codex-pets.ts` |
| Movement | `pet-motion-engine.ts` |
</content>
