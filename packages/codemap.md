# packages/

Monorepo workspace containing all OpenPets npm packages. Each package is independently publishable with its own versioning.

## Responsibility

Provides modular, reusable components for the OpenPets ecosystem:
- **pet-format**: Package marker interface for type identification
- **agent-events**: Speech pools and validation for agent feedback messages
- **client**: Core IPC client for communicating with OpenPets desktop app
- **cli**: Main CLI tool for configuring agents and managing pets
- **mcp**: MCP server implementation for agent integration
- **opencode**: OpenCode editor integration (plugin, config management)
- **claude**: Claude Code integration (hooks, MCP config)
- **cursor**: Cursor editor integration (MCP config, project rules)
- **pi**: Pi coding-agent extension integration (event hooks, slash commands)
- **install-pet**: Standalone pet installer from gallery catalog

## Design/Patterns

**Workspace Pattern**: Uses pnpm workspaces with `workspace:*` dependencies for internal linking.

**Package Structure**: Each package follows consistent structure:
- `src/` - TypeScript source
- `dist/` - Compiled output (not committed)
- `package.json` - Standard npm metadata with exports map
- `contracts/` - Runtime contract validation tests (client package)
- Contract check files (`check-*.ts`) for runtime validation (other packages)

**ESM-First**: All packages are ESM (`"type": "module"`) with dual exports for types.

**Versioning**: Independent versioning per package (currently 2.1.x for active integrations).

## Flow

```
CLI Entry (packages/cli/src/index.ts)
    ├── Configures Claude → @open-pets/claude
    ├── Configures OpenCode → @open-pets/opencode
    ├── Configures Cursor → @open-pets/cursor
    ├── Spawns MCP server → @open-pets/mcp
    └── Uses IPC client → @open-pets/client

MCP Server (packages/mcp/src/index.ts)
    ├── Registers tools (status, react, say)
    └── Communicates via @open-pets/client

OpenCode Plugin (packages/opencode/src/plugin.ts)
    └── Hooks into editor events → @open-pets/client

Claude Hooks (packages/claude/src/hooks.ts)
    └── Processes hook events → @open-pets/client

Cursor Setup (packages/cursor/src/cursor-project-setup.ts)
    └── Writes MCP config + rules → @open-pets/client

Pi Extension (packages/pi/src/extension.ts)
    └── Registers Pi extension hooks/commands → @open-pets/client
```

## Integration Points

**Inter-Package Dependencies**:
- `cli` depends on: `client`, `claude`, `mcp`, `opencode`, `cursor`
- `mcp` depends on: `client`
- `claude` depends on: `client`, `agent-events`
- `opencode` depends on: `client`, `agent-events`
- `cursor` depends on: `client`
- `pi` depends on: `client`, `agent-events` and declares optional `@earendil-works/pi-coding-agent` peer support
- `install-pet` depends on: `client`

**External Integrations**:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `jsonc-parser` - JSON with comments parsing for OpenCode configs
- `yauzl` - ZIP extraction for pet downloads
- `zod` - Schema validation in MCP tools

**Desktop App Communication**:
All packages ultimately communicate with the OpenPets desktop app via the IPC protocol defined in `client/src/protocol.ts`, supporting Unix sockets, Windows named pipes, and TCP (for WSL cross-platform).
