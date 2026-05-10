# OpenPets Desktop Release Guide

This guide is for an AI agent creating a new OpenPets desktop release from a local macOS machine. The release flow builds Electron artifacts locally, creates a draft GitHub Release, and uploads the assets.

## Repository and app

- GitHub repo: `alvinunreal/openpets`
- Desktop app: `apps/desktop`
- Release script: `apps/desktop/scripts/release-local.mjs`
- Root command: `pnpm release:desktop`
- Update checker expects GitHub release tags like `v2.0.0`.

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
13. Creates a draft GitHub Release.
14. Uploads top-level whitelisted artifacts only.

Draft releases are not visible to the app update checker until published.

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
pnpm release:desktop -- --yes --include-linux-targz
pnpm release:desktop -- --yes --include-optional
pnpm release:desktop -- --yes --include-experimental-arm
```

`--include-optional` includes mac zip, Windows portable, Linux deb, and Linux tar.gz x64 targets.

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

Update all workspace package versions together so bundled packages and npm packages report the same release version.

Use a new version for every release. npm package versions are immutable, so any change to a published package requires a new version across all public OpenPets npm packages.

Files to update:

```txt
package.json
apps/desktop/package.json
packages/agent-events/package.json
packages/claude/package.json
packages/cli/package.json
packages/client/package.json
packages/mcp/package.json
packages/opencode/package.json
packages/pet-format/package.json
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

Commit the version bump and any intentional release changes:

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

### 8. Create the draft GitHub Release and upload assets

For the recommended default release:

```bash
pnpm release:desktop -- --yes
```

For a fuller x64 release with optional artifacts:

```bash
pnpm release:desktop -- --yes --include-optional
```

The script creates a draft release named/tagged:

```txt
v<version>
```

Example:

```txt
v2.0.1
```

### 9. Smoke test before publishing

Before publishing the draft release, manually test at least:

- macOS DMG on the current Mac.
- Windows installer on a Windows machine or VM.
- Linux AppImage on a Linux machine or VM.

Unsigned release warnings are expected until code signing/notarization is configured:

- macOS may show Gatekeeper warnings.
- Windows may show SmartScreen warnings.

### 10. Publish the draft release

After smoke testing, publish the draft release on GitHub.

The app update checker will only see the release after it is published.

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

If the script creates the draft release but upload fails:

1. Inspect the draft release on GitHub.
2. Upload missing artifacts manually with:

```bash
gh release upload v<version> --repo alvinunreal/openpets <artifact-path>
```

3. Or delete the draft release/tag and rerun after fixing the issue.

## Manual packaging smoke commands

These do not create a GitHub Release:

```bash
pnpm --filter @open-pets/desktop build
node apps/desktop/scripts/clean-package-output.cjs
pnpm --dir apps/desktop exec electron-builder --mac dmg --x64 --publish never
pnpm --dir apps/desktop exec electron-builder --mac dmg --arm64 --publish never
pnpm --dir apps/desktop exec electron-builder --win nsis --x64 --publish never
pnpm --dir apps/desktop exec electron-builder --linux AppImage --x64 --publish never
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
@open-pets/cli
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
npm view @open-pets/cli@<version> version
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
