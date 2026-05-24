import { randomBytes } from "node:crypto";
import net from "node:net";

import { applyAgentPetReaction, applyAgentPetSay, clearAgentPetLeaseState, showAgentPet } from "./agent-pet-controller.js";
import { getAppStateSnapshot, recordOpenPetsActivity } from "./app-state.js";
import { builtInPet } from "./built-in-pet.js";
import { applyExternalPetReaction, applyExternalPetSay, getDefaultPetPaused, isDefaultPetVisible } from "./default-pet-controller.js";
import { createStaleLeaseStatus, LeaseManager } from "./lease-manager.js";
import { debug, error as logError, info } from "./logger.js";
import { cleanupUnixSocket, getDiscoveryFilePath, getIpcEndpointConfig, parseIpcEndpoint, protectUnixSocket, removeDiscoveryFile, writeDiscoveryFile, type IpcEndpoint, type IpcEndpointConfig, type OpenPetsDiscoveryFile } from "./local-ipc-paths.js";
import { errorResponse, IpcProtocolError, isRecord, maxIpcMessageBytes, okResponse, parseIpcRequest, validateInstallPetId, validateOptionalLeaseId, validateReaction, validateRequestedPetId, validateSayMessage, type OpenPetsIpcRequest } from "./local-ipc-protocol.js";
import { installPet } from "./pet-installation.js";

let ipcServer: net.Server | null = null;
let ipcDiscovery: OpenPetsDiscoveryFile | null = null;
let leaseCleanupTimer: NodeJS.Timeout | null = null;
const leaseManager = new LeaseManager({
  resolveTarget: resolveLeaseTarget,
  getDefaultPetId: () => getCurrentDefaultPet().id,
  getPetDisplayName: (petId, targetKind) => targetKind === "default" ? getCurrentDefaultPet().displayName : getPetDisplayName(petId),
  onFirstExplicitLease: showAgentPet,
  onLastExplicitLease: handleLastExplicitLease,
  onLog: (level, message, fields) => level === "debug" ? debug("lease", message, fields) : info("lease", message, fields),
});

const safePetIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function startLocalIpcServer(): Promise<void> {
  if (ipcServer) {
    debug("ipc", "start skipped", { reason: "already-started" });
    return;
  }

  const endpointConfig = getIpcEndpointConfig();
  const token = randomBytes(32).toString("base64url");
  cleanupUnixSocket(endpointConfig.advertisedEndpoint);

  const server = net.createServer((socket) => handleSocket(socket, token, endpointConfig));
  server.on("error", (error) => {
    logError("ipc", "server error", error);
    console.error("OpenPets local IPC server error.", error);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    listenOnEndpoint(server, endpointConfig.bindEndpoint, () => {
      server.off("error", reject);
      protectUnixSocket(endpointConfig.advertisedEndpoint);
      resolve();
    });
  });

  ipcServer = server;
  const listeningEndpoint = getListeningEndpoint(server, endpointConfig);
  ipcDiscovery = writeDiscoveryFile(listeningEndpoint, token);
  leaseCleanupTimer = setInterval(() => leaseManager.cleanupExpired(), 5_000);
  leaseCleanupTimer.unref?.();
  info("ipc", "server started", { endpointKind: endpointConfig.bindEndpoint.kind, bindEndpoint: formatEndpoint(endpointConfig.bindEndpoint), advertisedEndpoint: listeningEndpoint, discoveryPath: getDiscoveryFilePath() });
  console.log(`OpenPets local IPC listening at ${listeningEndpoint}.`);
}

export function stopLocalIpcServer(): void {
  const server = ipcServer;
  const discovery = ipcDiscovery;
  ipcServer = null;
  ipcDiscovery = null;
  info("ipc", "server stopping", { hadServer: Boolean(server), discoveryPath: discovery ? getDiscoveryFilePath() : undefined, endpoint: discovery?.endpoint });
  if (leaseCleanupTimer) clearInterval(leaseCleanupTimer);
  leaseCleanupTimer = null;
  removeDiscoveryFile(discovery);

  if (server) {
    server.close();
  }

  if (discovery) {
    cleanupUnixSocket(discovery.endpoint);
  }
}

