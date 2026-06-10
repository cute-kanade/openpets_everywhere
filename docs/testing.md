# OpenPets testing

OpenPets uses lightweight Node contract checks instead of a full test framework, plus a first-class plugin test kit for the plugin layer (see below).

## Commands

```bash
pnpm test
pnpm check
```

- `pnpm test` builds the workspace and runs deterministic regression tests.
- `pnpm check` is the full pre-commit/phase gate: typecheck, build, then package tests/checks.

Package-level `pnpm test` commands generally run built `dist` artifacts and assume the package was built first. Use root `pnpm test` or package `pnpm check` when you need a fresh build included automatically.

Package-level `check` scripts should include package tests after typecheck/build so regression coverage cannot drift away from validation.

## Package expectations

Packages with runtime contract coverage should expose `test` scripts:

- `apps/desktop`
- `packages/client`
- `packages/mcp`
- `packages/claude`

Packages without meaningful runtime checks yet may omit `test` until they gain behavior beyond type/build validation:

- `packages/cli`
- `packages/pet-format`

## Isolation rules

Tests must not require:

- a running Electron app
- a real Claude installation
- network access
- writes to real `~/.claude/settings.json`
- writes to real OpenPets user data

Use temp directories/files for settings and fixtures. Clean them up after the test. Do not depend on the process current working directory except for explicit repo-relative fixture paths.

## What belongs in tests

Good fits for the current harness:

- IPC protocol contracts
- MCP tool contracts
- lease manager behavior
- Claude MCP command previews
- Claude hook event mapping and speech safety
- Claude settings merge/install/uninstall against temp files
- zip safety and catalog validation
- plugin SDK bridge validators (incl. property/fuzz tests — `apps/desktop/tests/plugin-bridge-fuzz.test.ts`)

Electron tray/window behavior remains manually verified until a later UI automation phase.

## Plugin test kit (SDK v3)

The plugin layer goes beyond "lightweight checks": `@open-pets/plugin-sdk/testing`
ships a supported harness (`createTestHarness`) so any plugin's `start` handler
runs deterministically with no Electron, no network, no real timers, and no
real user data — the same isolation rules as above. It provides a fake clock
(`clock.advance("90m")` drives `once`/`every`/`daily`/`cron`/`at`), curated
event injection, bubble/command interaction, permission simulation, mocks for
`net`/`ai`/`secrets`/`files`/`auth`/`voice`/`system`, and descriptor-level
assertions (`expectSpoke`, `expectBubble`, `expectStored`, …).

- Scaffolded plugins (`openpets plugin new --template …`) ship a passing
  `test.js` against the kit; `openpets plugin validate` checks manifests and
  declared files at author time.
- `packages/sdk/src/check-plugin-sdk.ts` is the kit's own contract test, and
  `apps/desktop/src/check-plugin-sdk-conformance.ts` is the compile-time drift
  guard between the runtime bridge and the published types.

See `docs/plugins.md` for the full developer workflow (hot reload, inspector).
