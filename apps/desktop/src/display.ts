import { screen } from "electron";

import { deriveDisplayKey } from "./app-state-core.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Derive a stable string key for a display from its bounds.
 * Display IDs can change across reboots on some platforms, so we key on
 * physical geometry instead: `"${x},${y},${width}x${height}"`.
 */
export function getDisplayKey(bounds: Electron.Rectangle): string {
  return deriveDisplayKey(bounds);
}

/**
 * Return the display key for the display that the centre of a window position
 * falls on (using Electron's nearest-point logic).
 */
export function getDisplayKeyForPosition(position: Point, size: WindowSize = defaultPetWindowSize): string {
  const centre = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
  const display = screen.getDisplayNearestPoint(centre);
  return getDisplayKey(display.bounds);
}

/**
 * Return display keys for all currently connected displays, mapped to their
 * work-area rectangles so callers can choose a position on a given display.
 */
export function getAllDisplayKeys(): string[] {
  return screen.getAllDisplays().map((d) => getDisplayKey(d.bounds));
}

export const defaultPetWindowSize: WindowSize = {
  width: 340,
  height: 420,
};

export const defaultPetWindowMargin = 24;

export function getDefaultPetInitialPosition(size: WindowSize = defaultPetWindowSize): Point {
  const { workArea } = screen.getPrimaryDisplay();

  return {
    x: Math.round(workArea.x + workArea.width - size.width - defaultPetWindowMargin),
    y: Math.round(workArea.y + workArea.height - size.height - defaultPetWindowMargin),
  };
}

export function clampToVisibleWorkArea(position: Point, size: WindowSize = defaultPetWindowSize): Point {
  // Clamp to the display the pet currently lives on (the one nearest its centre),
  // not the primary display — otherwise a pet on an external monitor gets yanked
  // back to the built-in screen whenever its position is read, saved, or restored.
  const centre = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
  const { workArea } = screen.getDisplayNearestPoint(centre);
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);

  return {
    x: clamp(Math.round(position.x), minX, maxX),
    y: clamp(Math.round(position.y), minY, maxY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
