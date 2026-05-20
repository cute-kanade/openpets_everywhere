# OpenPets Desktop Release Guide

This guide is for an AI agent creating a new OpenPets desktop release from a local macOS machine. The release flow builds Electron artifacts locally, creates a published GitHub Release, and uploads the assets.

## Repository and app

- GitHub repo: `alvinunreal/openpets`
- Desktop app: `apps/desktop`
- Release script: `apps/desktop/scripts/release-local.mjs`
- Root command: `pnpm release:desktop`
- Update checker expects GitHub release tags like `v2.0.0`.

## Current desktop patch release plan

The next end-user release is a **desktop-only macOS packaging patch** for issue #30. Do **not** publish npm packages for this patch.

Release goals:

1. Ship a new desktop GitHub Release with `apps/desktop/package.json` bumped to the next patch version.
2. Build with optional desktop artifacts included via `pnpm release:desktop -- --yes --include-optional`.
3. Keep npm packages unchanged because this is an Electron packaging/release artifact fix only.
4. Confirm the macOS app bundle passes local `codesign --verify --deep --strict` before publishing.

Suggested patch release notes:

```md
## Fixed

- Fixed macOS release packaging so app bundles are ad-hoc signed when a Developer ID certificate is unavailable.
- This addresses the misleading macOS Gatekeeper dialog that can say OpenPets is damaged and can't be opened on Apple Silicon/Sequoia.
- Rebuilt desktop artifacts with optional packages included: macOS ZIP, Windows portable, Linux DEB/RPM, and Linux tar.gz.

## Known limitations

- macOS artifacts are ad-hoc signed but not Developer ID notarized yet, so Gatekeeper may still require a first-open confirmation.
- Windows artifacts are unsigned, so SmartScreen warnings may appear.
```

## Previous plugin platform release plan

The next end-user release is a **desktop + web plugin catalog release**, not an npm package release by default.

Release goals:

1. Ship the desktop JavaScript plugin runtime and polished Plugins UI.
2. Publish the official plugin catalog with exactly these first-party plugins:
   - Daily Reminders (`openpets.daily-reminders`)
   - Pomodoro (`openpets.pomodoro`)
   - GitHub Notifications (`openpets.github-notifications`)
3. Remove legacy sample plugins from public discovery:
   - Break Reminder
   - Eye Rest
   - Focus Check-in
   - Hydration Buddy
   - Pomodoro Buddy
4. Keep the old v1 plugin catalog available as an empty compatibility catalog.
5. Release desktop artifacts through GitHub Releases so app update checks see the new version.

Do **not** publish npm packages for this release unless a public npm package changed in a way that must be distributed through npm. Desktop can have a newer version than the npm packages. That is acceptable for desktop-only features like Electron UI, desktop runtime, packaging, and plugin catalog support.

## Release workstreams for the plugin release

### A. Desktop app release

Desktop release includes:

- JavaScript plugin host and SDK preload.
- Manifest v2/catalog v2 support.
- Official plugin install/update/uninstall support.
- Polished Plugins hub/configuration UI.
- Local dev plugin workflow cleanup.
- Packaging contract updates for plugin SDK preload.

Required validation before desktop release:

```bash
pnpm --filter @open-pets/desktop check
pnpm --filter @open-pets/desktop test
pnpm --filter @open-pets/desktop package:dir
```

Manual desktop QA:

1. Run `pnpm dev:desktop:plugins`.
2. Open tray → Plugins.
3. Confirm only Daily Reminders, Pomodoro, and GitHub Notifications appear in dev mode.
4. Confirm old sample plugins do not appear.
5. Enable/configure Daily Reminders with reminder cards, not JSON.
6. Run Daily Reminders test command.
7. Configure Pomodoro timing/messages/reactions and run start/pause/stop commands.
8. Configure GitHub public repositories; verify no token/OAuth UI exists.
9. Confirm GitHub plugin only asks for `api.github.com` network approval.
10. Restart desktop and confirm enabled plugins reload without broken state.
11. Inspect logs for plugin errors.

### B. Web plugin catalog release

Web release includes:

- `web/plugins/official/**` source plugins.
- `web/public/plugins/catalog.v2.json` with the three official plugins.
- `web/public/plugins/catalog.v1.json` with an empty plugin list.
- Removal of legacy sample plugin manifests.
- Updated `web/docs/plugin-publishing.md`.

Required validation from `web/`:

```bash
node scripts/sync-plugins.js --dry-run --skip-r2
bun run generate
```

Publishing sequence:

1. From `web/`, upload plugin ZIPs and regenerate catalogs:
   ```bash
   bun run sync:plugins
   ```
2. Confirm `public/plugins/catalog.v2.json` has only the three official plugins.
3. Confirm `public/plugins/catalog.v1.json` has `plugins: []`.
4. Deploy web:
   ```bash
   bun run deploy
   ```
5. Verify live endpoints:
   - `https://openpets.dev/plugins/catalog.v2.json`
   - `https://openpets.dev/plugins/catalog.v1.json`
   - each `https://zip.openpets.dev/plugins/<plugin-id>.zip`

