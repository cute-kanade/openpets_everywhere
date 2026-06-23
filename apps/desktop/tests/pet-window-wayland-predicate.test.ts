import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── inline re-implementation of the predicate logic for unit testing ────────
// (mirrors the new isEffectiveWaylandBackend logic without Electron import)

function isEffectiveWaylandBackendFn(
  platform: string,
  ozoneSwitch: string,
  xdgSessionType: string | undefined,
  waylandDisplay: string | undefined,
): boolean {
  if (platform !== "linux") return false;
  if (ozoneSwitch === "wayland") return true;
  if (ozoneSwitch === "x11") return false;
  return xdgSessionType === "wayland" || Boolean(waylandDisplay);
}

function ozoneDecisionFn(
  platform: string,
  allowWayland: boolean,
  hasExplicitArg: boolean,
): { forceX11: boolean; appendSwitch: string | null } {
  if (platform === "linux" && !allowWayland) {
    return { forceX11: true, appendSwitch: "x11" };
  }
  return { forceX11: false, appendSwitch: null };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("isEffectiveWaylandBackend predicate", () => {
  it("returns false on non-Linux platforms", () => {
    assert.equal(isEffectiveWaylandBackendFn("darwin", "", "wayland", "/run/wayland-0"), false);
    assert.equal(isEffectiveWaylandBackendFn("win32", "", "wayland", "/run/wayland-0"), false);
  });

  it("returns true when ozone switch is explicitly wayland", () => {
    assert.equal(isEffectiveWaylandBackendFn("linux", "wayland", undefined, undefined), true);
    assert.equal(isEffectiveWaylandBackendFn("linux", "wayland", "x11", undefined), true);
  });

  it("returns false when ozone switch is explicitly x11", () => {
    assert.equal(isEffectiveWaylandBackendFn("linux", "x11", "wayland", "/run/wayland-0"), false);
  });

  it("falls back to XDG_SESSION_TYPE when ozone is auto/empty", () => {
    assert.equal(isEffectiveWaylandBackendFn("linux", "", "wayland", undefined), true);
    assert.equal(isEffectiveWaylandBackendFn("linux", "auto", "wayland", undefined), true);
    assert.equal(isEffectiveWaylandBackendFn("linux", "", "x11", undefined), false);
  });

  it("falls back to WAYLAND_DISPLAY when ozone is auto/empty and XDG_SESSION_TYPE absent", () => {
    assert.equal(isEffectiveWaylandBackendFn("linux", "", undefined, "/run/user/1000/wayland-0"), true);
    assert.equal(isEffectiveWaylandBackendFn("linux", "", undefined, undefined), false);
    assert.equal(isEffectiveWaylandBackendFn("linux", "", undefined, ""), false);
  });
});

describe("ozone forcing decision (main.ts logic)", () => {
  it("forces x11 on Linux without OPENPETS_ALLOW_WAYLAND", () => {
    const result = ozoneDecisionFn("linux", false, false);
    assert.equal(result.forceX11, true);
    assert.equal(result.appendSwitch, "x11");
  });

  it("forces x11 even when user passed explicit --ozone-platform=wayland without opt-out", () => {
    const result = ozoneDecisionFn("linux", false, true);
    assert.equal(result.forceX11, true);
    assert.equal(result.appendSwitch, "x11");
  });

  it("does not force x11 when OPENPETS_ALLOW_WAYLAND=1", () => {
    const result = ozoneDecisionFn("linux", true, false);
    assert.equal(result.forceX11, false);
    assert.equal(result.appendSwitch, null);
  });

  it("does not touch ozone on non-Linux platforms", () => {
    assert.equal(ozoneDecisionFn("darwin", false, false).forceX11, false);
    assert.equal(ozoneDecisionFn("win32", false, false).forceX11, false);
  });
});
