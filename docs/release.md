# OpenPets Desktop Release Guide

This guide is for an AI agent creating a new OpenPets desktop release from a local macOS machine. The release flow builds Electron artifacts locally, creates a published GitHub Release, and uploads the assets.

## Repository and app

- GitHub repo: `alvinunreal/openpets`
- Desktop app: `apps/desktop`
- Release script: `apps/desktop/scripts/release-local.mjs`
- Root command: `pnpm release:desktop`
- Update checker expects GitHub release tags like `v2.0.0`.

## Current SDK v3, translations, and plugin release plan

The next end-user release is a **desktop + web plugin catalog + npm SDK release**. The baseline local release tag before this work is `v2.5.1`; changes since then include the new plugin SDK v3 package, a much larger desktop plugin host surface, manifest v3 plugins, plugin/app translations, and catalog packaging changes.

This is not a small patch release. Treat it as a major plugin-platform release unless product direction says otherwise.

Release goals:

1. Ship desktop plugin platform v3: SDK bridge, manifest v3 support, capability/permission enforcement, quotas, storage/state, events, bus, routes, UI panels, audio, notifications, diagnostics, and conformance checks.
2. Publish `@open-pets/plugin-sdk` so plugin authors can depend on the SDK v3 types and `./testing` harness.
3. Publish the official plugin catalog with the current first-party plugin lineup:
   - Day Routine (`openpets.day-routine`)
   - Focus Buddy (`openpets.focus-buddy`)
   - Fortune Cookie (`openpets.fortune-cookie`)
   - Launch Buddy (`openpets.launch-buddy`)
   - Magic 8 Ball (`openpets.magic-8-ball`)
   - Mood Check-in (`openpets.mood-check-in`)
   - Reminders (`openpets.reminders`)
   - Virtual Pet (`openpets.virtual-pet`)
   - Water Reminder (`openpets.water-reminder`)
4. Ship app/plugin translations and locale validation.
5. Remove or keep hidden the old plugin lineup from public discovery unless it has been migrated to manifest v3 and intentionally retained.
6. Keep older catalog endpoints available only as compatibility boundaries for old app versions; do not optimize current runtime behavior for legacy catalog/plugin paths.
7. Release desktop artifacts through GitHub Releases so app update checks see the new version.

Recommended versioning for this release:

- If publishing the SDK v3 package to npm, align **all publishable npm packages** to one shared version because `scripts/release-npm.mjs` enforces a single version across the publish order. For the SDK v3 launch, `3.0.0` is the natural version unless a different release decision is made.
- Bump `apps/desktop/package.json` to the same release version when shipping the desktop host/runtime that implements SDK v3. The current tagged desktop baseline is `v2.5.1`, so the next GitHub Release tag must be a new version.
- Do not leave `packages/sdk/package.json` at `3.0.0` while other publishable packages remain at `2.1.1` if running `pnpm release:npm`; the release script will reject mixed publishable package versions.

## Release workstreams for the SDK v3/plugin release

### A. Desktop app release

Desktop release includes:

- SDK v3 runtime bridge and `@open-pets/plugin-sdk` conformance alignment.
- Manifest v3/catalog support for translated official plugins.
- Expanded plugin host capabilities: permissions, storage/state, schedules, commands, events, bus, routes, UI panels, audio, notifications, quotas, diagnostics, and security validation.
- Plugin SDK preload and panel preload packaging contracts.
- Official plugin install/update/uninstall support.
- Plugins hub/configuration UI with translated plugin metadata/config fields.
- Local dev plugin workflow cleanup and plugin diagnostics.

Required validation before desktop release:

```bash
pnpm --filter @open-pets/desktop check
pnpm --filter @open-pets/desktop test
pnpm plugins:locales
pnpm --filter @open-pets/desktop package:dir
```

Manual desktop QA:

