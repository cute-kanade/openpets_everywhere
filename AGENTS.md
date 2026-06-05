## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.

## Catalog Direction

Catalog v2 is legacy and exists only for old app versions/fallback compatibility.
For new work, migrations, and Control Center UI, do not optimize for v2 behavior.
Use catalog v3 (`thumbnail`, `spritesheet`, paginated pages, and search index) as the source of truth.

## Plugin Docs

Before changing plugin platform code, official plugins, plugin catalog generation, plugin packaging, plugin runtime behavior, or plugin-facing UI, read:
- `docs/plugins.md` for the current plugin platform architecture, manifest/runtime rules, local development workflow, publishing commands, and troubleshooting notes.
- `docs/new_plugins.md` for the companion-first Windows plugin direction, planned official plugin lineup, bundling defaults, and right-click plugin action strategy.

When plugin work is finished, update these docs if behavior, commands, manifests, plugin IDs, default bundled/enabled status, catalog workflow, permissions, or the planned plugin lineup changed. Do not leave plugin docs stale after implementation.

## Logging for Fast DX

When working on desktop UI, renderer, IPC, catalog, plugin, or pet-window behavior, add targeted logging as part of the implementation when it helps diagnose issues quickly.
Prefer concise, scoped logs that capture data shape, selected IDs, load/error states, and boundary decisions.
Route renderer diagnostics into the app log when possible so failures are visible in `openpets.log`, not only DevTools.
Avoid noisy permanent logs, secrets, full payload dumps, or logging in tight animation/render loops.

## Control Center CSP

When adding any renderer-visible URL scheme, image source, dev server endpoint, or internal protocol, update the Control Center CSP in both `apps/desktop/vite.config.ts` and `apps/desktop/src/renderer/index.html`.
Common pet image protocols include `openpets-codex:`, `openpets-installed:`, and `openpets-pet-preview:`; forgetting CSP causes images to load as the default/fallback pet even when install/render logic is correct.

## Ubuntu VMware Testing

An Ubuntu 24.04 ARM64 VMware/Vagrant development VM exists for Linux GUI testing. See `/Volumes/external/repos/vagrants.md` for the host-side VM inventory and commands.

- VM directory: `/Volumes/external/vmware/ubuntu24`
- Provider: `vmware_desktop` / VMware Fusion on Apple Silicon
- Guest OpenPets checkout: `/home/vagrant/src/openpets`
- Guest helper aliases: `cdpets` and `openpets-dx`

Do not mount the macOS OpenPets checkout into Ubuntu for development. The macOS `node_modules` tree contains platform-specific packages and ownership metadata; using it from Linux can break local macOS development. Ubuntu testing should use the isolated guest clone and its own Linux `node_modules`.

For Linux GUI bug reproduction or Electron desktop testing:

1. Start or inspect the VM from `/Volumes/external/vmware/ubuntu24` with `vagrant up` / `vagrant status`.
2. SSH with `vagrant ssh`.
3. In the guest, run `cdpets` then `openpets-dx` to update dependencies, fix Electron sandbox permissions, and launch OpenPets in the Ubuntu desktop session.
4. Check guest logs at `~/.config/@open-pets/desktop/logs/openpets.log`.

The VM is configured to boot into the Ubuntu desktop (`graphical.target`) with GDM auto-login for the `vagrant` user. Prefer this VM when validating Linux-specific renderer, Electron, tray, pet-window, IPC, plugin, or packaging behavior.
