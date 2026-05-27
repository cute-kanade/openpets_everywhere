import { BrowserWindow, powerMonitor, screen } from "electron";

import { getAppStateSnapshot, getDefaultPetPosition, resetDefaultPetPosition, setDefaultPetPosition, updatePreferences } from "./app-state.js";
import { defaultPetWindowSize, getDefaultPetInitialPosition } from "./display.js";
import { debug, info } from "./logger.js";
import { transientDisplayMs, type OpenPetsReaction } from "./local-ipc-protocol.js";
import { clearTransientReaction, createDefaultPetWindow, getSafeDefaultPetPosition, getTransientDisplayDurationMs, getTransientReactionAnimationMs, isPetWindowDragging, loadDefaultPetContent, mergePetTransientDisplay, readWindowPosition, recoverPetMouseInterop, setPetReactionState, type PetStatusBadgeReaction, type PetTransientDisplay } from "./pet-window.js";

let defaultPetWindow: BrowserWindow | null = null;
let paused = false;
let transientDisplay: PetTransientDisplay | null = null;
let statusBadge: PetStatusBadgeReaction | null = null;
let transientDisplayTimeout: NodeJS.Timeout | null = null;
let transientAnimationTimeout: NodeJS.Timeout | null = null;
let statusBadgeTimeout: NodeJS.Timeout | null = null;
let displayGeneration = 0;
const busyStatusBadgeMs = 120_000;
const maxPluginMoveDistance = 160;
const minPluginMoveDurationMs = 250;
const maxPluginMoveDurationMs = 1_500;
let movementInProgress = false;

export type PetMoveOptions = { readonly x: number; readonly y: number; readonly durationMs?: number };
export type PetWanderOptions = { readonly distance?: number; readonly durationMs?: number };

export function showDefaultPet(): void {
  updatePreferences({ openDefaultPetOnLaunch: true });
  const window = getOrCreateDefaultPetWindow();
  info("pet.default", "show requested", { windowId: window.id, visible: window.isVisible(), minimized: window.isMinimized(), paused, petId: getAppStateSnapshot().preferences.defaultPetId });

  if (window.isMinimized()) {
    window.restore();
  }

  window.showInactive();
}

export function hideDefaultPet(): void {
  updatePreferences({ openDefaultPetOnLaunch: false });

  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "hide skipped", { reason: "no-window" });
    return;
  }

  info("pet.default", "hide requested", { windowId: defaultPetWindow.id, position: readWindowPosition(defaultPetWindow), petId: getAppStateSnapshot().preferences.defaultPetId });
  setDefaultPetPosition(readWindowPosition(defaultPetWindow));
  defaultPetWindow.hide();
}

export function isDefaultPetVisible(): boolean {
  return Boolean(defaultPetWindow && !defaultPetWindow.isDestroyed() && defaultPetWindow.isVisible());
}

export function setDefaultPetPaused(nextPaused: boolean): void {
  paused = nextPaused;
  info("pet.default", "pause changed", { paused });

  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    return;
  }

  void loadDefaultPetContent(defaultPetWindow, paused, transientDisplay, statusBadge, getCurrentDismissToken());
}

export function getDefaultPetPaused(): boolean {
  return paused;
}

export function refreshDefaultPetContent(): void {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "refresh skipped", { reason: "no-window" });
    return;
  }

  debug("pet.default", "refresh content", { windowId: defaultPetWindow.id, paused, hasDisplay: Boolean(transientDisplay), badge: statusBadge, petId: getAppStateSnapshot().preferences.defaultPetId });
  void loadDefaultPetContent(defaultPetWindow, paused, transientDisplay, statusBadge, getCurrentDismissToken());
}

export function recoverDefaultPetMouseInterop(reason: string): void {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "mouse interop recovery skipped", { reason, skippedReason: "no-window" });
    return;
  }

  debug("pet.default", "mouse interop recovery requested", { windowId: defaultPetWindow.id, reason, petId: getAppStateSnapshot().preferences.defaultPetId });
  recoverPetMouseInterop(defaultPetWindow, reason);
}

export function applyExternalPetReaction(reaction: OpenPetsReaction): { readonly shown: boolean; readonly reason?: string } {
  if (paused) {
    return { shown: false, reason: "paused" };
  }

  setTransientDisplay({ reaction });
  showDefaultPetForExternalEvent();
  return { shown: isDefaultPetVisible() };
}

export function applyExternalPetSay(message: string, reaction?: OpenPetsReaction): { readonly shown: boolean; readonly reason?: string } {
  if (paused) {
    return { shown: false, reason: "paused" };
  }

  if (!reaction) clearStatusBadge();
  setTransientDisplay({ message, reaction });
  showDefaultPetForExternalEvent();
  return { shown: isDefaultPetVisible() };
}

export function applyExternalPetMoveBy(options: PetMoveOptions): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  return moveDefaultPetBy(Number(options.x), Number(options.y), options.durationMs);
}

export function applyExternalPetWander(options: PetWanderOptions): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  const distance = clampNumber(Number(options.distance ?? 80), 0, maxPluginMoveDistance);
  const angle = Math.random() * Math.PI * 2;
  return moveDefaultPetBy(Math.cos(angle) * distance, Math.sin(angle) * distance, options.durationMs);
}

