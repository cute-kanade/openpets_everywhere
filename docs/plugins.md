# OpenPets Plugin Platform (SDK v3 / SuperPlugins)

This is the reference for the current plugin platform. The forward-looking
spec that drove this implementation is `docs/superplugins.md`; this document
describes what is actually built and how to work with it.

## Architecture

```text
plugin package (manifest + entry + assets + panels)
  -> plugin-service.ts        install/seed/local-load, state, config
  -> plugin-runtime.ts        per-plugin lifecycle, declarative timers
  -> plugin-js-host.ts        sandboxed BrowserWindow per JS plugin + IPC dispatch table
  -> plugin-sdk-preload.cjs   builds the plugin-facing ctx (handles, subscriptions)
  -> plugin-sdk-bridge.ts     validation, permissions, quotas (the security boundary)
  -> plugin-host-capabilities.ts  Electron side effects (one instance, injected at startup)
       bubbles  -> plugin-bubble-arbiter.ts -> default-pet-controller / plugin-pet-registry -> pet-window.ts
       audio/tts -> pet window renderer (WebAudio recipes, data-URL playback, speechSynthesis)
       events   -> plugin-events-source.ts (pet windows, powerMonitor, screen, pollers)
       pets     -> plugin-pet-registry.ts + pet-motion-engine.ts (spawn, moveTo, followCursor, physics, onTick)
       panels   -> plugin-panels.ts (+ panel-preload.cjs)
       ai       -> plugin-ai-gateway.ts (Anthropic / OpenAI / Ollama)
       secrets  -> plugin-secrets.ts (safeStorage-encrypted, per plugin)
       auth     -> plugin-oauth.ts (PKCE loopback, system browser)
       voice    -> plugin-voice.ts (TTS via renderer; one-shot STT via capture window + provider)
       toast    -> plugin-toast.ts; notify -> Electron Notification
       settings -> plugin-platform-settings.ts (sound/AI-speech/voice/mic toggles + quiet hours + AI provider)
```

The single governing rule: **plugins describe; the host renders.** Bubbles are
descriptors validated in the bridge and rendered by `pet-window.ts`. Plugin
HTML runs only inside the sandboxed *panel* window (`ui:panel`), never in a pet
window.

## Manifest

`openpets.plugin.json`, validated by `apps/desktop/src/plugin-manifest.ts`.
A JSON Schema ships with the CLI (`packages/cli/schemas/openpets.plugin.schema.json`);
manifests may carry `$schema` for editor validation.

- `manifestVersion: 1` — declarative timer plugins (legacy).
- `manifestVersion: 2` — JavaScript SDK v2 surface (legacy; keeps working unchanged).
- `manifestVersion: 3` — SDK v3. Requires `sdkVersion: "3.x.y"`. Adds:
  - `assets`: `{ icons | images | svgs | sprites | sounds: { name: relativePath } }` —
    up to 32 entries per kind. Validated at install: path containment, format,
    per-kind size caps (`pluginAssetMaxBytes`), and SVG sanitization
    (`plugin-assets.ts` strips script/foreignObject/event handlers/external hrefs).
  - `panels`: `{ name: relative .html path }` (max 8). Panel HTML gets a strict
    CSP injected at install.
  - New config field types `date`, `sound`, and `secret` (masked input; no defaults allowed).

Minimum unblock note: Control Center `sound` config fields now support importing
`.ogg`, `.mp3`, and `.wav` files through the host picker. Imported sounds are
stored as opaque `{ kind: "user-sound", id, name }` refs; raw filesystem paths
are rejected by config validation. Near-term debt remains to split
`plugin-sdk-bridge.ts` by namespace, centralize preload/host route contracts,
extract the user-sound store from host capabilities, and add parity tests for
renderer preload routes.

## Permissions (v3)

Existing: `pet:speak`, `pet:reaction`, `pet:move`, `schedule`, `storage`,
`status`, `commands`, `network` (+ declarative-only `timer`).

New in v3: `pet:interact` (bubble buttons/inputs), `pet:pin` (pinned slot),
`pet:animate` (custom sprites/scale), `pet:speak:dynamic` (AI-generated speech),
`pet:drop` (drag-and-drop onto the pet), `pets:read`, `pets:manage` (spawn/close),
`audio`, `events`, `ui:toast`, `ui:panel`, `notify`, `bus`, `ai`, `secrets`,
`voice:speak`, `voice:listen`, `auth`, `files`, `system:openExternal`,
`system:metrics`, `clipboard`, `network:write`.

Flagged **sensitive** (louder consent, gated by global settings, default off):
`voice:listen`, `clipboard`, `pet:speak:dynamic`
(`sensitivePluginPermissions` in `plugin-manifest.ts`).

Trust model: declared permissions + user approval at install + catalog review.
No signing tier (deliberate — see `docs/superplugins.md` §15).

## The SDK surface

