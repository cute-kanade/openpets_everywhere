import { BrowserWindow } from "electron";

import { getAppStateSnapshot } from "./app-state.js";
import { defaultPetWindowSize, getDefaultPetInitialPosition } from "./display.js";
import { debug, info } from "./logger.js";
import { transientDisplayMs, type OpenPetsReaction } from "./local-ipc-protocol.js";
import { clearTransientReaction, createAgentPetWindow, getTransientDisplayDurationMs, getTransientReactionAnimationMs, loadExplicitPetContent, mergePetTransientDisplay, setPetReactionState, type PetStatusBadgeReaction, type PetTransientDisplay } from "./pet-window.js";

const agentPetWindows = new Map<string, BrowserWindow>();
const transientDisplays = new Map<string, PetTransientDisplay>();
const statusBadges = new Map<string, PetStatusBadgeReaction>();
const transientTimers = new Map<string, NodeJS.Timeout>();
const transientAnimationTimers = new Map<string, NodeJS.Timeout>();
const statusBadgeTimers = new Map<string, NodeJS.Timeout>();
const dismissedAgentPets = new Set<string>();
const busyStatusBadgeMs = 120_000;

export function showAgentPet(petId: string): boolean {
  if (dismissedAgentPets.has(petId)) {
    info("pet.agent", "show skipped", { petId, reason: "dismissed", activeWindows: agentPetWindows.size });
    return false;
  }
  const window = getOrCreateAgentPetWindow(petId);
  info("pet.agent", "show requested", { petId, windowId: window.id, visible: window.isVisible(), minimized: window.isMinimized(), activeWindows: agentPetWindows.size });
  if (window.isMinimized()) window.restore();
  window.showInactive();
  return true;
}

export function closeAgentPetIfOpen(petId: string): void {
  const window = agentPetWindows.get(petId);
  if (!window || window.isDestroyed()) {
    debug("pet.agent", "close skipped", { petId, reason: "no-window", activeWindows: agentPetWindows.size });
    return;
  }
  info("pet.agent", "close requested", { petId, windowId: window.id, activeWindows: agentPetWindows.size });
  agentPetWindows.delete(petId);
  clearAgentDisplay(petId);
  window.destroy();
}

export function dismissAgentPetForActiveLease(petId: string): void {
  info("pet.agent", "dismiss requested", { petId });
  dismissedAgentPets.add(petId);
  closeAgentPetIfOpen(petId);
}

export function clearAgentPetDismissal(petId: string): void {
  debug("pet.agent", "dismissal cleared", { petId, wasDismissed: dismissedAgentPets.has(petId) });
  dismissedAgentPets.delete(petId);
}

export function clearAgentPetLeaseState(petId: string): void {
  info("pet.agent", "lease state cleared", { petId, hadWindow: agentPetWindows.has(petId), wasDismissed: dismissedAgentPets.has(petId) });
  dismissedAgentPets.delete(petId);
  closeAgentPetIfOpen(petId);
  clearAgentDisplay(petId);
}

export function applyAgentPetReaction(petId: string, reaction: OpenPetsReaction): { readonly shown: boolean; readonly reason?: string } {
  debug("pet.agent", "reaction apply", { petId, reaction });
  setAgentDisplay(petId, { reaction });
  const shown = showAgentPet(petId);
  return shown ? { shown } : { shown, reason: "dismissed" };
}

export function applyAgentPetSay(petId: string, message: string, reaction?: OpenPetsReaction): { readonly shown: boolean; readonly reason?: string } {
  debug("pet.agent", "say apply", { petId, reaction, messageLength: message.length });
  if (!reaction) clearStatusBadge(petId);
  setAgentDisplay(petId, { message, reaction });
  const shown = showAgentPet(petId);
  return shown ? { shown } : { shown, reason: "dismissed" };
}

export function closeAllAgentPets(): void {
  info("pet.agent", "close all requested", { activeWindows: agentPetWindows.size });
  for (const petId of [...agentPetWindows.keys()]) {
    closeAgentPetIfOpen(petId);
  }
}

export function refreshAgentPetContent(): void {
  debug("pet.agent", "refresh all content", { activeWindows: agentPetWindows.size, petIds: [...agentPetWindows.keys()] });
  for (const [petId, window] of agentPetWindows.entries()) {
    if (!window.isDestroyed()) {
      void loadExplicitPetContent(window, petId, transientDisplays.get(petId) ?? null, statusBadges.get(petId) ?? null);
    }
  }
}

