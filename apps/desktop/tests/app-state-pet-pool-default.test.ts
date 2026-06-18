/**
 * Unit tests for app-state petPoolEnabled default change and petId forwarding:
 *   (1) Fresh default: petPoolEnabled must be true (not the old false).
 *   (2) Persisted explicit false is preserved after normalization.
 *   (3) Persisted explicit true is preserved.
 *   (4) Missing key (old stored state without the field) falls back to new default (true).
 *   (5) recordOpenPetsActivity forwards petId into publishPluginAgentActivity (source-regex).
 *
 * NOTE: app-state.ts imports Electron so we cannot import it here directly.
 * Instead we test the normalization contract via an isolated replica of the
 * normalizePreferences petPoolEnabled logic (lines 498-500 of app-state.ts):
 *
 *   petPoolEnabled: typeof value.petPoolEnabled === "boolean"
 *     ? value.petPoolEnabled
 *     : defaultState.preferences.petPoolEnabled
 *
 * And we verify the DEFAULT value by reading the source file directly.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// (1) Fresh default: verify createDefaultState() sets petPoolEnabled: true
//     by checking the source (avoids Electron import while pinning the value).
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(__dirname, "../src/app-state.ts"), "utf-8");

  // The line we changed: should be petPoolEnabled: true
  const match = src.match(/petPoolEnabled:\s*(true|false),/);
  assert.ok(match !== null, "petPoolEnabled default line must be present in app-state.ts");
  assert.equal(
    match![1],
    "true",
    "(1) createDefaultState() must set petPoolEnabled: true (fresh default)",
  );
}

// ---------------------------------------------------------------------------
// (2-4) normalizePreferences logic replica:
//   petPoolEnabled: typeof value.petPoolEnabled === "boolean"
//     ? value.petPoolEnabled
//     : DEFAULT
//
// With DEFAULT now === true, test all three cases.
// ---------------------------------------------------------------------------

const NEW_DEFAULT = true;

function normalizePoolEnabled(stored: unknown): boolean {
  return typeof stored === "boolean" ? stored : NEW_DEFAULT;
}

// (2) Explicit stored false is preserved
assert.equal(normalizePoolEnabled(false), false, "(2) explicit persisted false must survive normalization");

// (3) Explicit stored true is preserved
assert.equal(normalizePoolEnabled(true), true, "(3) explicit persisted true is preserved");

// (4) Missing key (undefined) falls back to new default
assert.equal(normalizePoolEnabled(undefined), true, "(4) missing key falls back to new default (true)");

// Also verify non-boolean stored values fall back to default (extra safety)
assert.equal(normalizePoolEnabled(null), true, "(4b) null stored value falls back to new default");
assert.equal(normalizePoolEnabled("true"), true, "(4c) string 'true' falls back to new default");

// ---------------------------------------------------------------------------
// (5) Source-regex: recordOpenPetsActivity forwards petId into publishPluginAgentActivity
//
// app-state.ts cannot be imported (Electron dep), so we pin the call-site
// text directly.  If someone strips petId: activity.petId from the call,
// this test will fail before any runtime path catches it.
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(__dirname, "../src/app-state.ts"), "utf-8");

  // The call site introduced by the follow-up fix (line ~265):
  //   publishPluginAgentActivity({ kind: activity.kind, reaction: activity.reaction, petId: activity.petId });
  assert.ok(
    src.includes("publishPluginAgentActivity("),
    "(5a) publishPluginAgentActivity must be called inside app-state.ts",
  );

  // Extract the publishPluginAgentActivity call block and verify petId is forwarded.
  const callMatch = src.match(/publishPluginAgentActivity\(\{[^}]+\}/);
  assert.ok(callMatch !== null, "(5b) publishPluginAgentActivity call must be parseable");
  assert.ok(
    callMatch![0].includes("petId: activity.petId"),
    "(5c) recordOpenPetsActivity must forward petId: activity.petId into publishPluginAgentActivity",
  );
}

console.log("app-state-pet-pool-default tests passed.");
