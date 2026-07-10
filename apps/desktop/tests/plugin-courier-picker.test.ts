import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const desktopRoot = process.env.OPENPETS_DESKTOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rendererSource = readFileSync(resolve(desktopRoot, "src/renderer/src/main.tsx"), "utf8");

// Extract the computeNextRovingIndex helper function text from main.tsx
const match = rendererSource.match(/export function computeNextRovingIndex\([\s\S]*?\n\}/);
if (!match) {
  throw new Error("computeNextRovingIndex not found in main.tsx");
}

// Strip TypeScript type annotations to make it executable Javascript in generic Node VM context
const funcCode = match[0]
  .replace("export ", "")
  .replace(/key:\s*string/, "key")
  .replace(/currentIndex:\s*number/, "currentIndex")
  .replace(/totalCount:\s*number/, "totalCount")
  .replace(/:\s*\{\s*nextIndex:\s*number\s*\}/, "");

// Execute the extracted code inside a VM context to perform executable behavior/interaction tests
const context = { Math };
vm.createContext(context);
vm.runInContext(funcCode, context);
const computeNextRovingIndex = (context as any).computeNextRovingIndex;

// Visual Roving Tabindex Interaction Asserts (Checking properties individually to bypass cross-context prototype strict equality limitations):
const totalCouriers = 6;

// ArrowRight moves focus forward (0 -> 1)
const r1 = computeNextRovingIndex("ArrowRight", 0, totalCouriers);
assert.equal(r1.nextIndex, 1);

// ArrowDown moves focus forward (5 -> 0 with wrapping)
const r2 = computeNextRovingIndex("ArrowDown", 5, totalCouriers);
assert.equal(r2.nextIndex, 0);

// ArrowLeft moves focus backward (5 -> 4)
const r3 = computeNextRovingIndex("ArrowLeft", 5, totalCouriers);
assert.equal(r3.nextIndex, 4);

// ArrowUp moves focus backward (0 -> 5 with wrapping)
const r4 = computeNextRovingIndex("ArrowUp", 0, totalCouriers);
assert.equal(r4.nextIndex, 5);

// Home/End select and focus boundary elements directly
const r5 = computeNextRovingIndex("Home", 3, totalCouriers);
assert.equal(r5.nextIndex, 0);

const r6 = computeNextRovingIndex("End", 3, totalCouriers);
assert.equal(r6.nextIndex, 5);

// Ordinary/unmatched keys don't shift index or select
const r7 = computeNextRovingIndex("Tab", 2, totalCouriers);
assert.equal(r7.nextIndex, 2);

console.log("plugin-courier-picker.test.ts: all roving index visual tests passed successfully.");
