/**
 * Window Tracker — macOS on-screen window enumeration and occlusion detection.
 *
 * Uses `get-windows` (wraps CGWindowListCopyWindowInfo) to enumerate visible
 * windows, walk PPID chains to locate the terminal emulator hosting an MCP
 * client, and determine whether that terminal is visible and unoccluded.
 *
 * Screen Recording permission is required for `get-windows` to return data;
 * when denied, get-windows throws (exit 1) and listWindows() returns [].
 * Raising/focusing a window requires Accessibility permission (Phase 4).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { debug, info, warn } from "./logger.js";
import { isWindowOccluded as _isWindowOccluded } from "./window-occlusion.js";
import { findTerminalPidInChain as _findTerminalPidInChain } from "./window-chain.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TrackedWindow {
  readonly id: number;
  readonly ownerPid: number;
  readonly ownerName: string;
  readonly bounds: WindowBounds;
}

export interface TerminalWindowInfo {
  /** The on-screen window hosting the terminal. null if minimized/off-screen. */
  readonly window: TrackedWindow | null;
  /** PID of the terminal emulator process. */
  readonly terminalPid: number;
  /** Human-readable app name (e.g. "Ghostty", "Terminal"). */
  readonly appName: string;
  /** True when the window is missing from screen (minimized, hidden, etc.). */
  readonly isMinimized: boolean;
  /** True when other windows fully cover the terminal. */
  readonly isOccluded: boolean;
}

// ---------------------------------------------------------------------------
// get-windows dynamic import
// Electron's ESM + CJS bridging requires a dynamic import for ESM-only packages.
// ---------------------------------------------------------------------------

let getWindowsModule: { openWindows: () => Promise<unknown[]> } | null = null;

async function openWindows(): Promise<TrackedWindow[]> {
  if (!getWindowsModule) {
    // Dynamic import — avoids bundler issues with ESM-only package.
    const mod = await import("get-windows");
    getWindowsModule = mod as { openWindows: () => Promise<unknown[]> };
  }
  const raw = await getWindowsModule.openWindows();
  return raw.flatMap((w): TrackedWindow[] => {
    if (!isGetWindowsEntry(w)) return [];
    return [{
      id: w.id,
      ownerPid: w.owner.processId,
      ownerName: w.owner.name,
      bounds: {
        x: w.bounds.x,
        y: w.bounds.y,
        width: w.bounds.width,
        height: w.bounds.height,
      },
    }];
  });
}

function isGetWindowsEntry(w: unknown): w is {
  id: number;
  owner: { processId: number; name: string };
  bounds: { x: number; y: number; width: number; height: number };
} {
  if (typeof w !== "object" || w === null) return false;
  const obj = w as Record<string, unknown>;
  if (typeof obj["id"] !== "number") return false;
  if (typeof obj["owner"] !== "object" || obj["owner"] === null) return false;
  const owner = obj["owner"] as Record<string, unknown>;
  if (typeof owner["processId"] !== "number") return false;
  if (typeof owner["name"] !== "string") return false;
  if (typeof obj["bounds"] !== "object" || obj["bounds"] === null) return false;
  const bounds = obj["bounds"] as Record<string, unknown>;
  return (
    typeof bounds["x"] === "number" &&
    typeof bounds["y"] === "number" &&
    typeof bounds["width"] === "number" &&
    typeof bounds["height"] === "number"
  );
}

// ---------------------------------------------------------------------------
// PPID walking
// ---------------------------------------------------------------------------

const ppidCache = new Map<number, number>();
const ppidCacheExpiry = new Map<number, number>();
const ppidCacheTtlMs = 10_000;

