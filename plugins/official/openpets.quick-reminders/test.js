import assert from "node:assert/strict";
import { cleanMessage, durationMs, summary } from "./index.js";

assert.equal(cleanMessage("  hello\nthere  "), "hello there");
assert.equal(durationMs({ hours: 1, minutes: 30 }), 90 * 60_000);
assert.throws(() => durationMs({ hours: 0, minutes: 0 }));
assert.equal(summary([]), "No active reminders.");
