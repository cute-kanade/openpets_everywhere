import { randomUUID } from "node:crypto";

export type LeaseTargetKind = "default" | "explicit";
export type LeaseFallbackReason = "invalid_pet_id" | "pet_not_installed" | "pet_broken" | "default_broken_fallback_builtin";

export interface PetLease {
  readonly leaseId: string;
  readonly requestedPetId?: string;
  readonly targetKind: LeaseTargetKind;
  readonly actualPetId: string;
  readonly fallbackReason?: LeaseFallbackReason;
  readonly acquiredAt: number;
  readonly lastHeartbeatAt: number;
  readonly expiresAt: number;
  /** PID of the MCP client process (e.g. opencode) that acquired this lease. */
  readonly clientPid?: number;
  /** PID of the terminal emulator process hosting the client (resolved async). */
  readonly terminalOwnerPid?: number;
  /** Human-readable terminal app name, e.g. "Ghostty" or "Terminal". */
  readonly terminalAppName?: string;
  /** Numeric window ID from CGWindowList for the terminal window. */
  readonly terminalWindowId?: number;
}

export interface LeaseSnapshot {
  readonly leaseId: string;
  readonly requestedPetId?: string;
  readonly targetKind: LeaseTargetKind;
  readonly actualTargetPetId: string;
  readonly actualTargetPetName: string;
  readonly usingDefaultPet: boolean;
  readonly fallbackReason?: LeaseFallbackReason;
  readonly expiresAt: number;
  readonly leaseActive: boolean;
  /** PID of the MCP client that acquired this lease. */
  readonly clientPid?: number;
  /** PID of the terminal emulator hosting the client (may be set async). */
  readonly terminalOwnerPid?: number;
  /** Terminal app name, e.g. "Ghostty". */
  readonly terminalAppName?: string;
}

export interface LeaseManagerOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly resolveTarget?: (requestedPetId: string | undefined) => { readonly targetKind: LeaseTargetKind; readonly actualPetId: string; readonly fallbackReason?: LeaseFallbackReason };
  readonly getDefaultPetId?: () => string;
  readonly getPetDisplayName?: (petId: string, targetKind: LeaseTargetKind) => string;
  readonly onFirstExplicitLease?: (petId: string) => void;
  readonly onLastExplicitLease?: (petId: string) => void;
  readonly onLog?: (level: "debug" | "info", message: string, fields?: Record<string, unknown>) => void;
}

const safePetIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class LeaseManager {
  readonly #leases = new Map<string, PetLease>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #resolveTarget: (requestedPetId: string | undefined) => { readonly targetKind: LeaseTargetKind; readonly actualPetId: string; readonly fallbackReason?: LeaseFallbackReason };
  readonly #getDefaultPetId: () => string;
  readonly #getPetDisplayName: (petId: string, targetKind: LeaseTargetKind) => string;
  readonly #onFirstExplicitLease: (petId: string) => void;
  readonly #onLastExplicitLease: (petId: string) => void;
  readonly #onLog: (level: "debug" | "info", message: string, fields?: Record<string, unknown>) => void;

  constructor(options: LeaseManagerOptions = {}) {
    this.#ttlMs = options.ttlMs ?? 15_000;
    this.#now = options.now ?? Date.now;
    this.#resolveTarget = options.resolveTarget ?? (() => { throw new Error("Lease target resolver is not configured."); });
    this.#getDefaultPetId = options.getDefaultPetId ?? (() => { throw new Error("Default pet resolver is not configured."); });
    this.#getPetDisplayName = options.getPetDisplayName ?? ((petId) => petId);
    this.#onFirstExplicitLease = options.onFirstExplicitLease ?? (() => {});
    this.#onLastExplicitLease = options.onLastExplicitLease ?? (() => {});
    this.#onLog = options.onLog ?? (() => {});
  }

  acquire(requestedPetId?: string, clientPid?: number): LeaseSnapshot {
    const now = this.#now();
    // INVARIANT: resolveTarget (which may call resolvePoolAssignment) and the
    // Map.set below MUST remain synchronous with no await between them.
    // Two concurrent acquire(undefined) calls could otherwise be assigned the
    // same pool slot before either is registered.
    const target = this.#resolveTarget(requestedPetId);
    const lease: PetLease = {
      leaseId: randomUUID(),
      requestedPetId,
      targetKind: target.targetKind,
      actualPetId: target.actualPetId,
      fallbackReason: target.fallbackReason,
      acquiredAt: now,
      lastHeartbeatAt: now,
      expiresAt: now + this.#ttlMs,
      clientPid,
    };

    const hadExplicitLease = lease.targetKind === "explicit" && this.countExplicitLeases(lease.actualPetId) > 0;
    this.#leases.set(lease.leaseId, lease);
    this.#onLog("info", "acquired", { leaseId: lease.leaseId, requestedPetId, targetKind: lease.targetKind, actualPetId: lease.actualPetId, fallbackReason: lease.fallbackReason, clientPid, explicitLeaseCount: lease.targetKind === "explicit" ? this.countExplicitLeases(lease.actualPetId) : undefined, expiresAt: lease.expiresAt });
    if (lease.targetKind === "explicit" && !hadExplicitLease) this.#onFirstExplicitLease(lease.actualPetId);
    return this.snapshot(lease);
  }

  heartbeat(leaseId: string): { readonly leaseId: string; readonly expiresAt: number } {
    const lease = this.#leases.get(leaseId);
    if (!lease) throw new Error("unknown_lease");
    const now = this.#now();
    if (lease.expiresAt <= now) {
      this.#onLog("info", "heartbeat expired", { leaseId, actualPetId: lease.actualPetId, targetKind: lease.targetKind, expiresAt: lease.expiresAt, now });
      this.release(leaseId);
      throw new Error("unknown_lease");
    }
    const next: PetLease = { ...lease, lastHeartbeatAt: now, expiresAt: now + this.#ttlMs };
    this.#leases.set(leaseId, next);
    this.#onLog("debug", "heartbeat", { leaseId, targetKind: next.targetKind, actualPetId: next.actualPetId, expiresAt: next.expiresAt });
    return { leaseId, expiresAt: next.expiresAt };
  }

  release(leaseId: string): { readonly released: boolean } {
    const lease = this.#leases.get(leaseId);
    if (!lease) {
      this.#onLog("debug", "release skipped", { leaseId, reason: "unknown" });
      return { released: false };
    }
    this.#leases.delete(leaseId);
    this.#onLog("info", "released", { leaseId, targetKind: lease.targetKind, actualPetId: lease.actualPetId, remainingExplicitLeases: lease.targetKind === "explicit" ? this.countExplicitLeases(lease.actualPetId) : undefined });
    if (lease.targetKind === "explicit" && this.countExplicitLeases(lease.actualPetId) === 0) {
      this.#onLastExplicitLease(lease.actualPetId);
    }
    return { released: true };
  }

  get(leaseId: string): LeaseSnapshot | null {
    const lease = this.#leases.get(leaseId);
    if (lease && lease.expiresAt <= this.#now()) {
      this.release(leaseId);
      return null;
    }
    return lease ? this.snapshot(lease) : null;
  }

  cleanupExpired(): readonly LeaseSnapshot[] {
    const now = this.#now();
    const expired: LeaseSnapshot[] = [];
    for (const lease of [...this.#leases.values()]) {
      if (lease.expiresAt <= now) {
        expired.push(this.snapshot(lease));
        this.#onLog("info", "cleanup expired", { leaseId: lease.leaseId, targetKind: lease.targetKind, actualPetId: lease.actualPetId, expiresAt: lease.expiresAt, now });
        this.release(lease.leaseId);
      }
    }
    return expired;
  }

  countExplicitLeases(petId: string): number {
    let count = 0;
    for (const lease of this.#leases.values()) {
      if (lease.targetKind === "explicit" && lease.actualPetId === petId) count += 1;
    }
    return count;
  }

  /**
   * Update the terminal window identity on an existing lease.
   * Called asynchronously after the PPID-walk resolves.
   */
  setTerminalIdentity(leaseId: string, info: { terminalOwnerPid: number; terminalAppName: string; terminalWindowId?: number }): void {
    const lease = this.#leases.get(leaseId);
    if (!lease) return;
    const updated: PetLease = { ...lease, ...info };
    this.#leases.set(leaseId, updated);
    this.#onLog("debug", "terminal identity set", { leaseId, terminalOwnerPid: info.terminalOwnerPid, terminalAppName: info.terminalAppName, terminalWindowId: info.terminalWindowId });
  }

  /** Return all active leases that have a resolved terminal PID (for confinement polling). */
  getConfinedLeases(): ReadonlyArray<PetLease & { terminalOwnerPid: number }> {
    const result: Array<PetLease & { terminalOwnerPid: number }> = [];
    for (const lease of this.#leases.values()) {
      if (lease.terminalOwnerPid !== undefined) result.push(lease as PetLease & { terminalOwnerPid: number });
    }
    return result;
  }

  /** Get the raw PetLease for a lease ID (returns null if not found/expired). */
  getRawLease(leaseId: string): PetLease | null {
    return this.#leases.get(leaseId) ?? null;
  }

  snapshot(lease: PetLease): LeaseSnapshot {
    const defaultPetId = this.#getDefaultPetId();
    const actualPetId = lease.targetKind === "default" ? defaultPetId : lease.actualPetId;
    const targetKind = lease.targetKind;
    return {
      leaseId: lease.leaseId,
      requestedPetId: lease.requestedPetId,
      targetKind,
      actualTargetPetId: actualPetId,
      actualTargetPetName: this.#getPetDisplayName(actualPetId, targetKind),
      usingDefaultPet: targetKind === "default",
      fallbackReason: lease.fallbackReason,
      expiresAt: lease.expiresAt,
      leaseActive: true,
      clientPid: lease.clientPid,
      terminalOwnerPid: lease.terminalOwnerPid,
      terminalAppName: lease.terminalAppName,
    };
  }
}

export function createStaleLeaseStatus(leaseId: string): { readonly ok: false; readonly appRunning: true; readonly leaseId: string; readonly leaseActive: false; readonly staleReason: "unknown_lease" } {
  return { ok: false, appRunning: true, leaseId, leaseActive: false, staleReason: "unknown_lease" };
}
