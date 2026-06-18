/**
 * Capabilities — Central probe for OS-level permissions and feature support.
 *
 * The window-confinement and terminal-focus features require specific macOS
 * permissions. This module provides a single place to query capability status
 * so the rest of the app can degrade gracefully.
 *
 * Graceful-degradation contract (from approved plan):
 * - Screen Recording: required for `get-windows` to enumerate windows. When
 *   denied, get-windows throws (exit 1) and confinement tracking falls back
 *   to free-roam. The confinement poller surfaces a one-time notification.
 * - Accessibility (AXRaise/focus): required only for "Focus session window"
 *   context-menu action. When absent, confinement tracking still works; only
 *   the focus button is degraded.
 * - Windows / Linux: confinement is a no-op (out of scope). Free-roam applies.
 */

import { systemPreferences } from "electron";

import { debug } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfinementCapabilities {
  /** Platform supports window-bounds tracking at all. */
  readonly supported: boolean;
  /** Whether window-bounds polling is available (no permission needed). */
  readonly trackingAvailable: boolean;
  /** Whether the focus-session-window action can work. */
  readonly focusActionAvailable: boolean;
  /** Reason focusActionAvailable is false, if any. */
  readonly focusUnavailableReason?: "not_macos" | "accessibility_denied";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe current capability status for the window-confinement feature.
 * This is synchronous — no side-effects, no permission prompts.
 */
export function probeConfinementCapabilities(): ConfinementCapabilities {
  if (process.platform !== "darwin") {
    debug("capabilities", "confinement unsupported — non-macOS");
    return {
      supported: false,
      trackingAvailable: false,
      focusActionAvailable: false,
      focusUnavailableReason: "not_macos",
    };
  }

  // Bounds + owner PID: always available on macOS (no permission needed).
  const trackingAvailable = true;

  // Accessibility: needed only for the focus-window action.
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);

  debug("capabilities", "confinement capabilities probed", {
    trackingAvailable,
    focusActionAvailable: trusted,
  });

  return {
    supported: true,
    trackingAvailable,
    focusActionAvailable: trusted,
    focusUnavailableReason: trusted ? undefined : "accessibility_denied",
  };
}

/**
 * Returns true if the window-confinement tracking system should be active.
 * Safe to call at any time; returns false on non-macOS.
 */
export function isConfinementSupported(): boolean {
  return process.platform === "darwin";
}

/**
 * Returns true if the "Focus session window" context-menu action can succeed
 * at this moment (Accessibility permission is currently granted).
 *
 * NOTE: The focus action itself handles the one-time Accessibility permission
 * prompt in terminal-focus.ts. This helper is for optional UI hints only.
 */
export function isFocusActionAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  return systemPreferences.isTrustedAccessibilityClient(false);
}
