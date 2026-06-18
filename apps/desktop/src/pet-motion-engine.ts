import { createRequire } from "node:module";

import type { BrowserWindow } from "electron";

import { clampToTerminalBounds, getEffectiveConfinementBounds } from "./confinement-manager.js";
import { clampToNearestDisplayIfOffscreen, clampToVisibleWorkArea, defaultPetWindowSize, isCrossDisplayRoamingEnabled, type Point } from "./display.js";
// isPetWindowDragging is lazily loaded via _setIsPetWindowDraggingForTesting seam

// ---------------------------------------------------------------------------
// Testability seams — allow unit tests to inject mock implementations without
// requiring a running Electron process.
// Same pattern as setConfinementEnabled() in confinement-manager.ts.
// ---------------------------------------------------------------------------

interface ScreenImpl {
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): { workArea: { x: number; y: number; width: number; height: number } };
}
type IsPetWindowDraggingFn = (win: BrowserWindow) => boolean;

// createRequire restores a working `require` in this ESM module so the lazy
// electron / pet-window loads below succeed at runtime (the production bundle
// runs as ESM where the CommonJS `require` global is not defined).
const require = createRequire(import.meta.url);

// Lazily loaded — avoids a hard electron import at module-load time so that
// unit tests can call _setScreenForTesting() without requiring Electron.
let _screen: ScreenImpl | null = null;
// Lazily loaded — same rationale as _screen above.
let _isPetWindowDragging: IsPetWindowDraggingFn | null = null;

function getIsPetWindowDragging(): IsPetWindowDraggingFn {
  if (!_isPetWindowDragging) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isPetWindowDragging } = require("./pet-window.js") as { isPetWindowDragging: IsPetWindowDraggingFn };
    _isPetWindowDragging = isPetWindowDragging;
  }
  return _isPetWindowDragging;
}

function getScreen(): ScreenImpl {
  if (!_screen) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { screen } = require("electron") as { screen: ScreenImpl };
    _screen = screen;
  }
  return _screen;
}

/** ONLY call from unit tests. Pass null to restore the real electron screen. */
export function _setScreenForTesting(impl: ScreenImpl | null): void {
  _screen = impl;
}

/** ONLY call from unit tests. Pass null to restore the real implementation. */
export function _setIsPetWindowDraggingForTesting(fn: IsPetWindowDraggingFn | null): void {
  _isPetWindowDragging = fn;
}

/**
 * Liveness motion primitives (§13.6): animated absolute moves, continuous
 * cursor following with lag, and lightweight gravity/bounce physics. Operates
 * on any pet window through an accessor (windows can be recreated), one loop
 * per surface, paused while hidden or being dragged.
 */

export type WindowAccessor = () => BrowserWindow | null;

type MotionState = {
  follow: { lag: number } | null;
  physics: { gravity: boolean; bounce: number; vy: number } | null;
  loop: NodeJS.Timeout | null;
  moveGeneration: number;
};

const motionStates = new Map<string, { accessor: WindowAccessor; state: MotionState }>();
const loopIntervalMs = 50;

function stateFor(petHandleId: string, accessor: WindowAccessor): MotionState {
  let entry = motionStates.get(petHandleId);
  if (!entry) {
    entry = { accessor, state: { follow: null, physics: null, loop: null, moveGeneration: 0 } };
    motionStates.set(petHandleId, entry);
  }
  entry.accessor = accessor;
  return entry.state;
}