function getOrCreateAgentPetWindow(petId: string): BrowserWindow {
  const existing = agentPetWindows.get(petId);
  if (existing && !existing.isDestroyed()) {
    debug("pet.agent", "reuse existing window", { petId, windowId: existing.id, activeWindows: agentPetWindows.size });
    return existing;
  }

  const pet = getAppStateSnapshot().pets.installed.find((candidate) => candidate.id === petId);
  if (!pet) throw new Error(`Installed pet is unavailable: ${petId}`);
  const offset = agentPetWindows.size + 1;
  const initial = getDefaultPetInitialPosition(defaultPetWindowSize);
  const window = createAgentPetWindow({
    petId,
    displayName: pet.displayName,
    position: { x: initial.x - offset * 36, y: initial.y - offset * 24 },
    display: transientDisplays.get(petId) ?? null,
    badge: statusBadges.get(petId) ?? null,
    onCloseRequested: () => dismissAgentPetForActiveLease(petId),
  });

  window.on("closed", () => {
    info("pet.agent", "closed", { petId, windowId: window.id, activeWindowsBeforeDelete: agentPetWindows.size });
    agentPetWindows.delete(petId);
    clearAgentDisplay(petId);
  });
  agentPetWindows.set(petId, window);
  info("pet.agent", "created", { petId, windowId: window.id, offset, activeWindows: agentPetWindows.size, position: { x: initial.x - offset * 36, y: initial.y - offset * 24 } });
  return window;
}

function setAgentDisplay(petId: string, display: PetTransientDisplay): void {
  debug("pet.agent", "display set", { petId, reaction: display.reaction, hasMessage: Boolean(display.message), hasReactionMessage: Boolean(display.reactionMessage) });
  const preparedDisplay = mergePetTransientDisplay(transientDisplays.get(petId) ?? null, display);
  transientDisplays.set(petId, preparedDisplay);
  if (display.reaction) setStatusBadge(petId, display.reaction);
  const existingTimer = transientTimers.get(petId);
  if (existingTimer) clearTimeout(existingTimer);
  const existingAnimationTimer = transientAnimationTimers.get(petId);
  if (existingAnimationTimer) clearTimeout(existingAnimationTimer);

  const animationMs = getTransientReactionAnimationMs(preparedDisplay);
  const displayDurationMs = getTransientDisplayDurationMs(preparedDisplay);
  if (animationMs !== null && animationMs < displayDurationMs) {
    const animationTimer = setTimeout(() => {
      const current = transientDisplays.get(petId);
      if (!current) return;
      const updated = clearTransientReaction(current);
      transientDisplays.set(petId, updated);
      transientAnimationTimers.delete(petId);
      const window = agentPetWindows.get(petId);
      if (window && !window.isDestroyed()) setPetReactionState(window, "idle");
    }, animationMs);
    transientAnimationTimers.set(petId, animationTimer);
  }

  const timer = setTimeout(() => {
    transientDisplays.delete(petId);
    transientTimers.delete(petId);
    const animationTimer = transientAnimationTimers.get(petId);
    if (animationTimer) clearTimeout(animationTimer);
    transientAnimationTimers.delete(petId);
    const window = agentPetWindows.get(petId);
    if (window && !window.isDestroyed()) void loadExplicitPetContent(window, petId, null, statusBadges.get(petId) ?? null);
  }, displayDurationMs);
  transientTimers.set(petId, timer);
  const window = agentPetWindows.get(petId);
  if (window && !window.isDestroyed()) void loadExplicitPetContent(window, petId, preparedDisplay, statusBadges.get(petId) ?? null);
}

function clearAgentDisplay(petId: string): void {
  debug("pet.agent", "display cleared", { petId, hadDisplay: transientDisplays.has(petId), hadBadge: statusBadges.has(petId) });
  const timer = transientTimers.get(petId);
  if (timer) clearTimeout(timer);
  const animationTimer = transientAnimationTimers.get(petId);
  if (animationTimer) clearTimeout(animationTimer);
  transientTimers.delete(petId);
  transientAnimationTimers.delete(petId);
  const badgeTimer = statusBadgeTimers.get(petId);
  if (badgeTimer) clearTimeout(badgeTimer);
  statusBadgeTimers.delete(petId);
  transientDisplays.delete(petId);
  statusBadges.delete(petId);
}

function setStatusBadge(petId: string, reaction: OpenPetsReaction): void {
  if (reaction === "idle") {
    clearStatusBadge(petId);
    return;
  }

  statusBadges.set(petId, reaction);
  debug("pet.agent", "status badge set", { petId, reaction, durationMs: isBusyStatusBadgeReaction(reaction) ? busyStatusBadgeMs : transientDisplayMs });
  const existingTimer = statusBadgeTimers.get(petId);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    clearStatusBadge(petId);
    const window = agentPetWindows.get(petId);
    if (window && !window.isDestroyed()) void loadExplicitPetContent(window, petId, transientDisplays.get(petId) ?? null, null);
  }, isBusyStatusBadgeReaction(reaction) ? busyStatusBadgeMs : transientDisplayMs);
  statusBadgeTimers.set(petId, timer);
}

function clearStatusBadge(petId: string): void {
  if (statusBadges.has(petId)) debug("pet.agent", "status badge cleared", { petId, reaction: statusBadges.get(petId) });
  statusBadges.delete(petId);
  const timer = statusBadgeTimers.get(petId);
  if (timer) clearTimeout(timer);
  statusBadgeTimers.delete(petId);
}

function isBusyStatusBadgeReaction(reaction: OpenPetsReaction): boolean {
  return reaction === "thinking" || reaction === "working" || reaction === "editing" || reaction === "running" || reaction === "testing" || reaction === "waiting";
}
