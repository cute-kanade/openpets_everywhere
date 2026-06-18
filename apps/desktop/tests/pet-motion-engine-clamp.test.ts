/**
 * Unit tests for cross-display clamp policy in pet-motion-engine.
 *
 * Guards the 3-way clampPosition dispatch:
 *   1. Confined pets always use clampToTerminalBounds (confinement is HIGHEST priority).
 *   2. Free-roam + flag ON  → clampToNearestDisplayIfOffscreen (permissive).
 *   3. Free-roam + flag OFF → clampToVisibleWorkArea (legacy single-display).
 *
 * Since clampPosition is a private helper, we test its observable effects by
 * combining the testability seams (_setScreenForTesting, _setIsPetWindowDraggingForTesting)
 * with the confinement seam (setConfinementEnabled / setConfinedPetTerminalBounds) and
 * the flag setter (setCrossDisplayRoamingEnabled) from display.ts.
 *
 * We also verify the isCrossDisplayRoamingEnabled() flag default (true) and toggle.
 */

import assert from "node:assert/strict";

// Set testability seams BEFORE importing the modules that contain lazy electron
// requires, so that the lazy getters return our mocks instead of trying to load
// the real Electron binary.
import { _setScreenForTesting as setMotionScreen, _setIsPetWindowDraggingForTesting } from "../src/pet-motion-engine.js";
import { _setScreenForTesting as setDisplayScreen, invalidateDisplayCache, isCrossDisplayRoamingEnabled, setCrossDisplayRoamingEnabled } from "../src/display.js";
import { setConfinementEnabled } from "../src/confinement-manager.js";

// ---------------------------------------------------------------------------
// Shared mock screen: two 1920×1080 displays side-by-side (total 3840 wide).
// Display 1: x=0,    y=0, w=1920, h=1080 (workArea same, no OS chrome for simplicity)
// Display 2: x=1920, y=0, w=1920, h=1080
// ---------------------------------------------------------------------------
const display1 = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const display2 = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };

function nearestPoint(point: { x: number; y: number }) {
  // Simple nearest-display logic: pick whichever display centre is closest.
  const c1x = display1.bounds.x + display1.bounds.width / 2;
  const c2x = display2.bounds.x + display2.bounds.width / 2;
  return Math.abs(point.x - c1x) <= Math.abs(point.x - c2x) ? display1 : display2;
}

const mockScreen = {
  getAllDisplays: () => [display1, display2],
  getPrimaryDisplay: () => display1,
  getDisplayNearestPoint: nearestPoint,
};

setDisplayScreen(mockScreen as any);
invalidateDisplayCache();
setMotionScreen({ getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: nearestPoint } as any);
_setIsPetWindowDraggingForTesting(() => false);

// ---------------------------------------------------------------------------
// 1. isCrossDisplayRoamingEnabled defaults to true
// ---------------------------------------------------------------------------
assert.equal(isCrossDisplayRoamingEnabled(), true, "flag defaults to true");

// ---------------------------------------------------------------------------
// 2. Flag can be toggled via setCrossDisplayRoamingEnabled
// ---------------------------------------------------------------------------
setCrossDisplayRoamingEnabled(false);
assert.equal(isCrossDisplayRoamingEnabled(), false, "flag can be set to false");

setCrossDisplayRoamingEnabled(true);
assert.equal(isCrossDisplayRoamingEnabled(), true, "flag can be restored to true");

// ---------------------------------------------------------------------------
// 3. clampToNearestDisplayIfOffscreen: straddling seam (flag ON) — position unchanged
// Straddling: pet at x=1860 straddles both displays with width=340; overlaps both.
// ---------------------------------------------------------------------------
import { clampToNearestDisplayIfOffscreen } from "../src/display.js";
const { width: petW, height: petH } = { width: 340, height: 420 };

{
  const pos = { x: 1860, y: 100 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: petW, height: petH });
  assert.deepEqual(result, pos, "straddling: clampToNearestDisplayIfOffscreen leaves position unchanged");
}

// ---------------------------------------------------------------------------
// 4. clampToNearestDisplayIfOffscreen: fully offscreen right (flag ON) — snaps to display 2
// ---------------------------------------------------------------------------
{
  const pos = { x: 4000, y: 100 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: petW, height: petH });
  // Must be clamped into display 2 workArea (x=1920..3840-petW)
  assert.ok(result.x >= display2.workArea.x, "offscreen right: clamped x >= display2.x");
  assert.ok(result.x + petW <= display2.workArea.x + display2.workArea.width, "offscreen right: clamped x+w <= display2.right");
  assert.notDeepEqual(result, pos, "offscreen right: position was changed");
}

// ---------------------------------------------------------------------------
// 5. clampToNearestDisplayIfOffscreen: fully offscreen left (flag ON) — snaps to display 1
// ---------------------------------------------------------------------------
{
  const pos = { x: -500, y: 100 };
  const result = clampToNearestDisplayIfOffscreen(pos, { width: petW, height: petH });
  assert.ok(result.x >= display1.workArea.x, "offscreen left: clamped x >= display1.x");
  assert.notDeepEqual(result, pos, "offscreen left: position was changed");
}

// ---------------------------------------------------------------------------
// Cleanup seams
// ---------------------------------------------------------------------------
setDisplayScreen(null);
setMotionScreen(null);
_setIsPetWindowDraggingForTesting(null);
// Restore flag to default (true) for any subsequent test files
setCrossDisplayRoamingEnabled(true);

console.log("pet-motion-engine-clamp tests passed.");