### C. GitHub Release notes

Suggested release title:

```txt
OpenPets v<version> — Plugins
```

Suggested release notes:

```md
## New: OpenPets Plugins

OpenPets now includes a first-party plugin platform for optional desktop companion behaviors.

### Included plugins

- Daily Reminders — recurring local reminders with custom messages, reactions, days, and intervals.
- Pomodoro — focus/break sessions with pet feedback and controls.
- GitHub Notifications — public repository release and failed-workflow notifications. No GitHub login, token, or private repository access is used.

### Plugin management

- New polished Plugins window with install, enable, configure, update, reload, and uninstall actions.
- Friendly plugin configuration UI; no JSON editing required.
- Plugin permissions and network hosts are explicit.
- JavaScript plugins run in a sandboxed renderer with a narrow OpenPets SDK.

### Developer notes

- Local plugin development is available through explicit developer mode and `pnpm dev:desktop:plugins`.
- Legacy sample plugins were removed from discovery.

### Known limitations

- GitHub Notifications supports public repositories only in this release.
- Desktop artifacts are currently unsigned, so OS security warnings may appear.
```

### D. NPM release decision

Default decision for this plugin release: **skip npm publishing**.

Only do an npm release if one of these is true:

- A public npm package under `packages/*` changed and users need the published package update.
- CLI/MCP/client protocol changes are required by the desktop release and must be distributed to external users.
- Existing published packages are incompatible with the desktop release in a way that affects normal use.

If npm is needed, publish all public npm packages together using the NPM package release section below. Do not partially publish a subset unless the release tooling and package dependency versions are intentionally changed to support that.

## What the release script does

`pnpm release:desktop -- --yes` performs these checks/actions:

1. Requires macOS.
2. Requires `pnpm` and `gh`.
3. Requires GitHub CLI auth for `github.com`.
4. Requires `origin` to point to `alvinunreal/openpets`.
5. Requires a clean git working tree.
6. Requires the current branch to have an upstream.
7. Requires local `HEAD` to match the upstream branch.
8. Requires desktop version to be stable semver and not `0.0.0`.
9. Requires tag/release `v<version>` to not already exist.
10. Runs build/checks.
11. Builds release artifacts.
12. Generates `SHA256SUMS`.
13. Creates a published GitHub Release.
14. Uploads top-level whitelisted artifacts only.

Published releases are visible to the app update checker.

## Default release assets

Default command:

```bash
pnpm release:desktop -- --yes
```

Default build matrix:

- macOS DMG: x64 + arm64
- Windows NSIS installer: x64
- Linux AppImage: x64

Expected main artifacts look like:

```txt
OpenPets-<version>-mac-x64.dmg
OpenPets-<version>-mac-arm64.dmg
OpenPets-<version>-win-x64-setup.exe
OpenPets-<version>-linux-x86_64.AppImage
SHA256SUMS
```

Optional flags:

```bash
pnpm release:desktop -- --yes --include-mac-zip
pnpm release:desktop -- --yes --include-win-portable
pnpm release:desktop -- --yes --include-linux-deb
pnpm release:desktop -- --yes --include-linux-rpm
pnpm release:desktop -- --yes --include-linux-targz
pnpm release:desktop -- --yes --include-optional
pnpm release:desktop -- --yes --include-experimental-arm
```

`--include-optional` includes mac zip, Windows portable, Linux deb, Linux rpm, and Linux tar.gz x64 targets.

`--include-experimental-arm` adds Windows ARM64 and Linux ARM64 artifacts. Only use this if those artifacts can be tested.

## Full release procedure

### 1. Choose the next version

Use stable semver only:

```txt
2.0.0
2.0.1
2.1.0
3.0.0
```

Do not use `0.0.0` or prerelease tags unless the release script is intentionally changed.

### 2. Bump package versions

For a **desktop-only release** that changes only the Electron app and GitHub desktop artifacts, bump `apps/desktop/package.json` only. Do not bump or publish public npm packages unless their package contents changed.

Desktop-only releases may intentionally use a different version than the root workspace and public npm packages. The GitHub desktop release tag follows `apps/desktop/package.json`, and the app update checker reads GitHub Releases, not npm.

For a full workspace/npm release, update all workspace package versions together so bundled packages and npm packages report the same release version.

Use a new version for every release artifact you publish. npm package versions are immutable, so any change to a published package requires a new version across all public OpenPets npm packages.

Files to update for a full workspace/npm release:

```txt
package.json
apps/desktop/package.json
packages/agent-events/package.json
packages/claude/package.json
packages/cli/package.json
packages/client/package.json
packages/cursor/package.json
packages/install-pet/package.json
packages/mcp/package.json
packages/opencode/package.json
packages/pet-format/package.json
packages/pi/package.json
```

Set each top-level `version` field to the chosen version, for example:

```json
"version": "2.0.1"
```

### 3. Install/update lockfile if needed

Run:

```bash
pnpm install
```

If `pnpm-lock.yaml` changes, include it in the version bump commit.

### 4. Run checks before committing

Run:

```bash
pnpm build
pnpm --filter @open-pets/desktop check
```