function handleSocket(socket: net.Socket, token: string, endpointConfig: IpcEndpointConfig): void {
  const bindEndpoint = endpointConfig.bindEndpoint;
  if (bindEndpoint.kind === "tcp" && !isAllowedRemoteAddress(socket.remoteAddress, bindEndpoint.host)) {
    info("ipc", "socket rejected", { reason: "unauthorized-remote", remoteAddress: socket.remoteAddress, bindHost: bindEndpoint.host });
    socket.destroy();
    return;
  }

  debug("ipc", "socket accepted", { endpointKind: bindEndpoint.kind, remoteAddress: socket.remoteAddress });

  socket.setEncoding("utf8");
  socket.setTimeout(3_000, () => socket.destroy());

  let buffer = "";
  let handled = false;

  socket.on("data", (chunk) => {
    if (handled) return;
    buffer += chunk;

    if (Buffer.byteLength(buffer, "utf8") > maxIpcMessageBytes) {
      handled = true;
      info("ipc", "request rejected", { reason: "too-large", bytes: Buffer.byteLength(buffer, "utf8") });
      writeResponse(socket, errorResponse(null, new IpcProtocolError("invalid_request", "IPC request is too large.")));
      return;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) return;

    handled = true;
    const raw = buffer.slice(0, newline);
    void handleRawRequest(raw, token).then((response) => writeResponse(socket, response));
  });

  socket.on("error", (error) => {
    if (isBenignSocketCloseError(error)) return;
    logError("ipc", "client socket error", error);
    console.error("OpenPets local IPC client socket error.", error);
  });
}

function listenOnEndpoint(server: net.Server, endpoint: IpcEndpoint, callback: () => void): void {
  if (endpoint.kind === "tcp") {
    server.listen({ host: endpoint.host, port: endpoint.port }, callback);
    return;
  }

  server.listen(endpoint.path, callback);
}

function getListeningEndpoint(server: net.Server, endpointConfig: IpcEndpointConfig): string {
  const bindEndpoint = endpointConfig.bindEndpoint;
  if (bindEndpoint.kind !== "tcp") return bindEndpoint.path;

  const address = server.address();
  const actualPort = (!address || typeof address === "string") ? bindEndpoint.port : address.port;

  // Use the advertised endpoint if it's different from bind endpoint
  const advertisedParsed = parseIpcEndpoint(endpointConfig.advertisedEndpoint, { allowPortZero: true, allowNonLoopback: true });
  if (advertisedParsed.kind === "tcp" && advertisedParsed.host !== bindEndpoint.host) {
    // Use advertised host with actual port (in case bind used port 0)
    return `tcp://${advertisedParsed.host}:${actualPort}`;
  }

  return `tcp://${bindEndpoint.host}:${actualPort}`;
}

function formatEndpoint(endpoint: IpcEndpoint): string {
  if (endpoint.kind === "tcp") return `tcp://${endpoint.host}:${endpoint.port}`;
  return endpoint.path;
}

function isAllowedRemoteAddress(address: string | undefined, bindHost: string): boolean {
  if (!address) return false;

  // Always allow loopback
  if (address === "::1" || isLoopbackAddress(address)) {
    return true;
  }

  // If binding to 0.0.0.0 or non-loopback, allow private/local addresses
  if (bindHost === "0.0.0.0" || bindHost !== "127.0.0.1") {
    return isPrivateOrLocalAddress(address);
  }

  return false;
}