async function getParentPid(pid: number): Promise<number | null> {
  const now = Date.now();
  const expiry = ppidCacheExpiry.get(pid);
  if (expiry !== undefined && now < expiry) {
    return ppidCache.get(pid) ?? null;
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "ppid="]);
    const ppid = parseInt(stdout.trim(), 10);
    if (Number.isFinite(ppid) && ppid > 0) {
      ppidCache.set(pid, ppid);
      ppidCacheExpiry.set(pid, now + ppidCacheTtlMs);
      return ppid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Walk up the PPID chain from `clientPid` until we find a PID that owns a
 * window in `windows`. Returns { pid, appName } or null.
 * Implementation lives in window-chain.ts (pure, unit-testable).
 *
 * @param getParent  Injectable parent-PID lookup — defaults to the real
 *                   `getParentPid` so production callers are unaffected.
 */
export async function findTerminalPidInChain(
  clientPid: number,
  windows: TrackedWindow[],
  maxDepth = 10,
  getParent: (pid: number) => Promise<number | null> = getParentPid,
): Promise<{ pid: number; appName: string } | null> {
  return _findTerminalPidInChain(clientPid, windows, maxDepth, getParent);
}

// ---------------------------------------------------------------------------
// Occlusion detection (implementation lives in window-occlusion.ts)
// ---------------------------------------------------------------------------

/**
 * Returns true if `target` is substantially covered by a SINGLE foreground
 * window that appears in front of it (lower CGWindowList index = front).
 *
 * Rules:
 * - Only considers windows in front of `target` in z-order.
 * - Excludes windows owned by `ownProcessId` (e.g. OpenPets' own always-on-top
 *   pet window) so the pet overlay never falsely occludes its own terminal.
 * - A single occluder must cover ≥ 90% of the target area to trigger.
 *   Additive accumulation across separate windows is intentionally NOT used:
 *   two ~60% windows are NOT occluding; only one window ≥ 90% is.
 */
export function isWindowOccluded(
  target: TrackedWindow,
  allWindows: TrackedWindow[],
  ownProcessId: number,
): boolean {
  return _isWindowOccluded(target, allWindows, ownProcessId);
}

// ---------------------------------------------------------------------------
// Previous window state for minimized detection
// ---------------------------------------------------------------------------

const lastKnownWindows = new Map<number, TrackedWindow>();

function updateKnownWindows(windows: TrackedWindow[]): void {
  for (const w of windows) lastKnownWindows.set(w.id, w);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all on-screen (non-minimized) windows.
 * Returns an empty array if `get-windows` is unavailable or fails.
 */
export async function listWindows(): Promise<TrackedWindow[]> {
  if (process.platform !== "darwin") return [];
  try {
    const windows = await openWindows();
    updateKnownWindows(windows);
    return windows;
  } catch (error) {
    // get-windows can THROW (exit 1) when Screen Recording permission is denied.
    // Treat as empty enumeration — the confinement poller will check permission
    // status and surface a notification via its DI deps.
    info("window-tracker", "listWindows failed — likely Screen Recording permission denied", {
      error: String(error),
      windowCount: 0,
    });
    return [];
  }
}

/**
 * Given the PID of an MCP client process (e.g. opencode), walk up the PPID
 * chain to find the terminal emulator window hosting that client.
 *
 * @returns TerminalWindowInfo describing confinement state, or null if the
 *          terminal cannot be identified (Windows/Linux, or ps unavailable).
 */
export async function findTerminalWindowForPid(clientPid: number): Promise<TerminalWindowInfo | null> {
  if (process.platform !== "darwin" || clientPid <= 0) return null;

  try {
    const windows = await listWindows();
    const found = await findTerminalPidInChain(clientPid, windows);
    if (!found) {
      // Case (A): zero windows → likely a Screen Recording permission gap.
      // Case (B): windows present but no terminal ancestor in PPID chain.
      info("window-tracker", "no terminal found in ppid chain", {
        clientPid,
        windowCount: windows.length,
        // Phase 2 hook: permission-status check can inspect windowCount===0
      });
      return null;
    }

    const { pid: terminalPid, appName } = found;
    // All windows for this terminal PID (there may be several tabs/panes).
    const termWindows = windows.filter((w) => w.ownerPid === terminalPid);

    if (termWindows.length === 0) {
      // PID exists (we found it in PPID chain) but it has no on-screen window →
      // treat as minimized.
      return { window: null, terminalPid, appName, isMinimized: true, isOccluded: false };
    }

    // Use the largest terminal window as the confinement target.
    const target = termWindows.reduce((best, w) =>
      w.bounds.width * w.bounds.height > best.bounds.width * best.bounds.height ? w : best,
    );

    const occluded = isWindowOccluded(target, windows, process.pid);
    return { window: target, terminalPid, appName, isMinimized: false, isOccluded: occluded };
  } catch (error) {
    warn("window-tracker", "findTerminalWindowForPid failed", { clientPid, error: String(error) });
    return null;
  }
}

/**
 * Check whether the window with the given ownerPid is currently on-screen
 * (not minimized). Useful for quick re-checks without a full PPID walk.
 */
export async function isTerminalOnScreen(terminalPid: number): Promise<boolean> {
  if (process.platform !== "darwin" || terminalPid <= 0) return true; // assume visible on non-mac
  const windows = await listWindows();
  return windows.some((w) => w.ownerPid === terminalPid);
}

// ---------------------------------------------------------------------------
// Polling manager (singleton)
// ---------------------------------------------------------------------------

type PollerCallback = (info: TerminalWindowInfo) => void;
type PollerNullCallback = () => void;

const pollerSubscriptions = new Map<string, { clientPid: number; callback: PollerCallback; onNull?: PollerNullCallback }>();
let pollerTimer: NodeJS.Timeout | null = null;
const pollerIntervalMs = 500;

/**
 * Subscribe to window state updates for a given client PID.
 * - `callback` is called ~every 500ms when the terminal IS found.
 * - `onNull` (optional) is called when the terminal is NOT found on a tick,
 *   allowing callers to implement exponential backoff for the null-resolve case.
 * Returns an unsubscribe function.
 */
export function subscribeWindowTracking(
  subscriptionId: string,
  clientPid: number,
  callback: PollerCallback,
  onNull?: PollerNullCallback,
): () => void {
  pollerSubscriptions.set(subscriptionId, { clientPid, callback, onNull });
  startPollerIfNeeded();
  return () => {
    pollerSubscriptions.delete(subscriptionId);
    if (pollerSubscriptions.size === 0) stopPoller();
  };
}

async function pollAll(): Promise<void> {
  if (pollerSubscriptions.size === 0) { stopPoller(); return; }
  // Batch: one openWindows() call, share result across all subscriptions.
  let windows: TrackedWindow[];
  try {
    windows = await listWindows();
  } catch {
    return; // listWindows already logs; just skip this tick
  }

  for (const [, sub] of pollerSubscriptions) {
    try {
      const found = await findTerminalPidInChainCached(sub.clientPid, windows);
      if (!found) {
        sub.onNull?.();
        continue;
      }

      const termWindows = windows.filter((w) => w.ownerPid === found.pid);
      if (termWindows.length === 0) {
        sub.callback({ window: null, terminalPid: found.pid, appName: found.appName, isMinimized: true, isOccluded: false });
        continue;
      }
      const target = termWindows.reduce((best, w) =>
        w.bounds.width * w.bounds.height > best.bounds.width * best.bounds.height ? w : best,
      );
      const occluded = isWindowOccluded(target, windows, process.pid);
      sub.callback({ window: target, terminalPid: found.pid, appName: found.appName, isMinimized: false, isOccluded: occluded });
    } catch (error) {
      debug("window-tracker", "poll subscription error", { error: String(error) });
    }
  }
}

/** Like findTerminalPidInChain but reuses an already-fetched windows list. */
async function findTerminalPidInChainCached(
  clientPid: number,
  windows: TrackedWindow[],
): Promise<{ pid: number; appName: string } | null> {
  return _findTerminalPidInChain(clientPid, windows, 10, getParentPid);
}

function startPollerIfNeeded(): void {
  if (pollerTimer) return;
  pollerTimer = setInterval(() => { void pollAll(); }, pollerIntervalMs);
  pollerTimer.unref?.();
}

function stopPoller(): void {
  if (pollerTimer) { clearInterval(pollerTimer); pollerTimer = null; }
}
