import { BrowserWindow, screen } from "electron";

import { clampToTerminalBounds, getEffectiveConfinementBounds } from "./confinement-manager.js";
import { clampToVisibleWorkArea, defaultPetWindowSize, type Point } from "./display.js";
import { isPetWindowDragging } from "./pet-window.js";

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
    if (!live || live.isDestroyed() || state.moveGeneration !== generation || isPetWindowDragging(live)) return;
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
    if (!window.isVisible() || isPetWindowDragging(window)) return;
    const [x, y] = window.getPosition();
    let nextX = x;
    let nextY = y;
    if (state.follow) {
      const cursor = screen.getCursorScreenPoint();
      // Aim the pet's bottom-center near the cursor; lag controls smoothing.
      const targetX = cursor.x - Math.round(defaultPetWindowSize.width / 2);
      const targetY = cursor.y - Math.round(defaultPetWindowSize.height * 0.7);
      const smoothing = 1 - state.follow.lag;
      nextX = Math.round(x + (targetX - x) * Math.max(0.02, smoothing * 0.35));
      nextY = Math.round(y + (targetY - y) * Math.max(0.02, smoothing * 0.35));
    }
    if (state.physics?.gravity) {
      const display = screen.getDisplayNearestPoint({ x: x + Math.round(defaultPetWindowSize.width / 2), y: y + Math.round(defaultPetWindowSize.height / 2) });
      const floor = display.workArea.y + display.workArea.height - defaultPetWindowSize.height;
      state.physics.vy = Math.min(state.physics.vy + 2.2, 48);
      nextY = y + Math.round(state.physics.vy);
      if (nextY >= floor) {
        nextY = floor;
        if (Math.abs(state.physics.vy) > 6 && state.physics.bounce > 0) state.physics.vy = -state.physics.vy * state.physics.bounce;
        else state.physics.vy = 0;
      }
    }
    if (nextX !== x || nextY !== y) {
      // Under gravity the y motion is bounded by the floor above; only clamp x.
      const clamped = clampPosition(petHandleId, { x: nextX, y: nextY });
      window.setPosition(clamped.x, state.physics?.gravity ? nextY : clamped.y, false);
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
  return clampToVisibleWorkArea(pos, defaultPetWindowSize);
}
