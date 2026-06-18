# openpets.walkabout

An OpenPets plugin that makes your pet roam the screen.

## Modes

| Mode | Description |
|------|-------------|
| **Wander** (default) | Pet takes random strolls, pausing between steps |
| **Follow cursor** | Pet trails your mouse with configurable lag |
| **Physics** | Gravity + bounce — the pet falls and bounces around |
| **Patrol** | Pet paces back and forth across the screen |

## Config options

| Option | Values | Default |
|--------|--------|---------|
| Movement mode | wander / follow-cursor / physics / patrol | wander |
| Speed | slow / normal / brisk | normal |
| Move interval | 2s / 5s / 10s / 20s | 5s |
| Pause when agent is busy | on / off | on |

## Dev setup

The plugin requires the OpenPets desktop app and the `pet:move` permission set.

### Loading in dev mode

Point the OpenPets app at this folder via the `OPENPETS_DEV_PLUGIN_PATHS` env var:

```sh
# Packaged app (macOS)
OPENPETS_DEV_PLUGIN_PATHS=/Users/GTN473/repos/pets/openpets/plugins/dev/openpets.walkabout \
  open -a OpenPets

# Dev build (from repo root — requires pnpm)
OPENPETS_DEV_PLUGIN_PATHS=/Users/GTN473/repos/pets/openpets/plugins/dev/openpets.walkabout \
  pnpm dev:desktop
```

The plugin will be auto-approved in dev mode — no permission dialog.

### Running tests

```sh
node test.js
```

Tests use the `@open-pets/plugin-sdk/testing` harness (falls back to the local
monorepo build if the package isn't installed).

## File layout

```
openpets.walkabout/
├── openpets.plugin.json   Manifest (v3)
├── index.js               Plugin entry — all four mode implementations
├── test.js                Unit + lifecycle tests
├── package.json           Dev dependency declaration
├── locales/
│   └── en.json            English strings
└── README.md              This file
```