Fix any failures before continuing.

### 5. Commit and push the version bump

Check status:

```bash
git status --short
```

Commit the version bump and any intentional release changes. For a desktop-only release, stage `apps/desktop/package.json` instead of every package manifest.

```bash
git add package.json apps/desktop/package.json packages/*/package.json pnpm-lock.yaml
git commit -m "release desktop v<version>"
git push
```

Only add files that are intentionally part of the release. Do not accidentally include unrelated worktree changes.

### 6. Confirm GitHub CLI auth

Run:

```bash
gh auth status --hostname github.com
```

If not authenticated:

```bash
gh auth login
```

### 7. Run a dry run first

Run:

```bash
pnpm release:desktop -- --dry-run
```

This should pass preflight, build artifacts, generate checksums, and stop before creating the GitHub Release.

If it fails because the tree is dirty, inspect:

```bash
git status --short
```

The release script requires a clean tree before release creation.

### 8. Create the published GitHub Release and upload assets

For the recommended default release:

```bash
pnpm release:desktop -- --yes
```

For a fuller x64 release with optional artifacts:

```bash
pnpm release:desktop -- --yes --include-optional
```

The script creates a published release named/tagged:

```txt
v<version>
```

Example:

```txt
v2.0.1
```

### 9. Smoke test after publishing

After publishing the release, manually test at least:

- macOS DMG on the current Mac.
- Windows installer on a Windows machine or VM.
- Linux AppImage on a Linux machine or VM.

Unsigned release warnings are expected until code signing/notarization is configured:

- macOS may show Gatekeeper warnings.
- Windows may show SmartScreen warnings.

## Common failure modes

### Version is `0.0.0`

Fix `apps/desktop/package.json` and the other workspace package versions.

### Dirty working tree

The release script refuses to create releases from a dirty checkout. Commit, stash, or revert changes first.

### HEAD is not pushed

Push the current branch before releasing:

```bash
git push
```

### Tag or release already exists

Use a new version, or manually inspect GitHub releases/tags before proceeding.

### Partial GitHub upload failure

If the script creates the release but upload fails:

1. Inspect the release on GitHub.
2. Upload missing artifacts manually with:

```bash
gh release upload v<version> --repo alvinunreal/openpets <artifact-path>
```

3. Or delete the release/tag and rerun after fixing the issue.

## Manual packaging smoke commands

These do not create a GitHub Release:

```bash
pnpm --filter @open-pets/desktop build
node apps/desktop/scripts/clean-package-output.cjs
pnpm --dir apps/desktop exec electron-builder --mac dmg --x64 --publish never
pnpm --dir apps/desktop exec electron-builder --mac dmg --arm64 --publish never
pnpm --dir apps/desktop exec electron-builder --win nsis --x64 --publish never
pnpm --dir apps/desktop exec electron-builder --linux AppImage --x64 --publish never
pnpm --dir apps/desktop exec electron-builder --linux rpm --x64 --publish never
```

Artifacts are written to:

```txt
apps/desktop/dist-electron/
```

## NPM package release

OpenPets publishes these public npm packages, in dependency order:

```txt
@open-pets/client
@open-pets/agent-events
@open-pets/mcp
@open-pets/claude
@open-pets/opencode
@open-pets/cursor
@open-pets/pi
@open-pets/cli
install-pet
```

Do not publish the private workspace root, `@open-pets/desktop`, or `@open-pets/pet-format`.

Publish all public packages together at the same version whenever any public package changes. The CLI depends on the other `@open-pets/*` packages by exact published version, so partial/mixed-version npm releases can break `npx -y @open-pets/cli ...`.

Dry-run npm publishing first:

```bash
pnpm release:npm
```

Publish all missing packages to npm. Package versions that already exist on npm are skipped automatically:

```bash
pnpm release:npm -- --yes
```

If npm requires two-factor auth:

```bash
pnpm release:npm -- --yes --otp <code>
```

Publishing with the npm helper requires `npm whoami` to succeed, a clean working tree, and local `HEAD` to match the upstream branch.

After publishing, verify the npm dependency set resolves:

```bash
npm view @open-pets/client@<version> version
npm view @open-pets/agent-events@<version> version
npm view @open-pets/mcp@<version> version
npm view @open-pets/claude@<version> version
npm view @open-pets/opencode@<version> version
npm view @open-pets/cursor@<version> version
npm view @open-pets/pi@<version> version
npm view @open-pets/cli@<version> version
npm view install-pet@<version> version
npx -y @open-pets/cli@<version> --help
```

## Important notes for future agents

- Do not publish from an uncommitted local state.
- Do not use `--skip-checks` with `--yes`; the script rejects this.
- Do not upload the entire `dist-electron` directory manually. Upload only final top-level artifacts and `SHA256SUMS`.
- Keep the tag format as `v<version>`.
- Keep `publish: null` in `electron-builder.yml`; GitHub release upload is handled by the local script.
- Windows icon is `apps/desktop/assets/app-icon.ico`.
- macOS icon is `apps/desktop/assets/app-icon.icns`.
- The Windows/macOS artifacts are currently unsigned unless signing config is added later.