export function applyExternalPetMoveToHome(): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) return Promise.resolve({ moved: false, reason: "no-window" });
  const current = readWindowPosition(defaultPetWindow);
  const home = getSafeDefaultPetPosition(getDefaultPetInitialPosition(defaultPetWindowSize));
  return moveDefaultPetBy(home.x - current.x, home.y - current.y, maxPluginMoveDurationMs, Number.POSITIVE_INFINITY);
}

export function destroyDefaultPet(): void {
  clearDefaultPetDisplayTimers();

  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    debug("pet.default", "destroy skipped", { reason: "no-window" });
    defaultPetWindow = null;
    return;
  }

  info("pet.default", "destroy requested", { windowId: defaultPetWindow.id, position: readWindowPosition(defaultPetWindow), petId: getAppStateSnapshot().preferences.defaultPetId });
  setDefaultPetPosition(readWindowPosition(defaultPetWindow));
  const window = defaultPetWindow;
  defaultPetWindow = null;
  window.setIgnoreMouseEvents(false);
  window.destroy();
}

export function installDefaultPetDisplayHandlers(): void {
  screen.on("display-added", reclampDefaultPetWindow);
  screen.on("display-removed", reclampDefaultPetWindow);
  screen.on("display-metrics-changed", reclampDefaultPetWindow);
  powerMonitor.on("resume", recoverDefaultPetWindowAfterResume);
}

function handleBubbleDismissed(dismissToken: string): void {
  debug("pet.default", "bubble dismissed callback", { windowId: defaultPetWindow?.id, dismissToken, currentGeneration: displayGeneration });
  if (dismissToken !== String(displayGeneration)) {
    debug("pet.default", "bubble dismissed stale token", { dismissToken, currentGeneration: displayGeneration });
    return;
  }
  clearDefaultPetDisplayTimers();
  if (defaultPetWindow && !defaultPetWindow.isDestroyed()) {
    void loadDefaultPetContent(defaultPetWindow, paused, null, null);
  }
}

function getOrCreateDefaultPetWindow(): BrowserWindow {
  if (defaultPetWindow && !defaultPetWindow.isDestroyed()) {
    return defaultPetWindow;
  }

  const position = getSafeDefaultPetPosition(getDefaultPetPosition());

  defaultPetWindow = createDefaultPetWindow({
    position,
    paused,
    display: transientDisplay,
    badge: statusBadge,
    onPositionChanged: setDefaultPetPosition,
    onHideRequested: hideDefaultPet,
    onBubbleDismissed: handleBubbleDismissed,
  }, getCurrentDismissToken());
  const windowId = defaultPetWindow.id;
  info("pet.default", "created", { windowId, position, paused, petId: getAppStateSnapshot().preferences.defaultPetId });

  defaultPetWindow.on("closed", () => {
    info("pet.default", "closed", { windowId });
    defaultPetWindow = null;
  });

  return defaultPetWindow;
}

function setTransientDisplay(display: PetTransientDisplay): void {
  debug("pet.default", "transient display set", { reaction: display.reaction, hasMessage: Boolean(display.message), hasReactionMessage: Boolean(display.reactionMessage) });
  displayGeneration++;
  transientDisplay = mergePetTransientDisplay(transientDisplay, { ...display, dismissToken: String(displayGeneration) });
  if (display.reaction) setStatusBadge(display.reaction);

  if (transientDisplayTimeout) {
    clearTimeout(transientDisplayTimeout);
  }
  if (transientAnimationTimeout) {
    clearTimeout(transientAnimationTimeout);
    transientAnimationTimeout = null;
  }

  const animationMs = getTransientReactionAnimationMs(transientDisplay);
  const displayDurationMs = getTransientDisplayDurationMs(transientDisplay);
  if (animationMs !== null && animationMs < displayDurationMs) {
    transientAnimationTimeout = setTimeout(() => {
      if (!transientDisplay) return;
      transientDisplay = clearTransientReaction(transientDisplay);
      transientAnimationTimeout = null;
      if (defaultPetWindow && !defaultPetWindow.isDestroyed()) setPetReactionState(defaultPetWindow, "idle");
    }, animationMs);
  }

  transientDisplayTimeout = setTimeout(() => {
    transientDisplay = null;
    transientDisplayTimeout = null;
    if (transientAnimationTimeout) {
      clearTimeout(transientAnimationTimeout);
      transientAnimationTimeout = null;
    }
    refreshDefaultPetContent();
  }, displayDurationMs);

  refreshDefaultPetContent();
}

function showDefaultPetForExternalEvent(): void {
  const state = getAppStateSnapshot();
  if (isDefaultPetVisible() || state.preferences.openDefaultPetOnLaunch) {
    showDefaultPet();
  }
}

