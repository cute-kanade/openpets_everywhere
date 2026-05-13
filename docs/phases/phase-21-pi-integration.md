# Phase 21 — Pi Integration Plan

## Goal

Add first-class OpenPets support for Pi through a dedicated Pi extension package, with desktop and docs visibility, while keeping the runtime local, safe, and non-blocking.

Target support means:

- Pi agent activity drives OpenPets reactions automatically.
- Pi users can install the OpenPets Pi extension with Pi's package system. The OpenPets desktop app remains a separate app installation.
- Pi users can run a small `/openpets` command namespace for status and manual checks.
- OpenPets desktop can show Pi in Integrations using `apps/desktop/assets/integrations/pi.svg`.
- Public docs explain Pi setup as extension-first, not MCP-first.
- The integration never forwards prompts, assistant text, tool output, file contents, URLs, paths, or secrets by default.

## Current OpenPets integration model to mirror

OpenPets currently has three integration layers:

1. **Local IPC client**
   - Shared runtime bridge: `packages/client`.
   - Integrations use it to send reactions and speech to the desktop app.
   - Desktop routes explicit pet targets through lease-managed agent pets.

2. **Dedicated agent packages**
   - Claude Code: `packages/claude` for MCP setup, managed instructions, hooks, and hook event mapping.
   - OpenCode: `packages/opencode` for plugin runtime, config setup, previews, and project/global setup.

3. **Generic fallback**
   - `packages/mcp` exposes `openpets_status`, `openpets_react`, and `openpets_say` for stdio MCP clients.
   - `packages/cli` exposes scriptable direct commands.

Pi should follow the dedicated-package model. Generic MCP can remain a fallback, but it is not the best primary integration surface for Pi.

## Pi source findings

Pi's coding-agent package provides a rich extension and package system.

- Extensions can be auto-discovered from:
  - `~/.pi/agent/extensions/*.ts`
  - `~/.pi/agent/extensions/*/index.ts`
  - `.pi/extensions/*.ts`
  - `.pi/extensions/*/index.ts`
- Settings can load packages and extension paths:
  - `packages: ["npm:@foo/bar@1.0.0", "git:github.com/user/repo@v1"]`
  - `extensions: ["/path/to/local/extension.ts"]`
- `pi install` can install npm, git, URL, or local packages.
- Project-local package install uses `pi install -l` and writes `.pi/settings.json`.
- Pi packages can declare resources in `package.json` under a `pi` key:

```json
{
  "name": "@open-pets/pi",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./dist/extension.js"]
  }
}
```

- Useful extension events include:
  - `session_start`
  - `session_shutdown`
  - `agent_start`
  - `agent_end`
  - `turn_start`
  - `turn_end`
  - `message_start`
  - `message_update`
  - `message_end`
  - `tool_execution_start`
  - `tool_execution_update`
  - `tool_execution_end`
  - `tool_call`
  - `tool_result`
  - `input`
  - `user_bash`
- Extensions can register slash commands with `pi.registerCommand()`.
- Extensions can use `ctx.ui.notify()`, `ctx.ui.setStatus()`, widgets, and custom TUI pieces, but OpenPets should not require custom Pi UI for the first release.
- Pi extensions run with full local system permissions, so OpenPets docs must treat package trust as a security boundary.

## Recommended approach

Implement Pi as a dedicated package:

```text
packages/pi/
```

Published package:

```text
@open-pets/pi
```

Primary install flow:

```bash
pi install npm:@open-pets/pi
```

Project-local install flow:

```bash
pi install -l npm:@open-pets/pi
```

The package should export one Pi extension that uses `@open-pets/client` to send local IPC updates. It should not depend on MCP for core behavior.

## Compatibility gate

Pi's coding-agent package is currently treated as an unstable integration surface until verified against a real release.

Before public support is claimed:

- Record the exact tested Pi package version or commit.
- Record tested operating systems.
- Confirm the extension can load through both local package loading and `pi -e ./dist/extension.js` or the closest supported equivalent.
- Confirm whether Pi package dependencies should use a narrow supported peer range or `"*"`. Do not publish with `"*"` unless Pi package-manager behavior confirms that is the intended package convention.
- Keep desktop and web status planned/manual until real Pi loading passes.

Current Phase 21B local validation uses Pi package API shape from `@earendil-works/pi-coding-agent@0.74.0`, installed through the workspace lockfile. Full real-CLI validation with `pi install` / `pi -e` remains required before marking the integration supported.

## Package contract

Recommended `package.json` shape:

```json
{
  "name": "@open-pets/pi",
  "version": "0.0.0",
  "license": "MIT",
  "type": "module",
  "keywords": ["pi-package", "openpets", "coding-agent"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./extension": "./dist/extension.js"
  },
  "files": ["dist"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/alvinunreal/openpets.git",
    "directory": "packages/pi"
  },
  "pi": {
    "extensions": ["./dist/extension.js"]
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@open-pets/client": "workspace:*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "<tested-range>",
    "typescript": "^5.0.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "<tested-range>"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

Notes:

- Confirm whether Pi requires `@earendil-works/pi-coding-agent`, `typebox`, or related Pi core packages as `peerDependencies` instead of bundled dependencies before publishing.
- Keep runtime dependencies minimal.
- Build output should be plain ESM JavaScript that Pi can load without TypeScript compilation.
- The extension should tolerate missing OpenPets desktop IPC and keep Pi startup/session flow unaffected.
- Add `@open-pets/pi` to `scripts/release-npm.mjs` publish order after its dependencies.
- `pnpm pack --dry-run` must show the tarball includes built `dist` JavaScript and declarations only, not phase docs or source-only runtime files.
- Verify workspace dependency rewriting before publish.
- Reuse `@open-pets/agent-events` for shared event messages/safety if it fits the exact validation requirements; otherwise document the reason and test Pi against the same rejection corpus as desktop/MCP.

## Runtime behavior

The extension should:

- Create a small OpenPets runtime wrapper around `@open-pets/client`.
- Cache connection status only briefly; do not assume the desktop app stays available.
- Use short timeouts for OpenPets calls.
- Run automatic event updates fire-and-forget.
- Swallow OpenPets IPC failures by default, with optional debug logging.
- Avoid long-lived timers unless needed for throttling cleanup.
- Clean up on `session_shutdown`.

MVP targets the default pet only. Explicit pet routing, selected-pet config, and lease reuse are deferred until the Pi extension behavior is verified in production. A later pet-routing phase must define configuration, lease acquire/reuse, stale-lease fallback, shutdown cleanup, and missing-pet tests before enabling `--pet`-style behavior.

## Event mapping

Default mapping should favor silent reactions over speech.

| Pi event | Condition | OpenPets reaction | Speech |
| --- | --- | --- | --- |
| `session_start` | Pi starts, resumes, or reloads. | `waving` | None by default. |
| `agent_start` | Agent loop begins. | `thinking` | None. |
| `turn_start` | New turn begins. | `working` | None. |
| `tool_execution_start` | Tool looks like edit, write, patch, or apply. | `editing` | None. |
| `tool_execution_start` | Tool or shell command looks test-like. | `testing` | None. |
| `tool_execution_start` | Shell/bash command, non-test. | `running` | None. |
| `tool_execution_start` | Other tool. | `working` | None. |
| `tool_execution_end` | `isError` is true. | `error` | Optional short fixed error-pool message, throttled. |
| `agent_end` | Agent loop finishes without a recent tool error. | `success` | None. |
| `session_shutdown` | Quit, reload, new, resume, or fork. | `idle` | None. |

Classification rules:

- Tool names may be inspected.
- Tool arguments may be inspected only through bounded in-memory slices for coarse classification, such as test detection.
- `tool_execution_end` must use `isError` only and must not inspect `result`.
- Never place raw tool arguments, command text, output, stack traces, prompt text, or assistant text in pet speech.
- Ignore OpenPets-related commands/tools to prevent self-trigger loops.
- Do not subscribe to prompt/content-heavy events in MVP: `input`, `before_agent_start`, `message_update`, `message_end`, or `tool_result`.
- Track current-agent error state so `agent_end` does not immediately overwrite a recent `error` reaction with `success`.
- Do not register model-callable Pi tools in Phase 21. No `pi.registerTool()` usage is allowed in MVP.
- Avoid `tool_call` handlers in MVP unless a later phase needs blocking/mutation behavior.

## Slash command namespace

Register one command namespace:

```text
/openpets
```

Suggested subcommands:

| Command | Behavior |
| --- | --- |
| `/openpets status` | Check whether the OpenPets desktop app is reachable and which pet is targeted. |
| `/openpets test` | Send a short safe test message and `waving` or `success` reaction. |
| `/openpets react <reaction>` | Set one allowed reaction. |
| `/openpets say <message>` | Show one validated short speech bubble. |
| `/openpets help` | Show available subcommands. |

Allowed manual reactions should match the public OpenPets reaction set:

```text
idle, thinking, working, editing, running, testing, waiting, waving, success, error, celebrating
```

Manual speech must use the same validation rules as other OpenPets surfaces:

- single line;
- short, user-facing, non-sensitive;
- no code, logs, paths, URLs, prompts, secrets, or raw errors.

## Safety and privacy requirements

The Pi integration must preserve the OpenPets safety model.

- No automatic prompt forwarding.
- No automatic assistant-message forwarding.
- No automatic tool-output forwarding.
- No automatic command-output forwarding.
- No file contents, URLs, file paths, diffs, logs, stack traces, secrets, or tokens in speech.
- Speech is rare and generated from fixed message pools or explicit user command input.
- Manual `/openpets say` input is validated before sending.
- OpenPets failures never block Pi model calls or tool execution.
- Pi package docs warn that Pi extensions run with local system permissions.
- Debug logging is off by default, sanitized, and never logs raw event payloads.

The Pi package must include tests proving no prompt, assistant text, tool output, command text, file paths, URLs, diffs, logs, stack traces, secrets, or tokens can reach `client.say` through automatic events.

Speech validation must be exact, not approximate. Either extract a shared public validator used by desktop/MCP/Pi, or test Pi against the same rejection corpus: newline, length, code-like text, URLs, paths, secrets, private-key-looking text, and trimming behavior.

## Desktop integration UI

Desktop already has `apps/desktop/assets/integrations/pi.svg` available.

Implementation should:

- Add Pi to the bundled integration icon map in `apps/desktop/src/windows.ts`.
- Add `pi.svg` to the packaging contract in `apps/desktop/src/check-packaging-contract.ts`.
- Add a Pi card to the Integrations grid.
- Initially mark the card as planned/coming soon unless `@open-pets/pi` setup is implemented in the desktop app.
- If setup is implemented, expose a simple detail panel with:
  - Pi command detection, if practical;
  - install instructions using `pi install npm:@open-pets/pi`;
  - project-local install instructions using `pi install -l npm:@open-pets/pi`;
  - status/check guidance;
  - remove guidance using `pi remove npm:@open-pets/pi`.

Do not add risky desktop-managed writes to Pi settings until the package contract is stable. The first desktop release can be documentation/install-command oriented.

If a desktop detail panel is added, update all hard-coded integration UI surfaces together: icon map, card data, navigation/back/focus behavior, busy-control lists, preload event routing, disabled/manual state styling, and CSP-safe data-only icon rendering.

## Public docs

Add or keep a public integration guide at:

```text
web/content/en/integrations/pi.md
```

The page should explain:

- Pi uses an extension package, not MCP-first setup.
- OpenPets desktop must be running for pet updates.
- Global install command.
- Project-local install command.
- `/openpets` commands.
- Event-to-reaction mapping.
- Privacy model.
- Package trust warning.
- Current status if not yet released.
- Tested Pi version and tested operating systems once verified.

When `@open-pets/pi` is actually published and supported, update the frontmatter from planned/inactive to active/supported and link it from active integration surfaces.

## Non-goals

- Do not modify Pi upstream.
- Do not require MCP for Pi's automatic reactions.
- Do not add new public OpenPets MCP tools.
- Do not expose pet install/remove/default controls to the Pi model in MVP.
- Do not expose model-callable OpenPets tools through Pi in MVP.
- Do not call `pi.registerTool()` in Phase 21.
- Do not send raw prompts, assistant text, tool inputs, tool output, file paths, command output, logs, diffs, URLs, or secrets to pet speech.
- Do not build custom Pi TUI widgets in MVP.
- Do not make OpenPets availability affect Pi startup, model requests, or tool execution.

## Proposed subphase sequence

### Phase 21A — Pi API Spike and Package Foundation

**Goal:** Verify Pi extension/package API assumptions, then add `packages/pi` with extension loading shape, shared event classification, and command parsing. No desktop UI or packaging-contract changes in this phase.

**Scope:**

- Add workspace package `@open-pets/pi`.
- Verify current Pi extension loading and event API against a real Pi version or local cloned Pi package before relying on it.
- Record tested Pi version or commit in this plan/docs.
- Export a Pi extension entry compatible with Pi's package loader.
- Add a small OpenPets client wrapper with timeout and failure swallowing.
- Use explicit short timeouts for OpenPets calls, initially 500ms for automatic reactions.
- Add event classification helpers.
- Add exact speech safety and throttling helpers, reusing shared validators or matching the desktop/MCP rejection corpus.
- Register `/openpets` command with `status`, `test`, `react`, `say`, and `help` subcommands.
- Add unit tests for command parsing, reaction validation, speech rejection, event classification, non-blocking automatic handlers, unhandled rejection prevention, sanitized debug logging, and no automatic privacy leakage into `client.say`.
- Do not register Pi tools.

**Acceptance criteria:**

- Built extension can be imported from `dist/extension.js`.
- Extension factory returns quickly and does not require OpenPets desktop to be running.
- Automatic event handlers do not await IPC in a way that blocks Pi.
- `/openpets say` rejects unsafe text.
- Automatic handlers never call `client.say` with raw event payload data.
- `agent_end` success is suppressed after recent tool errors.
- `pnpm pack --dry-run` includes the expected package files only.
- Existing Claude/OpenCode/MCP behavior remains unchanged.

**Checks:**

- `pnpm --filter @open-pets/pi check`
- `pnpm --filter @open-pets/client check`
- `pnpm --filter @open-pets/agent-events check`
- `pnpm --filter @open-pets/pi pack --dry-run`

### Phase 21B — Pi Event Runtime and Manual Smoke Test

**Goal:** Verify the extension inside Pi and refine event mapping against real Pi behavior.

**Scope:**

- Install/load the local package in Pi using a local package path or `pi -e` flow.
- Confirm event names and payload shapes against the current Pi release.
- Confirm global package install works.
- Confirm project-local package install works.
- Confirm global and project-local removal behavior.
- Confirm that handlers are safe in interactive, print, and non-interactive modes.
- Confirm that unavailable OpenPets desktop app does not produce noisy failures.
- Confirm reload/new/resume/fork cleanup behavior.
- Confirm parallel tool execution does not produce stale state or unhandled rejections.
- Add a manual smoke-test checklist.
- Adjust mapping for any event names that differ from the researched API.

**Acceptance criteria:**

- Pi can load the local OpenPets extension.
- Pi can load the packed package locally.
- `/openpets status` reports reachable/unreachable clearly.
- Tool start/end events produce expected reactions when OpenPets is running.
- No prompts, outputs, or commands appear in pet speech during normal automation.
- Pi continues normally when OpenPets is closed.
- Malformed/missing discovery files fail clearly or are ignored by Pi without OpenPets-specific noise.

**Checks:**

- `pnpm --filter @open-pets/pi check`
- Manual Pi smoke test with OpenPets running.
- Manual Pi smoke test with OpenPets closed.

### Phase 21C — Desktop Integration Card and Asset Wiring

**Goal:** Show Pi in desktop Integrations and ensure `pi.svg` is packaged safely.

**Scope:**

- Add `pi.svg` to `apps/desktop/src/windows.ts` integration icon data URLs.
- Add `pi.svg` to `apps/desktop/src/check-packaging-contract.ts` SVG safety list.
- Add Pi card to the Integrations grid.
- If desktop-managed install is not implemented, mark Pi as planned/manual and show install commands only.
- Add detail copy that explains global and project-local Pi package install commands.
- Ensure no desktop code edits Pi settings automatically unless explicitly added and tested.

**Acceptance criteria:**

- Packaging contract checks `pi.svg`.
- Desktop Integrations renders Pi with the uploaded asset.
- Pi card status accurately reflects whether setup is manual/planned or actively supported.
- No broken icon or missing asset in packaged builds.

**Checks:**

- `pnpm --filter @open-pets/desktop check`
- Desktop manual visual check of Integrations grid.

### Phase 21D — Public Docs, Release, and Support Status

**Goal:** Publish clear Pi setup docs and update support status only when package behavior is verified.

**Scope:**

- Update `web/content/en/integrations/pi.md` with final install commands and supported behavior.
- Update home/integration listings to active only after the package is released.
- Add README/release notes entry.
- Document tested Pi version or commit date.
- Add troubleshooting:
  - Pi package not loading;
  - OpenPets desktop unavailable;
  - commands work but automatic reactions do not;
  - removing global/project-local package install.

**Acceptance criteria:**

- Docs match actual package behavior.
- Privacy claims are backed by implementation behavior.
- Install/remove commands are reproducible.
- Release notes mention Pi support and package trust warning.

**Checks:**

- `pnpm --filter @open-pets/pi check`
- `pnpm --filter @open-pets/desktop check`
- Web docs build/check command for the web workspace.
- From `web/`: `bun lint`
- From `web/`: `bun run build`

## Open questions

- Does Pi's package loader prefer ESM-only packages, CJS-compatible exports, or both?
- Can desktop safely run `pi install` for users, or should it remain manual until Pi settings semantics are stable?
- Where should debug logging go for extension failures without polluting Pi output?

## Initial recommendation

Start with Phases 21A and 21B only. Keep desktop and public docs marked planned/manual until the extension package has been loaded in a real Pi session and event payloads are verified.

After that, wire the uploaded `pi.svg` into the desktop UI in Phase 21C and only mark the public integration as supported in Phase 21D.