1. Run normal desktop dev startup or a packaged app (`pnpm dev:desktop` or the output from `pnpm --filter @open-pets/desktop package:dir`) so bundled seeding runs.
2. Open tray → Plugins.
3. Confirm the current official manifest v3 plugins appear in dev mode: Day Routine, Focus Buddy, Fortune Cookie, Launch Buddy, Magic 8 Ball, Mood Check-in, Reminders, Virtual Pet, and Water Reminder.
4. Confirm old sample/legacy plugins do not appear unless they were intentionally migrated and listed in the release plan.
5. Confirm plugin names, descriptions, config labels, command labels, and pet messages resolve through translations rather than raw `$t:` keys.
6. Exercise the SDK v3 surfaces used by official plugins: schedule, storage/state, commands, status, audio, notifications, pet reactions/interactions, and any panel UI.
7. Configure Reminders, Water Reminder, Focus Buddy, Launch Buddy, Day Routine, and other config-heavy plugins with form controls, not JSON.
8. Run plugin commands from the Plugins UI and pet right-click menu when available.
9. Restart desktop and confirm enabled plugins reload without broken state or duplicate timers/listeners.
10. Inspect logs for plugin SDK, translation, permission, quota, and manifest validation errors.

For explicit local plugin development, run `pnpm dev:desktop:plugins` separately and confirm official plugins are loaded as local dev plugins and start disabled; this mode intentionally skips bundled seeding.

### B. Web plugin catalog release

Web release includes:

- `plugins/official/**` source plugins.
- `web/public/plugins/catalog.v2.json`, regenerated from the current manifest v3 official plugin sources. The desktop runtime currently reads the v2 catalog endpoint even when the contained plugins use manifest v3 / SDK v3.
- `web/public/plugins/catalog.v1.json` retained as an empty compatibility catalog for old desktop versions.
- Removal or hiding of legacy sample plugin manifests from current public discovery.
- Updated `web/docs/plugin-publishing.md`.

Required validation from the repository root:

```bash
pnpm plugins:locales
pnpm plugins:test
pnpm plugins:check
pnpm plugins:package
pnpm --dir web generate
```

Publishing sequence:

1. From the repository root, validate and stage local catalog/ZIP artifacts:
   ```bash
   pnpm plugins:locales
   pnpm plugins:test
   pnpm plugins:check
   pnpm plugins:package
   ```
2. Confirm `pnpm plugins:package` regenerated `web/public/plugins/catalog.v2.json` from the current official manifest v3 plugin lineup. Do not release if the checked-in v2 catalog still lists the old ambient/break/pet-pal/wander/quick-reminders/github lineup.
3. Confirm `web/public/plugins/catalog.v1.json` has `plugins: []` and does not expose stale legacy plugins.
4. Upload plugin ZIPs to R2 and regenerate catalogs:
   ```bash
   pnpm plugins:publish
   ```
5. Deploy web:
   ```bash
   pnpm plugins:deploy
   ```
6. Verify live endpoints:
   - `https://openpets.dev/plugins/catalog.v2.json`
   - `https://openpets.dev/plugins/catalog.v1.json`
   - each `https://zip.openpets.dev/plugins/<plugin-id>.zip`

### C. GitHub Release notes

Suggested release title:

```txt
OpenPets v<version> — Plugin SDK v3
```

Suggested release notes:

```md
## New: Plugin SDK v3

OpenPets now includes the SDK v3 plugin platform for richer local companion behaviors, translated plugin experiences, and a public plugin SDK package.

### Included plugins

- Day Routine — morning and evening companion check-ins.
- Focus Buddy — focus/break sessions with pet feedback and controls.
- Fortune Cookie — daily and on-demand fortune messages.
- Launch Buddy — configurable greetings when OpenPets starts.
- Magic 8 Ball — playful answers from the pet menu.
- Mood Check-in — scheduled mood prompts.
- Reminders — short local reminders with optional sound and OS notifications.
- Virtual Pet — lightweight care and interaction loops.
- Water Reminder — hydration nudges with configurable pace and sound.

### Plugin management

- Plugins can use SDK v3 capabilities for pet actions, schedules, storage/state, commands, status, audio, notifications, events, and UI panels.
- Friendly translated plugin configuration UI; no JSON editing required.
- Plugin permissions, capabilities, quotas, and manifest validation are explicit.
- JavaScript plugins run through the desktop SDK bridge with conformance checks against `@open-pets/plugin-sdk`.

### Developer notes

- `@open-pets/plugin-sdk` provides SDK v3 types and a `./testing` entry point for plugin authors.
- Local plugin development is available through explicit developer mode and `pnpm dev:desktop:plugins`.
- Legacy sample plugins were removed or hidden from current discovery.

### Known limitations

- Desktop artifacts are currently unsigned, so OS security warnings may appear.
```