Types: `packages/sdk/src/index.ts` (`@open-pets/plugin-sdk`, v3). The
namespaces on `ctx`: `pets`, `pet` (alias of `pets.default`), `ui` (bubbles,
alert, toast, panel, dynamic menu), `audio`, `events`, `assets`, `bus`, `schedule`
(`once`/`every`/`daily`/`cron`/`at`/`list`), `storage` (now with `keys` +
`subscribe`, ~5 MB quota), `config`, `net` (`fetch` with non-GET +
`stream`), `notify`, `ai`, `secrets`, `voice`, `auth`, `files`, `system`,
`commands`, `status`, `http` (v2 GET-only alias), `log`.

Hard lines kept regardless of permissions:

- The render rule above (no raw markup into pet windows).
- The privacy line (§3.1): no keystrokes, no screen contents, no other apps'

- `ctx.ui.alert(...)` is the must-not-miss delivery helper: it renders a sticky,
high-priority pet bubble and can optionally request `sound`, `notify`, actions,
`dismissOn`, an `indicator`, and rich bubble content (`text`, limited
`markdown`, `icon`, `svg`, `image`, `tone`). `indicator` renders the top header
row used by pet status messages, but is alert-owned instead of a pet reaction: it
accepts a named host icon or a manifest-declared asset via `ctx.assets.icon(...)`
/ `ctx.assets.svg(...)` / `ctx.assets.image(...)`, plus safe `color`,
`background`/`backgroundColor`, and `borderColor` values. Raw SVG strings are
not accepted at runtime; bundle SVGs in `assets` so the host can validate and
sanitize them at install. Bubble body media (`icon`, `svg`, `image`) is
icon-only and cannot be combined with `text`/`markdown`; use `indicator` for
icon + message alerts. Alerts require `pet:speak`; `pet:interact` is only
needed for actions/input, `audio` only when `sound` is set, and `notify` only
when `notify` is set. The returned handle behaves like a bubble handle and adds
`acknowledge()`.
- Config schemas may use `type: "sound"` for host-managed plugin sound
  preferences. The saved value is a named host sound, an opaque user sound ref,
  or empty; plugins never receive raw filesystem paths.
- The privacy line (§3.1): no keystrokes, no screen contents, no other apps'
  window titles, no ambient clipboard/microphone/filesystem. Clipboard read is
  allowed only *inside a user-invoked command handler*; STT is one-shot
  push-to-talk behind a default-off toggle; drops fire only on explicit drags.
- Network: HTTPS-only, manifest-declared + user-approved exact hosts, manual
  redirects, response caps, DNS/private-IP SSRF guard (`assertPublicHost`).

Quotas live in `pluginSdkQuotas` (`plugin-sdk-bridge.ts`).

## Plugin i18n

A plugin ships its translations as `locales/<locale>.json` — one file per
supported locale, the same convention as the host catalog: a flat map of dotted
keys to strings, with `{var}` interpolation. `locales/en.json` is the source and
the fallback; missing locales (or missing keys within a locale) fall back to
`en`, then to the raw key. The host packages and loads any present `locales/`;
no file is required.

Two ways to use those keys:

- **`$t:key` references in manifest static fields** — wherever the host renders
  a plugin-authored string at display time: `name`, `description`, `configSchema`
  labels/descriptions/option labels, command titles/descriptions, and dynamic
  menu item titles. Write the value as `"$t:plugin.name"`; the host resolves it
  against the plugin's catalog for the active locale (→ plugin `en` → raw key) at
  display time, so labels re-render translated when the user switches language.
- **`ctx.t(key, vars?)` + `ctx.locale`** — for strings the plugin composes at
  runtime (bubble / notify / status bodies with interpolation). `ctx.t` reads the
  active locale live and interpolates `{var}` placeholders; `ctx.locale` is the
  current locale string. Example: `ctx.t("reminder.due", { message })`.

Keep placeholders intact across locales and leave brand names untranslated. The
reference implementation is the `openpets.reminders` ("Quick Reminders") default
plugin, mirrored by the CLI `reminder` template.

## Bubbles & the arbiter

`ctx.ui.bubble(spec)` / `pet.speak(spec)` accept a string or a descriptor
(text, limited markdown, icon/svg/image refs, tone, accent token, duration,
sticky, pin, dismissOn, priority, actions, input) and return a live handle
(`update`, `dismiss`, `pin`, `unpin`, `onAction`, `onSubmit`, `onDismiss`).

`plugin-bubble-arbiter.ts` (one per pet surface) arbitrates: priority queue,
do-not-interrupt for sticky/urgent, coalescing of identical back-to-back
messages, and a single **pinned slot** above the transient slot with
priority-aware replace semantics. Non-dynamic text goes through the static
content filter; `dynamic: true` content needs `pet:speak:dynamic` plus the
global toggle and gets the relaxed screen (2,000 chars, secret redaction).

## Multi-pet & liveness

`ctx.pets.spawn({ petId })` opens an ephemeral window for an installed pet
(max 4 per plugin), addressable via handles. `onTick` is the host-driven brain
loop (~10 fps, paused while hidden/dragging); `getState` gives self-perception;
`moveTo`/`followCursor`/`physics` run in `pet-motion-engine.ts`. Spawned pets
are torn down with their plugin.

## Host integrations