function isLoopbackAddress(address: string): boolean {
  if (address.startsWith("::ffff:")) {
    address = address.slice(7);
  }

  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts[0] === 127 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

function isPrivateOrLocalAddress(address: string): boolean {
  // Handle IPv4-mapped IPv6 addresses
  if (address.startsWith("::ffff:")) {
    address = address.slice(7);
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;

  // Loopback: 127.0.0.0/8
  if (parts[0] === 127) return true;

  // Private: 10.0.0.0/8
  if (parts[0] === 10) return true;

  // Private: 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // Private: 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;

  // Link-local: 169.254.0.0/16
  if (parts[0] === 169 && parts[1] === 254) return true;

  return false;
}

async function handleRawRequest(raw: string, token: string) {
  let requestId: string | null = null;
  try {
    const request = parseIpcRequest(raw, token);
    requestId = request.id;
    debug("ipc", "request received", { requestId, method: request.method });
    return okResponse(request.id, await handleRequest(request));
  } catch (error) {
    logError("ipc", "request failed", error instanceof Error ? error : { requestId, error });
    return errorResponse(requestId, error);
  }
}

async function handleRequest(request: OpenPetsIpcRequest): Promise<unknown> {
  if (request.method === "hello") {
    return {
      ok: true,
      protocol: "openpets-ipc",
      protocolVersion: 1,
      appVersion: ipcDiscovery?.appVersion ?? "0.0.0",
    };
  }

  if (request.method === "status") {
    const params = isRecord(request.params) ? request.params : {};
    const leaseId = validateOptionalLeaseId(params.leaseId);
    if (leaseId) {
      const lease = leaseManager.get(leaseId);
      if (!lease) return createStaleLeaseStatus(leaseId);
      return { ok: true, appRunning: true, ...lease };
    }
    const state = getAppStateSnapshot();
    const defaultPet = state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId) ?? builtInPet;
    return {
      ok: true,
      appRunning: true,
      protocolVersion: 1,
      appVersion: ipcDiscovery?.appVersion ?? "0.0.0",
      defaultPet: {
        id: defaultPet.id,
        displayName: defaultPet.displayName,
        builtIn: defaultPet.builtIn,
        broken: "broken" in defaultPet && defaultPet.broken === true,
      },
      paused: getDefaultPetPaused(),
      defaultPetVisible: isDefaultPetVisible(),
      openDefaultPetOnLaunch: state.preferences.openDefaultPetOnLaunch,
      speechBubblesEnabled: state.preferences.speechBubblesEnabled,
    };
  }

  if (request.method === "pets.list") {
    const state = getAppStateSnapshot();
    return {
      ok: true,
      pets: state.pets.installed.map((pet) => ({
        id: pet.id,
        displayName: pet.displayName,
        builtIn: pet.builtIn,
        broken: pet.broken === true,
      })),
      defaultPetId: state.preferences.defaultPetId,
    };
  }

  if (request.method === "pets.install") {
    const params = isRecord(request.params) ? request.params : {};
    const petId = validateInstallPetId(params.petId);
    const state = await installPet(petId);
    const installed = state.pets.installed.find((pet) => pet.id === petId);
    if (!installed) throw new IpcProtocolError("install_failed", "Pet install did not complete.");
    return { ok: true, petId: installed.id, displayName: installed.displayName, installed: true };
  }

  if (request.method === "lease.acquire") {
    const params = isRecord(request.params) ? request.params : {};
    const requestedPetId = validateRequestedPetId(params.requestedPetId);
    debug("ipc", "lease acquire requested", { requestId: request.id, requestedPetId });
    return leaseManager.acquire(requestedPetId);
  }

  if (request.method === "lease.heartbeat") {
    const params = isRecord(request.params) ? request.params : {};
    const leaseId = validateRequiredLeaseId(params.leaseId);
    debug("ipc", "lease heartbeat requested", { requestId: request.id, leaseId });
    try {
      return leaseManager.heartbeat(leaseId);
    } catch {
      throw new IpcProtocolError("unknown_lease", "Unknown or expired lease.");
    }
  }

  if (request.method === "lease.release") {
    const params = isRecord(request.params) ? request.params : {};
    const leaseId = validateRequiredLeaseId(params.leaseId);
    debug("ipc", "lease release requested", { requestId: request.id, leaseId });
    return leaseManager.release(leaseId);
  }

  if (request.method === "pet.react") {
    const params = isRecord(request.params) ? request.params : {};
    const reaction = validateReaction(params.reaction);
    const lease = getLeaseTarget(params.leaseId);
    const petId = lease?.actualTargetPetId ?? getCurrentDefaultPet().id;
    debug("ipc", "pet react requested", { requestId: request.id, reaction, leaseId: lease?.leaseId, targetKind: lease?.targetKind, actualPetId: lease?.actualTargetPetId });
    if (lease?.targetKind === "explicit") {
      if (getDefaultPetPaused()) return { ok: true, reaction, shown: false, reason: "paused", leaseId: lease.leaseId };
      const applied = applyAgentPetReaction(lease.actualTargetPetId, reaction);
      safeRecordOpenPetsActivity({ kind: "react", reaction, petId });
      return { ok: true, reaction, shown: applied.shown, reason: applied.reason, leaseId: lease.leaseId };
    }
    const applied = applyExternalPetReaction(reaction);
    safeRecordOpenPetsActivity({ kind: "react", reaction, petId });
    return { ok: true, reaction, shown: applied.shown, reason: applied.reason };
  }

  const params = isRecord(request.params) ? request.params : {};
  const message = validateSayMessage(params.message);
  const reaction = params.reaction === undefined ? undefined : validateReaction(params.reaction);
  const lease = getLeaseTarget(params.leaseId);
  const petId = lease?.actualTargetPetId ?? getCurrentDefaultPet().id;
  debug("ipc", "pet say requested", { requestId: request.id, reaction, messageLength: message.length, leaseId: lease?.leaseId, targetKind: lease?.targetKind, actualPetId: lease?.actualTargetPetId });
  if (lease?.targetKind === "explicit") {
    if (getDefaultPetPaused()) return { ok: true, shown: false, reason: "paused", reaction, leaseId: lease.leaseId };
    const applied = applyAgentPetSay(lease.actualTargetPetId, message, reaction);
    safeRecordOpenPetsActivity({ kind: "say", reaction, petId });
    return { ok: true, shown: applied.shown, reason: applied.reason, reaction, leaseId: lease.leaseId };
  }
  const applied = applyExternalPetSay(message, reaction);
  safeRecordOpenPetsActivity({ kind: "say", reaction, petId });
  return { ok: true, shown: applied.shown, reason: applied.reason, reaction };
}

function safeRecordOpenPetsActivity(activity: Parameters<typeof recordOpenPetsActivity>[0]): void {
  try {
    recordOpenPetsActivity(activity);
  } catch (error) {
    debug("ipc", "activity record failed", { error: error instanceof Error ? error.message : String(error), kind: activity.kind, reaction: activity.reaction, petId: activity.petId });
  }
}

function validateRequiredLeaseId(value: unknown): string {
  const leaseId = validateOptionalLeaseId(value);
  if (!leaseId) throw new IpcProtocolError("invalid_params", "Lease id is required.");
  return leaseId;
}

function getLeaseTarget(value: unknown) {
  const leaseId = validateOptionalLeaseId(value);
  if (!leaseId) return null;
  const lease = leaseManager.get(leaseId);
  if (!lease) throw new IpcProtocolError("unknown_lease", "Unknown or expired lease.");
  return lease;
}

function handleLastExplicitLease(petId: string): void {
  info("ipc", "last explicit lease ended", { petId });
  clearAgentPetLeaseState(petId);
}

function writeResponse(socket: net.Socket, response: unknown): void {
  if (socket.destroyed || !socket.writable) return;
  socket.end(`${JSON.stringify(response)}\n`);
}

function isBenignSocketCloseError(error: NodeJS.ErrnoException): boolean {
  return error.code === "EPIPE" || error.code === "ECONNRESET" || error.code === "ERR_STREAM_DESTROYED";
}

function resolveLeaseTarget(requestedPetId: string | undefined): { readonly targetKind: "default" | "explicit"; readonly actualPetId: string; readonly fallbackReason?: "invalid_pet_id" | "pet_not_installed" | "pet_broken" | "default_broken_fallback_builtin" } {
  const defaultPet = getCurrentDefaultPetWithFallback();
  if (!requestedPetId || requestedPetId === builtInPet.id || requestedPetId === defaultPet.id) {
    return { targetKind: "default", actualPetId: defaultPet.id, fallbackReason: defaultPet.fallbackReason };
  }
  if (!safePetIdPattern.test(requestedPetId)) {
    return { targetKind: "default", actualPetId: defaultPet.id, fallbackReason: "invalid_pet_id" };
  }
  const pet = getAppStateSnapshot().pets.installed.find((candidate) => candidate.id === requestedPetId);
  if (!pet) return { targetKind: "default", actualPetId: defaultPet.id, fallbackReason: "pet_not_installed" };
  if (pet.broken) return { targetKind: "default", actualPetId: defaultPet.id, fallbackReason: "pet_broken" };
  return { targetKind: "explicit", actualPetId: pet.id };
}

function getCurrentDefaultPet(): { readonly id: string; readonly displayName: string } {
  const pet = getCurrentDefaultPetWithFallback();
  return { id: pet.id, displayName: pet.displayName };
}

function getCurrentDefaultPetWithFallback(): { readonly id: string; readonly displayName: string; readonly fallbackReason?: "default_broken_fallback_builtin" } {
  const state = getAppStateSnapshot();
  const configuredDefault = state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId);
  if (configuredDefault && !configuredDefault.broken) return configuredDefault;
  return { ...builtInPet, fallbackReason: "default_broken_fallback_builtin" };
}

function getPetDisplayName(petId: string): string {
  return getAppStateSnapshot().pets.installed.find((pet) => pet.id === petId)?.displayName ?? petId;
}