### D. NPM release decision

Default decision for this SDK v3 release: **publish npm packages** after versions are aligned.

NPM publishing is required if any of these are true:

- `@open-pets/plugin-sdk` should be available to plugin authors.
- CLI/MCP/client packages changed and users need the published package update.
- Existing published packages are incompatible with the desktop release in a way that affects normal use.

Before running `pnpm release:npm`, align every publishable package in `scripts/release-npm.mjs` to one shared version. The script currently publishes the SDK first and rejects mixed versions.

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

Default command for this SDK v3/plugin release:

```bash
pnpm release:desktop -- --yes --include-optional
```

Default build matrix for the local release script:

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
packages/sdk/package.json
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

### 7. Optional dry run

Run:

```bash
pnpm release:desktop -- --dry-run
```

This should pass preflight, build artifacts, generate checksums, and stop before creating the GitHub Release. A dry run is recommended for risky releases, but it can be skipped when the current release has already been validated and the user explicitly approves publishing directly.

If it fails because the tree is dirty, inspect:

```bash
git status --short
```

The release script requires a clean tree before release creation.

### 8. Create the published GitHub Release and upload assets

For the recommended SDK v3/plugin release with optional artifacts:

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

## Microsoft Store package quick actions

Use this flow when Partner Center rejects the unsigned Win32 `.exe` installer under Store policy 10.2.9. GitHub Releases should still prefer the NSIS setup `.exe`; Microsoft Store submission should use the Store package artifact.

Important Partner Center routing:

- Do **not** paste an `.appx` URL into the standalone `.exe`/`.msi` package URL field. That field is only for signed Win32 installers.
- Start a Microsoft Store **MSIX/AppX package** submission and upload the `.appx` package directly.
- If reusing the same app name from a failed Win32 submission is blocked, delete/abandon the Win32 package flow and recreate the submission as MSIX/AppX.

Electron Builder v26 uses the Windows Store target name `appx`. There is no separate `msix` target in this project setup; Partner Center accepts AppX/MSIX-family uploads.

AppX tile assets are separate from `win.icon`/`app-icon.ico`. Keep branded tile assets in `apps/desktop/build/appx/`; if these files are missing, Electron Builder falls back to its bundled `SampleAppx.*.png` placeholders and Microsoft Store certification rejects the package as using default tile images.

Required OpenPets AppX tile assets:

```txt
apps/desktop/build/appx/StoreLogo.png
apps/desktop/build/appx/Square44x44Logo.png
apps/desktop/build/appx/Square150x150Logo.png
apps/desktop/build/appx/Wide310x150Logo.png
```

Additional branded assets currently included:

```txt
apps/desktop/build/appx/SmallTile.png
apps/desktop/build/appx/LargeTile.png
apps/desktop/build/appx/BadgeLogo.png
apps/desktop/build/appx/SplashScreen.png
```

These assets are generated from `apps/desktop/assets/app-icon.png` plus OpenPets-branded tile art. Do not delete or rename them unless the AppX manifest/build config is updated at the same time.

Build a Windows x64 AppX package:

```bash
pnpm --filter @open-pets/desktop build
pnpm --filter @open-pets/desktop exec electron-builder --win appx --x64 \
  -c.appx.identityName=AlvinUnreal.OpenPetsDesktopCompanion \
  -c.appx.publisher=CN=5749BA4D-6A45-4111-8CAA-6B151AEDC238 \
  -c.appx.publisherDisplayName=AlvinUnreal \
  -c.appx.displayName="OpenPets: Desktop Companion" \
  -c.appx.applicationId=OpenPetsDesktopCompanion
```

`publisherDisplayName` must match the exact publisher display name shown by Partner Center. For the current Store account this is:

```txt
AlvinUnreal
```

If Partner Center reports `The PublisherDisplayName element ... doesn't match your publisher display name`, rebuild the AppX with the correct `-c.appx.publisherDisplayName=<Partner Center publisher display name>` value.