- **AI gateway** — one user-configured provider (Settings → Plugin Platform):
  Anthropic, OpenAI, or Ollama. Keys are safeStorage-encrypted and never reach
  plugin code. `complete` supports tools (function calling); `stream` streams
  tokens. BYO-provider plugins can use `net.stream` + `secrets` instead.
- **OAuth** — `ctx.auth.oauth` runs PKCE against a loopback listener in the
  system browser; tokens persist in the plugin's secrets and are returned to
  the plugin. `refresh`/`signOut` manage the stored session.
- **Files** — OS dialogs only (`pick`/`save`); reads are size-capped, one-shot
  handles. Dropped files (`pet:drop`) are readable through the same accessor.
- **System** — `info()` (platform/locale/timezone/theme/version/online) is
  always available; `metrics()` (aggregate CPU/mem only) needs
  `system:metrics`; `openExternal` is HTTPS-only.
- **Commands** — `ctx.commands.register(...)` accepts `icon` as either one of
  the host's named icon strings (for example `"info"`, `"check"`, `"timer"`) or
  a manifest-declared bundled icon reference from `ctx.assets.icon(name)`. Raw SVG
  strings are rejected; put custom SVG/PNG icons under `assets.icons` so the host
  can validate and sanitize them before the command reaches runtime/UI state.
- **Quiet hours** are a host primitive (Settings → Plugin Platform) gating
  speech audio, plugin sound, voice, and notification sound together.

## Developer workflow

```bash
# scaffold (templates: blank | reminder | ambient | ai-chat | tamagotchi | calendar)
npx @open-pets/cli plugin new "My Plugin" --template tamagotchi

# author-time validation: manifest, config schema, permissions, declared files
npx @open-pets/cli plugin validate ./my-plugin

# deterministic tests without the app (fake clock, event injection, mocks)
npm test            # runs test.js against @open-pets/plugin-sdk/testing

# live with hot reload — saving a file re-snapshots and reloads just that
# plugin, preserving enabled state, storage, and approved permissions
OPENPETS_DEV_PLUGIN_PATHS=$(pwd)/my-plugin pnpm dev:desktop
# or for a folder of plugins (this is what pnpm dev:desktop:plugins uses)
OPENPETS_DEV_PLUGIN_ROOTS=$(pwd)/plugins/official pnpm dev:desktop
```

The test kit is `@open-pets/plugin-sdk/testing` (`createTestHarness`): fake
clock (`clock.advance("90m")` drives `once`/`every`/`daily`/`cron`/`at`),
curated event injection (`emit`), bubble interaction
(`fireBubbleAction`/`fireBubbleSubmit`), command runs, permission simulation
(unapproved namespaces throw), and mocks for `net`, `ai`, `secrets`, `files`,
`auth`, `voice`, and `system`. Assertions: `expectSpoke`, `expectReacted`,
`expectScheduled`, `expectBubble` (matches descriptors, not pixels),
`expectStored`, `expectNetCall`, `expectNotified`, `expectNoErrors`.

Runtime introspection: `openpets:plugins-inspector` IPC
(`runtime.getInspectorState(id)`) returns schedules + next runs, registered
commands/menu items, active bubbles/panels, subscription counts, quota
counters, and the last error.

## Publishing

Unchanged flow: `pnpm plugins:check` validates and packages `plugins/official`
into ZIPs + catalog (dry-run); `plugins:publish` uploads. v3 ZIPs may contain
the manifest, the entry, and every declared asset/panel file — nothing else.
Catalog min/max-OpenPets-version metadata gates what loads where; v2 plugins
keep loading through the same runtime (the v3 context is a superset).

## Drift guards & CI

- `apps/desktop/src/check-plugin-sdk-conformance.ts` — compile-time guard that
  the bridge surface and permission union match the published SDK types.
- `packages/sdk/src/check-plugin-sdk.ts` — runtime contract test of the mock
  context (used by `pnpm --filter @open-pets/plugin-sdk test`).
- `apps/desktop/tests/plugin-bridge-fuzz.test.ts` — property/fuzz tests over
  the bridge validators (cron, markdown, dynamic-text redaction, SVG/panel
  sanitizers, private-IP guard, form values, arbiter invariants).
- `pnpm check` runs all of the above.

## Troubleshooting

- *Bubble never shows*: check the inspector for quota counters and the
  arbiter state; sticky/urgent bubbles block lower-priority ones.
- *`Plugin permission is not approved`*: the manifest must declare it AND the
  user must have approved it (re-load local plugins after permission changes).
- *Audio/voice silent*: check Settings → Plugin Platform toggles and quiet
  hours.
- *`ai.*` throws*: configure a provider + key in Settings → Plugin Platform.
- *Sprite override not rendering*: sprites must be a horizontal strip with
  square frames (frame size = image height); fps 1–30.
- *Renderer-visible URL schemes*: per `AGENTS.md`, any new scheme needs CSP
  updates in `apps/desktop/vite.config.ts` and
  `apps/desktop/src/renderer/index.html`. The v3 features deliberately reuse
  `file:` (already allowed in pet windows) and add no new schemes.