async function moveDefaultPetBy(rawX: number, rawY: number, rawDurationMs: unknown, maxDistance = maxPluginMoveDistance): Promise<{ readonly moved: boolean; readonly reason?: string }> {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) return { moved: false, reason: "no-window" };
  const window = defaultPetWindow;
  const blockedReason = getMovementBlockedReason(window);
  if (blockedReason) {
    debug("pet.default", "move skipped", { reason: blockedReason });
    return { moved: false, reason: blockedReason };
  }
  const current = readWindowPosition(window);
  const distance = Math.min(Math.hypot(rawX, rawY), maxDistance);
  if (!Number.isFinite(distance) || distance <= 0) return { moved: false, reason: "invalid-distance" };
  const scale = distance / Math.hypot(rawX, rawY);
  const target = getSafeDefaultPetPosition({ x: current.x + rawX * scale, y: current.y + rawY * scale });
  const durationMs = clampNumber(Number(rawDurationMs ?? 700), minPluginMoveDurationMs, maxPluginMoveDurationMs);
  const steps = Math.max(8, Math.min(16, Math.round(durationMs / 100)));
  movementInProgress = true;
  debug("pet.default", "move start", { windowId: window.id, from: current, target, durationMs, steps });
  try {
    for (let step = 1; step <= steps; step += 1) {
      if (window.isDestroyed()) return { moved: false, reason: "destroyed" };
      const blocked = getMovementBlockedReason(window, true);
      if (blocked) return { moved: false, reason: blocked };
      const t = step / steps;
      window.setPosition(Math.round(current.x + (target.x - current.x) * t), Math.round(current.y + (target.y - current.y) * t), false);
      await delay(durationMs / steps);
    }
    window.setPosition(target.x, target.y, false);
    setDefaultPetPosition(target);
    debug("pet.default", "move finished", { windowId: window.id, target });
    return { moved: true };
  } finally {
    movementInProgress = false;
  }
}

function getMovementBlockedReason(window: BrowserWindow, allowMoving = false): string | undefined {
  if (movementInProgress && !allowMoving) return "already-moving";
  if (!window.isVisible()) return "hidden";
  if (paused) return "paused";
  if (isPetWindowDragging(window)) return "dragging";
  if (transientDisplay) return "transient-display";
  if (statusBadge) return "status-active";
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatusBadge(reaction: OpenPetsReaction): void {
  if (reaction === "idle") {
    clearStatusBadge();
    return;
  }

  statusBadge = reaction;
  debug("pet.default", "status badge set", { reaction, durationMs: isBusyStatusBadgeReaction(reaction) ? busyStatusBadgeMs : transientDisplayMs });
  if (statusBadgeTimeout) clearTimeout(statusBadgeTimeout);
  statusBadgeTimeout = setTimeout(() => {
    clearStatusBadge();
    refreshDefaultPetContent();
  }, isBusyStatusBadgeReaction(reaction) ? busyStatusBadgeMs : transientDisplayMs);
}

function clearStatusBadge(): void {
  if (statusBadge) debug("pet.default", "status badge cleared", { reaction: statusBadge });
  statusBadge = null;
  if (statusBadgeTimeout) clearTimeout(statusBadgeTimeout);
  statusBadgeTimeout = null;
}

function clearDefaultPetDisplayTimers(): void {
  if (transientDisplayTimeout) clearTimeout(transientDisplayTimeout);
  if (transientAnimationTimeout) clearTimeout(transientAnimationTimeout);
  if (statusBadgeTimeout) clearTimeout(statusBadgeTimeout);
  transientDisplayTimeout = null;
  transientAnimationTimeout = null;
  statusBadgeTimeout = null;
  transientDisplay = null;
  statusBadge = null;
}

function getCurrentDismissToken(): string | undefined {
  return transientDisplay?.dismissToken ?? (statusBadge ? String(displayGeneration) : undefined);
}

function isBusyStatusBadgeReaction(reaction: OpenPetsReaction): boolean {
  return reaction === "thinking" || reaction === "working" || reaction === "editing" || reaction === "running" || reaction === "testing" || reaction === "waiting";
}

function reclampDefaultPetWindow(): void {
  if (!defaultPetWindow || defaultPetWindow.isDestroyed()) {
    return;
  }

  const safePosition = readWindowPosition(defaultPetWindow);
  info("pet.default", "reclamp position", { windowId: defaultPetWindow.id, position: safePosition });
  defaultPetWindow.setPosition(safePosition.x, safePosition.y, false);
  setDefaultPetPosition(safePosition);
  recoverDefaultPetMouseInterop("display-change");
}

function recoverDefaultPetWindowAfterResume(): void {
  recoverDefaultPetMouseInterop("power-resume");
  setTimeout(() => recoverDefaultPetMouseInterop("power-resume+500ms"), 500).unref?.();
}

export function shouldOpenDefaultPetOnLaunch(): boolean {
  return getAppStateSnapshot().preferences.openDefaultPetOnLaunch;
}

export function resetDefaultPetToInitialPosition(): void {
  const safePosition = getSafeDefaultPetPosition(getDefaultPetInitialPosition(defaultPetWindowSize));
  resetDefaultPetPosition(safePosition);

  if (defaultPetWindow && !defaultPetWindow.isDestroyed()) {
    defaultPetWindow.setPosition(safePosition.x, safePosition.y, false);
  }
}