Partner Center validates AppX identity against the reserved Store product identity. For the current Store reservation, the expected values are:

```txt
identityName: AlvinUnreal.OpenPetsDesktopCompanion
package family name: AlvinUnreal.OpenPetsDesktopCompanion_aq5mzr83863gr
publisher: CN=5749BA4D-6A45-4111-8CAA-6B151AEDC238
displayName: OpenPets: Desktop Companion
applicationId: OpenPetsDesktopCompanion
```

If Partner Center reports `Invalid package identity name`, `Invalid package family name`, `Invalid package publisher name`, or an unreserved `Package/Properties/DisplayName`, rebuild using the exact values above. The package family name is derived from `identityName` and `publisher`, so do not set it manually.

Expected artifact:

```txt
apps/desktop/dist-electron/OpenPets-<version>-win-x64.appx
```

On macOS, AppX packaging runs Windows `makeappx.exe` through Parallels. If the repo is on an external drive and the build fails with `prlctl process failed 2` or a `\\Mac\\Host\\Volumes\\...` path error, either enable Parallels shared folders for all Mac disks or copy the repo to a Parallels-accessible home-folder path and build there.

If Electron Builder creates the AppX staging folder but fails only at the final `makeappx.exe` step because Parallels cannot resolve `\\Mac\\Host` paths, a manual fallback is:

1. Copy the Electron Builder `winCodeSign` cache into the accessible build folder.
2. Rewrite `dist-electron/__appx-x64/mapping.txt` paths from `\\Mac\\Host\\Users\\<user>` to `C:\\Mac\\Home`.
3. Run `makeappx.exe pack` from the Windows VM against the rewritten mapping file.

Known-good local workaround path from the May 2026 Store packaging session:

```txt
/Users/alvin/Downloads/openpets-msix-build/apps/desktop/dist-electron/OpenPets-2.5.0-win-x64.appx
```

Known-good corrected `2.5.0` AppX after rebuilding with Store identity values:

```txt
SHA256 4cc451a94d4be146b18ac59eb011ef3e89ff46e4e0836c8de0f36e68ad9b4a25
```

Verify the final AppX contains OpenPets tile assets, not Electron Builder sample defaults:

```bash
python3 - <<'PY'
from zipfile import ZipFile
appx = 'apps/desktop/dist-electron/OpenPets-<version>-win-x64.appx'
with ZipFile(appx) as z:
    for name in [
        'assets/StoreLogo.png',
        'assets/Square44x44Logo.png',
        'assets/Square150x150Logo.png',
        'assets/Wide310x150Logo.png',
        'assets/SmallTile.png',
        'assets/LargeTile.png',
        'assets/BadgeLogo.png',
        'assets/SplashScreen.png',
    ]:
        print(name, z.getinfo(name).file_size)
PY
```

Partner Center may warn that the restricted capability `runFullTrust` requires approval. This is expected for Electron desktop bridge/AppX packages because the manifest uses `EntryPoint="Windows.FullTrustApplication"` and `rescap:Capability Name="runFullTrust"`. The warning must be acknowledged or approved in Partner Center; it is not fixed by changing the URL or repackaging as a standalone `.exe`.

Upload the Store package to the public R2-backed download host:

```bash
bunx wrangler r2 object put \
  "openpets/releases/OpenPets-<version>-win-x64.appx" \
  --file "apps/desktop/dist-electron/OpenPets-<version>-win-x64.appx" \
  --remote
```

Public URL shape:

```txt
https://zip.openpets.dev/releases/OpenPets-<version>-win-x64.appx
```

Verify before submitting to Partner Center:

```bash
curl -I "https://zip.openpets.dev/releases/OpenPets-<version>-win-x64.appx"
```

R2 upload is optional for Partner Center MSIX/AppX submissions because the Store package flow accepts direct file upload. Use R2 only as a backup/share URL or for internal handoff.

## NPM package release

OpenPets publishes these public npm packages, in dependency order:

```txt
@open-pets/plugin-sdk
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

The npm release helper enforces one shared version across every package in its publish order, including `@open-pets/plugin-sdk`. If this release publishes SDK v3, bump the existing public packages to the same version before running the helper.

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
npm view @open-pets/plugin-sdk@<version> version
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
