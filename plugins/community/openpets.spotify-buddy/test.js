// Smoke tests for openpets.spotify-buddy.
import assert from "node:assert/strict";
import { register } from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(
    new URL("../../../packages/sdk/dist/testing.js", import.meta.url)
  ));
}

const permissions = [
  "network",
  "network:write",
  "schedule",
  "storage",
  "pet:speak",
  "pet:reaction",
  "commands",
  "status",
  "auth",
  "secrets",
  "ui:toast",
];

const locales = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("./locales/en.json", import.meta.url),
      "utf8",
    ),
  ),
};

const h = createTestHarness(register, {
  permissions,
  locales,
  config: { pollIntervalSeconds: 2 },
});

await h.start();

const commandIds = [...h.calls.commands.keys()];
assert.ok(commandIds.includes("spotify-login"), "registers Spotify login command");
assert.ok(commandIds.includes("spotify-show-lyrics"), "registers lyrics command");
assert.ok(h.calls.schedules.has("spotify-poll"), "schedules the polling loop");

h.expectNoErrors();
await h.stop();
