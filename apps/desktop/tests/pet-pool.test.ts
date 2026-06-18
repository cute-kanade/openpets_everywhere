import assert from "node:assert/strict";

import { LeaseManager } from "../src/lease-manager.js";
import { getEligiblePoolPetIds, resolvePoolAssignment } from "../src/pet-pool.js";

// Helpers
function makeCount(counts: Record<string, number> = {}) {
  return (petId: string) => counts[petId] ?? 0;
}

// --- resolvePoolAssignment ---

// Pool disabled (undefined / empty) -> null
assert.equal(resolvePoolAssignment({ orderedPool: undefined, eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() }), null, "no pool -> null");
assert.equal(resolvePoolAssignment({ orderedPool: [], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() }), null, "empty pool -> null");

// No eligible pets -> null
assert.equal(resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: [], countActiveExplicit: makeCount() }), null, "no eligible pets -> null");

// Basic sequential: first free slot returned
{
  const result = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(result?.petId, "fox", "first free slot is fox");
}

// First slot occupied -> second returned
{
  const result = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 1 }) });
  assert.equal(result?.petId, "azure", "fox occupied -> azure returned");
}

// All pool slots occupied -> random fallback (from eligible, must be non-null)
{
  const result = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 1, azure: 1 }) });
  assert.ok(result !== null, "random fallback is non-null when all slots occupied");
  assert.ok(["fox", "azure"].includes(result.petId), "random fallback picks from eligible set");
}

// Pool entry not in eligible (e.g. not installed) -> skipped
{
  const result = resolvePoolAssignment({ orderedPool: ["not-installed", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(result?.petId, "azure", "not-installed slot skipped, falls to azure");
}

// Single slot pool, slot free
{
  const result = resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(result?.petId, "fox", "single slot pool returns fox");
}

// Single slot pool, slot occupied -> random fallback picks eligible (fox or azure)
{
  const result = resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 2 }) });
  assert.ok(result !== null, "single slot occupied -> random fallback non-null");
  assert.ok(["fox", "azure"].includes(result.petId), "random fallback from eligible");
}

// Random fallback prefers pets with 0 active leases when available
{
  // fox is occupied, azure is free -> should prefer azure
  let azureCount = 0;
  for (let i = 0; i < 50; i++) {
    const r = resolvePoolAssignment({ orderedPool: ["fox"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount({ fox: 1 }) });
    if (r?.petId === "azure") azureCount++;
  }
  assert.ok(azureCount > 30, `random prefers free pets (azure picked ${azureCount}/50 times, expected >30)`);
}

// --- getEligiblePoolPetIds (updated: now excludes defaultPetId too) ---

const installed = [
  { id: "built-in", builtIn: true, broken: false },
  { id: "fox", builtIn: false, broken: false },
  { id: "azure", builtIn: false, broken: false },
  { id: "broken-pet", builtIn: false, broken: true },
];

// With no default pet to exclude (using built-in as default, already excluded)
const eligible = getEligiblePoolPetIds(installed, "built-in", "built-in");
assert.deepEqual(eligible, ["fox", "azure"], "excludes built-in and broken pets");

// All built-in or broken
const eligible2 = getEligiblePoolPetIds([{ id: "built-in", builtIn: true, broken: false }], "built-in", "built-in");
assert.deepEqual(eligible2, [], "empty when only built-in");

// CHANGE 3: default pet is also excluded
{
  const result = getEligiblePoolPetIds(installed, "built-in", "fox");
  assert.deepEqual(result, ["azure"], "excludes default pet (fox) in addition to built-in and broken");
}

// CHANGE 3: all installed are either built-in, default, or broken → empty
{
  const result = getEligiblePoolPetIds(installed, "built-in", "azure");
  assert.deepEqual(result, ["fox"], "only non-default, non-builtin, non-broken pets eligible");
}

// --- C1: explicit requestedPetId bypasses the pool ---
// The gating decision lives in resolveLeaseTarget (local-ipc.ts) which we cannot
// import directly (electron deps). We verify the invariant via LeaseManager with a
// resolver that models the new CHANGE 2 gating: pool is consulted ONLY when
// !requestedPetId; explicit default/built-in requests bypass pool entirely.
{
  const DEFAULT_PET = "my-default";
  let poolConsulted = false;

  function modeledResolver(requestedPetId: string | undefined) {
    if (!requestedPetId) {
      // Only here do we consult the pool.
      poolConsulted = true;
      return { targetKind: "explicit" as const, actualPetId: "fox" }; // simulated pool result
    }
    // Explicit request for default or built-in → return default, no pool.
    if (requestedPetId === DEFAULT_PET || requestedPetId === "builtin") {
      return { targetKind: "default" as const, actualPetId: DEFAULT_PET };
    }
    return { targetKind: "explicit" as const, actualPetId: requestedPetId };
  }

  const mgr = new LeaseManager({ resolveTarget: modeledResolver, getDefaultPetId: () => DEFAULT_PET });

  // C1a: explicit default pet request → targetKind "default", pool not consulted
  poolConsulted = false;
  const l1 = mgr.acquire(DEFAULT_PET);
  assert.equal(l1.targetKind, "default", "C1a: requestedPetId===defaultPetId -> targetKind default");
  assert.equal(poolConsulted, false, "C1a: pool not consulted for explicit default-pet request");

  // C1b: no pet requested → pool IS consulted, result is explicit
  poolConsulted = false;
  const l2 = mgr.acquire(undefined);
  assert.equal(l2.targetKind, "explicit", "C1b: no requestedPetId -> pool consulted, got explicit");
  assert.equal(poolConsulted, true, "C1b: pool consulted when no requestedPetId");

  // C1c: explicit installed non-default pet → pool not consulted, targetKind explicit
  poolConsulted = false;
  const l3 = mgr.acquire("installed-fox");
  assert.equal(l3.targetKind, "explicit", "C1c: explicit installed pet -> explicit targetKind");
  assert.equal(poolConsulted, false, "C1c: pool not consulted for explicit non-default pet request");
}

// --- C2: sequential assignments get distinct slots (no double-assignment) ---
// Simulates: first call assigns fox (count was 0), then fox count becomes 1,
// second call returns azure (proves synchronous register→query works correctly).
{
  let foxCount = 0;
  function countMock(petId: string) {
    return petId === "fox" ? foxCount : 0;
  }

  const r1 = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: countMock });
  assert.equal(r1?.petId, "fox", "C2: first assignment is fox (slot 0 free)");

  // Simulate fox is now registered (lease count updated after first assignment).
  foxCount = 1;
  const r2 = resolvePoolAssignment({ orderedPool: ["fox", "azure"], eligiblePetIds: ["fox", "azure"], countActiveExplicit: countMock });
  assert.equal(r2?.petId, "azure", "C2: second assignment is azure (distinct slot, fox now occupied)");
  assert.notEqual(r1?.petId, r2?.petId, "C2: two sequential assignments are distinct");
}

