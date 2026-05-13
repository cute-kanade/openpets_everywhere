# Repository Atlas: OpenPets 2.0 Workspace

## Project Responsibility

OpenPets is a pnpm/TypeScript monorepo for an Electron desktop companion app plus npm packages that let coding agents control animated desktop pets. The workspace provides a local IPC protocol, MCP server, CLI tooling, and editor-specific integrations for Claude Code and OpenCode.

## System Entry Points

- `package.json`: workspace scripts for building, checking, testing, desktop packaging, and npm release orchestration.
- `pnpm-workspace.yaml`: workspace membership for `apps/*` and `packages/*`.
- `apps/desktop/src/main.ts`: Electron main-process bootstrap for the desktop pet app.
- `packages/cli/src/index.ts`: command-line setup and pet management entry point.
- `packages/mcp/src/index.ts`: MCP server entry point used by agents.
- `packages/client/src/index.ts`: public IPC client API consumed by integrations and tools.

## Directory Map

| Directory | Responsibility Summary | Detailed Map |
|-----------|------------------------|--------------|
| `apps/` | Deployable application workspace, currently the tray-first Electron desktop app that consumes shared packages. | [View Map](apps/codemap.md) |
| `apps/desktop/` | User-facing Electron companion app: tray UX, pet windows, pet installation, agent setup, update checks, and local IPC server. | [View Map](apps/desktop/codemap.md) |
| `apps/desktop/src/` | Main-process service layer for app lifecycle, state, tray/windows, IPC routing, lease-managed agent pets, catalog installation, and editor integration. | [View Map](apps/desktop/src/codemap.md) |
| `apps/desktop/scripts/` | Desktop package cleanup and local release automation scripts. | [View Map](apps/desktop/scripts/codemap.md) |
| `packages/` | Publishable npm package workspace for shared protocol, CLI, MCP, and coding-agent integrations. | [View Map](packages/codemap.md) |
| `packages/agent-events/` | Shared agent speech/event message pools and validation utilities. | [View Map](packages/agent-events/codemap.md) |
| `packages/agent-events/src/` | Source implementation for agent event messages. | [View Map](packages/agent-events/src/codemap.md) |
| `packages/claude/` | Claude Code integration package for hooks, MCP setup, and settings/memory management. | [View Map](packages/claude/codemap.md) |
| `packages/claude/src/` | Claude Code hook handlers, hook settings, CLI integration, and exported setup APIs. | [View Map](packages/claude/src/codemap.md) |
| `packages/client/` | IPC client package that discovers and communicates with the desktop app. | [View Map](packages/client/codemap.md) |
| `packages/client/src/` | Protocol definitions, discovery logic, public client API, and smoke entry points. | [View Map](packages/client/src/codemap.md) |
| `packages/cli/` | User-facing OpenPets CLI package. | [View Map](packages/cli/codemap.md) |
| `packages/cli/src/` | CLI command parsing and orchestration across client, Claude, OpenCode, and MCP packages. | [View Map](packages/cli/src/codemap.md) |
| `packages/install-pet/` | Standalone installer package for gallery/catalog pets. | [View Map](packages/install-pet/codemap.md) |
| `packages/install-pet/src/` | Pet installation command implementation. | [View Map](packages/install-pet/src/codemap.md) |
| `packages/mcp/` | MCP server package exposing OpenPets tools to compatible agents. | [View Map](packages/mcp/codemap.md) |
| `packages/mcp/src/` | MCP server bootstrap, argument parsing, tool registration, and executable validation helpers. | [View Map](packages/mcp/src/codemap.md) |
| `packages/opencode/` | OpenCode editor integration package with plugin runtime and global setup helpers. | [View Map](packages/opencode/codemap.md) |
| `packages/opencode/src/` | OpenCode plugin, config mutation, previews, status, and project/global setup modules. | [View Map](packages/opencode/src/codemap.md) |
| `packages/pi/` | Pi coding-agent integration package with extension runtime and slash command support. | [View Map](packages/pi/codemap.md) |
| `packages/pi/src/` | Pi extension entry point, event classification, OpenPets command parsing, and validation checks. | [View Map](packages/pi/src/codemap.md) |
| `packages/pet-format/` | Minimal package marker/type interface for OpenPets pet package identity. | [View Map](packages/pet-format/codemap.md) |
| `packages/pet-format/src/` | Marker source export for pet-format package consumers. | [View Map](packages/pet-format/src/codemap.md) |

## Architecture Flow

1. The desktop app starts `apps/desktop/src/main.ts`, initializes app state, creates tray/task windows, and starts a local IPC server.
2. Agent integrations (`packages/claude`, `packages/opencode`, `packages/pi`, and `packages/mcp`) emit pet commands through `@open-pets/client`.
3. The desktop IPC server routes commands through lease-managed controllers so default and agent pets can coexist safely.
4. Pet assets are resolved from built-in assets, locally developed Codex pets, or remotely downloaded catalog ZIPs.
5. Workspace packages share TypeScript/ESM build conventions and are wired together through pnpm `workspace:*` dependencies.

## Working Notes

- For repository-level orientation, start here, then open the specific folder codemap before editing.
- Contract validation files named `check-*.ts` are intentionally excluded from detailed codemap coverage.
- Build artifacts, dependencies, tests, documentation, and binary assets are excluded from codemap state.
