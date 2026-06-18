/**
 * Renderer toggle static regression tests.
 *
 * Tests verify two behaviours in main.tsx using source-text assertions
 * (the same pattern as plugin-ui-static.test.ts):
 *
 * 1. Confinement settings toggle
 *    - Has data-testid="setting-pet-confinement-toggle"
 *    - Reads `settings?.preferences.petConfinementEnabled`
 *    - On change, calls patchPreferences({ petConfinementEnabled: <next> })
 *      using the synchronously-captured `checked` value (guards against
 *      async-inversion bugs).
 *
 * 2. Plugin enable/disable toggle – regression for inverted-state bug
 *    - Both card toggle and inspector toggle capture `event.target.checked`
 *      synchronously BEFORE any `await` call.
 *    - The captured value `nextEnabled` is passed to `api.setPluginEnabled`
 *      and to the toast string (so toast/state show the CORRECT new value,
 *      not the old/inverted value).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot =
  process.env.OPENPETS_DESKTOP_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..");

const rendererSource = readFileSync(
  resolve(desktopRoot, "src/renderer/src/main.tsx"),
  "utf8",
);

// ─── 1. Confinement settings toggle ──────────────────────────────────────────

// (a) The ToggleRow for confinement is rendered with the expected testId prop.
assert.match(
  rendererSource,
  /testId="setting-pet-confinement-toggle"/,
  "confinement toggle: testId prop must be present",
);

// (b) The ToggleRow component wires testId to data-testid on the <input>.
assert.match(
  rendererSource,
  /data-testid=\{testId\}/,
  "ToggleRow: must wire testId prop to data-testid on <input>",
);

// (c) The checked prop reads settings.preferences.petConfinementEnabled
//     (optional-chained from the nullable settings state).
assert.match(
  rendererSource,
  /checked=\{settings\?\.preferences\.petConfinementEnabled/,
  "confinement toggle: checked prop must read settings?.preferences.petConfinementEnabled",
);

// (d) The onChange handler passes the captured `checked` value to patchPreferences
//     with the correct key — this guards the true→false and false→true paths.
assert.match(
  rendererSource,
  /onChange=\{\(checked\) => patchPreferences\(\{ petConfinementEnabled: checked \}/,
  "confinement toggle: onChange must call patchPreferences({ petConfinementEnabled: checked }, ...)",
);

// (d2) The toast argument is a localized t() call, not a hardcoded literal.
assert.match(
  rendererSource,
  /patchPreferences\(\{ petConfinementEnabled: checked \},\s*t\("settings\.toast\.confinementSaved"\)\)/,
  'confinement toggle: onChange must pass t("settings.toast.confinementSaved") as the toast — not a hardcoded string',
);

// (e) The ToggleRow onChange implementation captures event.target.checked
//     synchronously into `next` before invoking its handler — this is the
//     pattern that ensures the new value is not inverted.
assert.match(
  rendererSource,
  /onChange=\{\(event\) => \{ const next = event\.target\.checked; onChange\(next\); \}\}/,
  "ToggleRow: onChange must synchronously capture event.target.checked into `next` before calling onChange(next)",
);

// ─── 2. Plugin enable/disable toggle – inverted-state regression ─────────────
//
// The bug was: the async handler used `event.target.checked` AFTER an await,
// by which point the synthetic event had been recycled / the value could be
// stale or appear inverted in tests.  The fix captures the value synchronously.
//
// We verify that BOTH the plugin-card toggle and the inspector toggle follow
// the fixed pattern:
//
//   onChange={(event) => {
//     const nextEnabled = event.target.checked;   // ← synchronous capture
//     void run(..., async () => {
//       applyResult(await api.setPluginEnabled(..., nextEnabled), ...);
//     });
//   }}

// (a) The captured variable name used in plugin toggles is `nextEnabled`.
assert.match(
  rendererSource,
  /const nextEnabled = event\.target\.checked/,
  "plugin toggle: must capture event.target.checked synchronously as `nextEnabled`",
);

// (b) The synchronous capture occurs BEFORE any await in the same handler —
//     i.e., `nextEnabled` is declared outside the async closure.
//     Pattern: `const nextEnabled = event.target.checked` then `async () => {`
//     with `nextEnabled` used inside.
assert.match(
  rendererSource,
  /const nextEnabled = event\.target\.checked;[\s\S]{0,200}async \(\) => \{[\s\S]{0,400}nextEnabled/,
  "plugin toggle: nextEnabled must be captured before the async closure and used inside it",
);

// (c) api.setPluginEnabled is called with `nextEnabled` (the captured value),
//     not with `!installed.enabled` or `event.target.checked` inside an async body.
assert.match(
  rendererSource,
  /api\.setPluginEnabled\([^)]*,\s*nextEnabled\)/,
  "plugin toggle: api.setPluginEnabled must receive `nextEnabled` (not an inverted/event value)",
);

// (d) The toast string also uses the synchronously-captured value, so the
//     shown toast matches the actual new state (enable→pluginEnabled toast,
//     disable→pluginDisabled toast).
assert.match(
  rendererSource,
  /nextEnabled \? t\("plugins\.toast\.pluginEnabled"\) : t\("plugins\.toast\.pluginDisabled"\)/,
  "plugin toggle: toast must branch on `nextEnabled` to show the correct enabled/disabled message",
);

// (e) Confirm no stale-inversion patterns exist: no handler passes
//     `!installed.enabled` to setPluginEnabled (the pre-fix pattern).
assert.doesNotMatch(
  rendererSource,
  /setPluginEnabled\([^)]*,\s*!installed\.enabled\)/,
  "plugin toggle: must NOT pass !installed.enabled to setPluginEnabled (that was the bug)",
);

// (f) Confirm event.target.checked is not accessed inside an async body
//     (which would be the stale-event pattern).
assert.doesNotMatch(
  rendererSource,
  /async \(\) => \{[^}]*event\.target\.checked/,
  "plugin toggle: event.target.checked must not be read inside an async closure",
);

// ─── 3. Pet-pool settings toggle ─────────────────────────────────────────────

// (a) The pet-pool ToggleRow title uses a localized t() key, not a hardcoded string.
assert.match(
  rendererSource,
  /title=\{t\("settings\.petPool\.label"\)\}/,
  'pet-pool toggle: title must use t("settings.petPool.label")',
);

// (b) The pet-pool ToggleRow description uses a localized t() key.
assert.match(
  rendererSource,
  /description=\{t\("settings\.petPool\.description"\)\}/,
  'pet-pool toggle: description must use t("settings.petPool.description")',
);

// (c) onChange calls patchPreferences with the correct key and a localized toast.
assert.match(
  rendererSource,
  /patchPreferences\(\{ petPoolEnabled: checked \},\s*t\("settings\.toast\.petPoolSaved"\)\)/,
  'pet-pool toggle: onChange must pass t("settings.toast.petPoolSaved") as the toast',
);

// (d) Confirm no hardcoded English title string remains for the pool toggle.
assert.doesNotMatch(
  rendererSource,
  /title="Assign a different pet to each session"/,
  'pet-pool toggle: hardcoded English title must not be present',
);

console.error("Renderer toggle regression tests passed.");