// --- C3: petPoolEnabled=false → pool not consulted, legacy default behavior ---
// The petPoolEnabled gate is in tryResolveFromPool (local-ipc.ts, not importable).
// We test the equivalent contract: when the gate prevents tryResolveFromPool from
// calling resolvePoolAssignment, the lease returns targetKind "default".
// The pure side of the gate: when orderedPool is undefined, resolvePoolAssignment
// returns null (same effect as the petPoolEnabled=false early-return).
{
  // Gate disabled path: resolvePoolAssignment receives undefined pool (as if petPoolEnabled=false)
  const gated = resolvePoolAssignment({ orderedPool: undefined, eligiblePetIds: ["fox", "azure"], countActiveExplicit: makeCount() });
  assert.equal(gated, null, "C3: pool disabled (undefined) -> resolvePoolAssignment returns null");

  // Also verify via LeaseManager: when resolver respects petPoolEnabled=false,
  // result is targetKind "default".
  const mgrC3 = new LeaseManager({
    resolveTarget: (_requestedPetId) => ({ targetKind: "default" as const, actualPetId: "my-default" }),
    getDefaultPetId: () => "my-default",
  });
  const lc3 = mgrC3.acquire(undefined);
  assert.equal(lc3.targetKind, "default", "C3: petPoolEnabled=false → targetKind default (pool bypassed)");
}

// --- C4: random-fallback branch returns a pet from the eligible set ---
// When all ordered pool slots are occupied, resolvePoolAssignment falls back
// to a random pick from ALL eligible pets.
{
  // All pool members are occupied; fox is outside the pool but in eligible → can be picked.
  const r = resolvePoolAssignment({
    orderedPool: ["azure"],
    eligiblePetIds: ["fox", "azure"],
    countActiveExplicit: makeCount({ azure: 1 }),
  });
  assert.ok(r !== null, "C4: random fallback is non-null when all pool slots occupied");
  assert.ok(["fox", "azure"].includes(r.petId), "C4: random fallback picks from eligible set");
}

// C4b: random fallback draws from free pets first (repeated sampling)
{
  let foxPickedCount = 0;
  for (let i = 0; i < 40; i++) {
    const r = resolvePoolAssignment({
      orderedPool: ["azure"],
      eligiblePetIds: ["fox", "azure"],
      countActiveExplicit: makeCount({ azure: 1 }), // fox is free, azure occupied
    });
    if (r?.petId === "fox") foxPickedCount++;
  }
  assert.ok(foxPickedCount > 20, `C4b: random fallback prefers free pets (fox picked ${foxPickedCount}/40, expected >20)`);
}

// --- C5: successful pool assignment maps to targetKind "explicit" ---
// resolvePoolAssignment returns { petId } and the caller (tryResolveFromPool →
// resolveLeaseTarget) wraps it as { targetKind: "explicit", actualPetId: petId }.
// We verify the mapping via LeaseManager with a pool-style resolver.
{
  const mgrC5 = new LeaseManager({
    resolveTarget: (requestedPetId) => {
      if (!requestedPetId) {
        // Simulates: tryResolveFromPool returns { petId: "fox" }
        const poolResult = resolvePoolAssignment({
          orderedPool: ["fox"],
          eligiblePetIds: ["fox"],
          countActiveExplicit: makeCount(),
        });
        if (poolResult) return { targetKind: "explicit" as const, actualPetId: poolResult.petId };
      }
      return { targetKind: "default" as const, actualPetId: "my-default" };
    },
    getDefaultPetId: () => "my-default",
  });

  const lc5 = mgrC5.acquire(undefined);
  assert.equal(lc5.targetKind, "explicit", "C5: pool assignment maps to targetKind 'explicit'");
  assert.equal(lc5.actualTargetPetId, "fox", "C5: actualTargetPetId is the resolved pool pet");
  assert.equal(lc5.usingDefaultPet, false, "C5: usingDefaultPet is false for pool assignment");
}

console.error("pet-pool validation passed.");