function easeProgress(t: number, easing: string): number {
  if (easing === "linear") return t;
  if (easing === "ease-in") return t * t;
  if (easing === "ease-out") return 1 - (1 - t) * (1 - t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
}

export async function motionMoveTo(petHandleId: string, accessor: WindowAccessor, target: Point, opts: { durationMs?: number; easing?: string } = {}): Promise<void> {
  const state = stateFor(petHandleId, accessor);
  const window = accessor();
  if (!window || window.isDestroyed()) return;
  const generation = ++state.moveGeneration;
  const durationMs = Math.min(Math.max(opts.durationMs ?? 700, 100), 10_000);
  const easing = opts.easing ?? "ease-in-out";
  const [startX, startY] = window.getPosition();
  const clamped = clampPosition(petHandleId, target);
  const steps = Math.max(4, Math.round(durationMs / 33));
  for (let step = 1; step <= steps; step += 1) {
    const live = accessor();
    if (!live || live.isDestroyed() || state.moveGeneration !== generation || getIsPetWindowDragging()(live)) return;
    const t = easeProgress(step / steps, easing);
    live.setPosition(Math.round(startX + (clamped.x - startX) * t), Math.round(startY + (clamped.y - startY) * t), false);
    await delay(durationMs / steps);
  }
}

export function motionSetFollowCursor(petHandleId: string, accessor: WindowAccessor, opts: { enabled: boolean; lag?: number }): void {
  const state = stateFor(petHandleId, accessor);
  state.follow = opts.enabled ? { lag: Math.min(Math.max(opts.lag ?? 0.85, 0), 1) } : null;
  syncLoop(petHandleId, accessor, state);
}

export function motionSetPhysics(petHandleId: string, accessor: WindowAccessor, opts: { gravity?: boolean; bounce?: number }): void {
  const state = stateFor(petHandleId, accessor);
  state.physics = opts.gravity ? { gravity: true, bounce: Math.min(Math.max(opts.bounce ?? 0.4, 0), 1), vy: 0 } : null;
  syncLoop(petHandleId, accessor, state);
}

export function motionStop(petHandleId: string): void {
  const entry = motionStates.get(petHandleId);
  if (!entry) return;
  entry.state.follow = null;
  entry.state.physics = null;
  entry.state.moveGeneration += 1;
  if (entry.state.loop) { clearInterval(entry.state.loop); entry.state.loop = null; }
}

export function motionStopAll(): void {
  for (const petHandleId of motionStates.keys()) motionStop(petHandleId);
}

function syncLoop(petHandleId: string, accessor: WindowAccessor, state: MotionState): void {
  const wantsLoop = state.follow !== null || state.physics !== null;
  if (!wantsLoop && state.loop) { clearInterval(state.loop); state.loop = null; return; }
  if (!wantsLoop || state.loop) return;
  state.loop = setInterval(() => {
    const window = accessor();
    if (!window || window.isDestroyed()) { motionStop(petHandleId); return; }
    if (!window.isVisible() || getIsPetWindowDragging()(window)) return;
    const [x, y] = window.getPosition();
    let nextX = x;
    let nextY = y;
    if (state.follow) {
      const cursor = getScreen().getCursorScreenPoint();
      // Aim the pet's bottom-center near the cursor; lag controls smoothing.
      const targetX = cursor.x - Math.round(defaultPetWindowSize.width / 2);
      const targetY = cursor.y - Math.round(defaultPetWindowSize.height * 0.7);
      const smoothing = 1 - state.follow.lag;
      nextX = Math.round(x + (targetX - x) * Math.max(0.02, smoothing * 0.35));
      nextY = Math.round(y + (targetY - y) * Math.max(0.02, smoothing * 0.35));
    }
    if (state.physics?.gravity) {
      const display = getScreen().getDisplayNearestPoint({ x: x + Math.round(defaultPetWindowSize.width / 2), y: y + Math.round(defaultPetWindowSize.height / 2) });
      const confinementBounds = getEffectiveConfinementBounds(petHandleId);
      const floor = computeGravityFloor(confinementBounds, display.workArea.y, display.workArea.height, defaultPetWindowSize.height);
      state.physics.vy = Math.min(state.physics.vy + 2.2, 48);
      nextY = y + Math.round(state.physics.vy);
      if (nextY >= floor) {
        nextY = floor;
        if (Math.abs(state.physics.vy) > 6 && state.physics.bounce > 0) state.physics.vy = -state.physics.vy * state.physics.bounce;
        else state.physics.vy = 0;
      }
    }
    if (nextX !== x || nextY !== y) {
      const clamped = clampPosition(petHandleId, { x: nextX, y: nextY });
      window.setPosition(clamped.x, clamped.y, false);
    }
  }, loopIntervalMs);
  state.loop.unref?.();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clamp a position to the appropriate bounds:
 * - If the pet has active terminal confinement, clamp to terminal bounds.
 * - Otherwise clamp to visible work area (free-roam).
 */
function clampPosition(petHandleId: string, pos: Point): Point {
  const terminalBounds = getEffectiveConfinementBounds(petHandleId);
  if (terminalBounds) return clampToTerminalBounds(pos, defaultPetWindowSize, terminalBounds);
  if (isCrossDisplayRoamingEnabled()) return clampToNearestDisplayIfOffscreen(pos, defaultPetWindowSize);
  return clampToVisibleWorkArea(pos, defaultPetWindowSize);
}

/** Exported for unit testing only — do not call from production code. */
export function _clampPositionForTesting(petHandleId: string, pos: Point): Point {
  return clampPosition(petHandleId, pos);
}

/**
 * Compute the gravity floor y-coordinate for a pet.
 *
 * When the pet is confined to a terminal window (confinementBounds != null), the
 * floor is the bottom interior edge of that terminal (terminal.y + terminal.height
 * - petHeight).  When unconfined the floor falls back to the display work-area
 * bottom (workAreaY + workAreaHeight - petHeight).
 *
 * Exported for unit testing.
 */
export function computeGravityFloor(
  confinementBounds: { y: number; height: number } | null,
  workAreaY: number,
  workAreaHeight: number,
  petHeight: number,
): number {
  if (confinementBounds) {
    return confinementBounds.y + confinementBounds.height - petHeight;
  }
  return workAreaY + workAreaHeight - petHeight;
}
