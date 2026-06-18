/**
 * pet-pool.ts
 *
 * Pure logic for assigning pets from an ordered pool to new sessions.
 *
 * The pool is an ordered list of petIds configured by the user.
 * Each slot is "single-occupancy": a session that claims slot N gets its
 * own explicit lease and its own pet window (+ window confinement).
 *
 * Assignment strategy:
 *   1. Walk `orderedPool` in order; return the first petId that:
 *      - is in `eligiblePetIds` (installed, not broken, not built-in, not default)
 *      - has 0 active explicit leases (`countActiveExplicit(petId) === 0`)
 *   2. If no free slot exists, pick a random eligible pet preferring those
 *      with 0 active leases; if all occupied pick fully at random.
 *   3. Returns `null` when `orderedPool` is empty/undefined (legacy mode).
 */

import { assertSafePetId } from "./pet-paths.js";

export interface PoolAssignmentInput {
  /** Ordered list of pool slot pet IDs (may be empty or undefined). */
  readonly orderedPool: readonly string[] | undefined;
  /** Installed, non-broken, non-built-in, non-default pet IDs that can be assigned. */
  readonly eligiblePetIds: readonly string[];
  /** Returns the current active explicit-lease count for a given petId. */
  readonly countActiveExplicit: (petId: string) => number;
}

export interface PoolAssignmentResult {
  readonly petId: string;
}

/**
 * Resolve which pet from the pool to assign to an incoming session.
 * Returns `null` when the pool is disabled (unset / empty).
 *
 * INVARIANT: This function and the subsequent lease registration in
 * LeaseManager.acquire() MUST remain synchronous with no await between them.
 * Two concurrent acquire(undefined) calls could otherwise be assigned the same
 * pool slot.
 */
export function resolvePoolAssignment(input: PoolAssignmentInput): PoolAssignmentResult | null {
  const { orderedPool, eligiblePetIds, countActiveExplicit } = input;

  // Pool disabled — caller falls through to legacy default-pet logic.
  if (!orderedPool || orderedPool.length === 0) return null;
  if (eligiblePetIds.length === 0) return null;

  const eligibleSet = new Set(eligiblePetIds);

  // 1. Walk ordered pool — return first free slot that is eligible.
  for (const petId of orderedPool) {
    if (eligibleSet.has(petId) && countActiveExplicit(petId) === 0) {
      return { petId };
    }
  }

  // 2. Random fallback among ALL eligible pets (not just those in the ordered pool).
  //    When every ordered pool slot is already occupied, fall back to any eligible
  //    pet — this matches the user intent "anything after the selected is just random."
  //    Prefer pets with 0 active leases; if all are occupied pick fully at random.
  const freeEligible = eligiblePetIds.filter((id) => countActiveExplicit(id) === 0);
  const candidates = freeEligible.length > 0 ? freeEligible : [...eligiblePetIds];
  const petId = candidates[Math.floor(Math.random() * candidates.length)];
  return { petId: petId! };
}

/**
 * Build the list of eligible pet IDs from the app state snapshot.
 * Excludes the built-in pet, the current default pet, and any broken pets.
 * The default pet is excluded so it stays as the always-on singleton and is
 * never assigned to a pool session (prevents the same petId in two windows).
 */
export function getEligiblePoolPetIds(
  installedPets: ReadonlyArray<{ readonly id: string; readonly builtIn: boolean; readonly broken?: boolean }>,
  builtInPetId: string,
  defaultPetId: string,
): readonly string[] {
  return installedPets
    .filter((p) => p.id !== builtInPetId && p.id !== defaultPetId && !p.broken)
    .map((p) => p.id);
}

/**
 * Normalise `petPoolOrder`: trim entries, remove duplicates (keeping first
 * occurrence), blank entries, entries that fail the safe-pet-id check, and
 * cap total length at 64 slots.  Returns `undefined` when the result is empty
 * (preserves the legacy no-pool behaviour).
 */
export function normalizePetPoolOrder(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (result.length >= 64) break;
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id || seen.has(id)) continue;
    try {
      assertSafePetId(id);
    } catch {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result.length > 0 ? result : undefined;
}
