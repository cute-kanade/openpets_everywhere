import { screen } from "electron";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export const defaultPetWindowSize: WindowSize = {
  width: 220,
  height: 320,
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
