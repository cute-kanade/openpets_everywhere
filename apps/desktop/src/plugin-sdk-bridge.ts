import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import * as net from "node:net";
import { join } from "node:path";

import type { OpenPetsReaction } from "./local-ipc-protocol.js";
import { validateReaction, validateSayMessage } from "./local-ipc-protocol.js";
import type { PluginConfig } from "./plugin-config.js";
import type { OpenPetsJavascriptPluginManifest, PluginPermission } from "./plugin-manifest.js";
import type { PluginPetApi } from "./plugin-pet-api.js";
import type { PluginRuntimeScheduler, PluginTimerHandle } from "./plugin-runtime.js";
import type { PluginStateRecord, PluginStateStore } from "./plugin-state.js";

export type PluginCommandFormField = { id: string; type: "text" | "textarea" | "number"; label: string; default?: string | number; min?: number; max?: number; maxLength?: number; required?: boolean };
export type PluginCommandForm = { fields: readonly PluginCommandFormField[]; submitLabel?: string };
export type PluginCommand = { id: string; title: string; description?: string; form?: PluginCommandForm };
export type PluginStatus = { text: string; tone?: "info" | "success" | "warning" | "error" };
export type PluginRuntimePublicState = { commands: readonly PluginCommand[]; status?: PluginStatus };
export type PluginLogLevel = "debug" | "info" | "warn" | "error";
export type PluginRuntimeLogger = (level: PluginLogLevel, message: string, fields?: Record<string, unknown>) => void;
export type PluginSdkApi = ReturnType<PluginSdkBridge["createApi"]>;
export interface PluginStorageStore { get(pluginId: string, key: string): unknown; set(pluginId: string, key: string, value: unknown): void; delete(pluginId: string, key: string): void }

const quotas = { petActionsPerMinute: 60, schedules: 32, commands: 32, storageBytes: 64 * 1024, logsPerMinute: 200, httpPerMinute: 30, httpResponseBytes: 1024 * 1024 };
const commandIdPattern = /^[A-Za-z0-9._:-]{1,64}$/;
const scheduleIdPattern = /^[A-Za-z0-9._:-]{1,64}$/;

export class JsonPluginStorageStore implements PluginStorageStore {
  readonly #root: string;
  constructor(root: string) { this.#root = root; }
  get(pluginId: string, key: string): unknown { return this.#read(pluginId)[key]; }
  set(pluginId: string, key: string, value: unknown): void { const data = { ...this.#read(pluginId), [key]: value }; const text = JSON.stringify(data); if (Buffer.byteLength(text) > quotas.storageBytes) throw new Error("Plugin storage quota exceeded."); this.#write(pluginId, data); }
  delete(pluginId: string, key: string): void { const data = { ...this.#read(pluginId) }; delete data[key]; this.#write(pluginId, data); }
  #path(pluginId: string): string { return join(this.#root, `${pluginId}.json`); }
  #read(pluginId: string): Record<string, unknown> { try { const path = this.#path(pluginId); if (!existsSync(path)) return {}; const value = JSON.parse(readFileSync(path, "utf8")); return isRecord(value) ? value : {}; } catch { return {}; } }
  #write(pluginId: string, data: Record<string, unknown>): void { mkdirSync(this.#root, { recursive: true }); const path = this.#path(pluginId); const tmp = `${path}.${process.pid}.${Date.now()}.tmp`; writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8"); renameSync(tmp, path); }
}

export class MemoryPluginStorageStore implements PluginStorageStore {
  readonly #data = new Map<string, Record<string, unknown>>();
  get(pluginId: string, key: string): unknown { return this.#data.get(pluginId)?.[key]; }
  set(pluginId: string, key: string, value: unknown): void { const next = { ...(this.#data.get(pluginId) ?? {}), [key]: value }; if (Buffer.byteLength(JSON.stringify(next)) > quotas.storageBytes) throw new Error("Plugin storage quota exceeded."); this.#data.set(pluginId, next); }
  delete(pluginId: string, key: string): void { const next = { ...(this.#data.get(pluginId) ?? {}) }; delete next[key]; this.#data.set(pluginId, next); }
}

export class PluginSdkBridge {
  readonly #stateStore: PluginStateStore;
  readonly #petApi: PluginPetApi;
  readonly #scheduler: PluginRuntimeScheduler;
  readonly #storage: PluginStorageStore;
  readonly #onError: (id: string, reason: string) => void;
  readonly #logger: PluginRuntimeLogger;
  readonly #states = new Map<string, { commands: Map<string, { meta: PluginCommand; handler: (values?: Record<string, unknown>) => unknown | Promise<unknown> }>; status?: PluginStatus; schedules: Map<string, PluginTimerHandle>; configListeners: Set<(config: PluginConfig) => void>; petWindow: WindowCounter; logWindow: WindowCounter; httpWindow: WindowCounter }>();

  constructor(options: { stateStore: PluginStateStore; petApi: PluginPetApi; scheduler: PluginRuntimeScheduler; storage?: PluginStorageStore; onError?: (id: string, reason: string) => void; logger?: PluginRuntimeLogger }) {
    this.#stateStore = options.stateStore; this.#petApi = options.petApi; this.#scheduler = options.scheduler; this.#storage = options.storage ?? new MemoryPluginStorageStore(); this.#onError = options.onError ?? (() => undefined); this.#logger = options.logger ?? (() => undefined);
  }

  createApi(record: PluginStateRecord, manifest: OpenPetsJavascriptPluginManifest) {
    const approved = new Set(record.approvedPermissions); const state = this.#pluginState(record.id);
    const requirePermission = (permission: PluginPermission) => { if (!approved.has(permission)) throw new Error(`Plugin permission is not approved: ${permission}`); };
    const scheduleOnce = (id: string, delayMs: number, callback: () => unknown) => { validateSchedule(id, delayMs, 1); check(state.schedules.size < quotas.schedules || state.schedules.has(id), "Plugin schedule quota exceeded."); state.schedules.get(id)?.cancel(); state.schedules.set(id, this.#scheduler.setTimeout(() => runScheduled(record.id, callback).finally(() => state.schedules.delete(id)), delayMs)); };
    const scheduleEvery = (id: string, intervalMs: number, callback: () => unknown) => { validateSchedule(id, intervalMs, 10 * 60_000); check(state.schedules.size < quotas.schedules || state.schedules.has(id), "Plugin schedule quota exceeded."); state.schedules.get(id)?.cancel(); const run = () => { void runScheduled(record.id, callback).finally(() => { if (state.schedules.has(id)) state.schedules.set(id, this.#scheduler.setTimeout(run, intervalMs)); }); }; state.schedules.set(id, this.#scheduler.setTimeout(run, intervalMs)); };
    const runScheduled = async (id: string, callback: () => unknown) => { try { await callback(); } catch (error) { this.#onError(id, safeError(error)); } };
    const getConfig = () => ({ ...(this.#stateStore.getRecord(record.id)?.config ?? {}) }) as PluginConfig;
    return {
      pet: {
        speak: async (message: string) => { requirePermission("pet:speak"); state.petWindow.tick(quotas.petActionsPerMinute, "pet action"); await this.#petApi.speak(validateSayMessage(message)); },
        react: async (reaction: OpenPetsReaction) => { requirePermission("pet:reaction"); state.petWindow.tick(quotas.petActionsPerMinute, "pet action"); await this.#petApi.react(validateReaction(reaction)); },
        moveBy: async (options: unknown) => { requirePermission("pet:move"); state.petWindow.tick(quotas.petActionsPerMinute, "pet action"); await this.#petApi.moveBy(validateMoveBy(options)); },
        wander: async (options: unknown) => { requirePermission("pet:move"); state.petWindow.tick(quotas.petActionsPerMinute, "pet action"); await this.#petApi.wander(validateWander(options)); },
        moveToHome: async () => { requirePermission("pet:move"); state.petWindow.tick(quotas.petActionsPerMinute, "pet action"); await this.#petApi.moveToHome(); },
      },
      schedule: {
        once: (id: string, delayMs: number, callback: () => unknown) => { requirePermission("schedule"); scheduleOnce(String(id), Number(delayMs), callback); },
        every: (id: string, intervalMs: number, callback: () => unknown) => { requirePermission("schedule"); scheduleEvery(String(id), Number(intervalMs), callback); },
        daily: (id: string, spec: string | { time: string; days?: number[] }, callback: () => unknown) => { requirePermission("schedule"); const daily = parseDaily(spec); const run = () => { void runScheduled(record.id, callback).finally(() => { if (state.schedules.has(String(id))) state.schedules.set(String(id), this.#scheduler.setTimeout(run, msUntilDaily(daily))); }); }; validateSchedule(String(id), 10 * 60_000, 10 * 60_000); check(state.schedules.size < quotas.schedules || state.schedules.has(String(id)), "Plugin schedule quota exceeded."); state.schedules.get(String(id))?.cancel(); state.schedules.set(String(id), this.#scheduler.setTimeout(run, msUntilDaily(daily))); },
        cancel: (id: string) => { state.schedules.get(String(id))?.cancel(); state.schedules.delete(String(id)); },
        cancelAll: () => { for (const handle of state.schedules.values()) handle.cancel(); state.schedules.clear(); },
      },
      storage: {
        get: (key: string) => { requirePermission("storage"); return this.#storage.get(record.id, validateStorageKey(key)); },
        set: (key: string, value: unknown) => { requirePermission("storage"); this.#storage.set(record.id, validateStorageKey(key), value); },
        delete: (key: string) => { requirePermission("storage"); this.#storage.delete(record.id, validateStorageKey(key)); },
      },
      config: { get: getConfig, onChange: (listener: (config: PluginConfig) => void) => { state.configListeners.add(listener); return () => state.configListeners.delete(listener); } },
      commands: {
        register: (command: PluginCommand, handler: (values?: Record<string, unknown>) => unknown) => { requirePermission("commands"); const meta = validateCommand(command); check(state.commands.size < quotas.commands || state.commands.has(meta.id), "Plugin command quota exceeded."); state.commands.set(meta.id, { meta, handler }); },
        unregister: (id: string) => { state.commands.delete(String(id)); },
      },
      status: { set: (status: PluginStatus | string) => { requirePermission("status"); state.status = validateStatus(status); }, clear: () => { state.status = undefined; } },
      http: { fetch: async (url: string, options?: unknown) => { requirePermission("network"); state.httpWindow.tick(quotas.httpPerMinute, "HTTP"); return safeHttpFetch(String(url), options, allowedNetworkHosts(record, manifest)); } },
      log: Object.fromEntries((["debug", "info", "warn", "error"] as PluginLogLevel[]).map((level) => [level, (...args: unknown[]) => { state.logWindow.tick(quotas.logsPerMinute, "log"); this.#logger(level, "plugin log", { id: manifest.id, args }); }])) as Record<PluginLogLevel, (...args: unknown[]) => void>,
    };
  }

  getPublicState(id: string): PluginRuntimePublicState { const state = this.#pluginState(id); return { commands: [...state.commands.values()].map((entry) => entry.meta), status: state.status }; }
  async executeCommand(id: string, commandId: string, args?: Record<string, unknown>, timeoutMs = 5_000): Promise<void> { const command = this.#pluginState(id).commands.get(commandId); if (!command) throw new Error("Plugin command is not registered."); const values = command.meta.form ? validateCommandFormValues(command.meta.form, args) : undefined; await withTimeout(Promise.resolve().then(() => command.handler(values)), timeoutMs); }
  notifyConfigChanged(id: string): void { const state = this.#pluginState(id); const config = { ...(this.#stateStore.getRecord(id)?.config ?? {}) } as PluginConfig; for (const listener of state.configListeners) { try { listener(config); } catch (error) { this.#onError(id, safeError(error)); } } }
  clearPlugin(id: string): void { const state = this.#pluginState(id); for (const handle of state.schedules.values()) handle.cancel(); state.schedules.clear(); state.commands.clear(); state.status = undefined; state.configListeners.clear(); state.petWindow.reset(); state.logWindow.reset(); state.httpWindow.reset(); }
  #pluginState(id: string) { let state = this.#states.get(id); if (!state) { state = { commands: new Map(), schedules: new Map(), configListeners: new Set(), petWindow: new WindowCounter(), logWindow: new WindowCounter(), httpWindow: new WindowCounter() }; this.#states.set(id, state); } return state; }
}

type SimpleHttpResponse = { status: number; ok: boolean; headers: Record<string, string>; text: string; json?: unknown };
function allowedNetworkHosts(record: PluginStateRecord, manifest: OpenPetsJavascriptPluginManifest): Set<string> { const manifestHosts = new Set((manifest.network?.hosts ?? []).map((h) => h.toLowerCase())); const approved = record.approvedNetworkHosts?.map((h) => h.toLowerCase()) ?? []; return new Set(approved.filter((h) => manifestHosts.has(h))); }
async function safeHttpFetch(urlText: string, options: unknown, allowedHosts: Set<string>): Promise<SimpleHttpResponse> {
  const url = new URL(urlText); if (url.protocol !== "https:") throw new Error("Plugin HTTP fetch requires HTTPS."); if (url.username || url.password) throw new Error("Plugin HTTP fetch credentials are not allowed.");
  const host = url.hostname.toLowerCase(); if (!allowedHosts.has(host)) throw new Error("Plugin HTTP host is not approved."); await assertPublicHost(host);
  const opts = isRecord(options) ? options : {}; const method = String(opts.method ?? "GET").toUpperCase(); if (method !== "GET") throw new Error("Plugin HTTP fetch only supports GET.");
  const controller = new AbortController(); const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs ?? 10_000), 1_000), 30_000); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal, headers: safeHeaders(opts.headers) });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) throw new Error("Plugin HTTP redirects are not allowed.");
    const text = await readCapped(response, quotas.httpResponseBytes); const headers: Record<string, string> = {}; for (const key of ["content-type", "etag", "last-modified"]) { const value = response.headers.get(key); if (value) headers[key] = value; }
    let json: unknown; if ((headers["content-type"] ?? "").includes("application/json")) { try { json = JSON.parse(text); } catch { json = undefined; } }
    return { status: response.status, ok: response.ok, headers, text, ...(json === undefined ? {} : { json }) };
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error("Plugin HTTP fetch timed out."); throw error; } finally { clearTimeout(timeout); }
}
function safeHeaders(value: unknown): Record<string, string> { if (!isRecord(value)) return {}; const out: Record<string, string> = {}; for (const key of ["accept", "if-none-match", "if-modified-since", "user-agent"]) { const v = value[key] ?? value[key.replace(/(^|-)([a-z])/g, (_, p, c: string) => p + c.toUpperCase())]; if (typeof v === "string" && v.length <= 512) out[key] = v; } return out; }
async function readCapped(response: Response, cap: number): Promise<string> { const reader = response.body?.getReader(); if (!reader) return ""; const chunks: Uint8Array[] = []; let total = 0; for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > cap) throw new Error("Plugin HTTP response is too large."); chunks.push(value); } return Buffer.concat(chunks).toString("utf8"); }
async function assertPublicHost(host: string): Promise<void> { if (["localhost", "metadata.google.internal"].includes(host) || host.endsWith(".localhost")) throw new Error("Plugin HTTP host is not public."); const results = await lookup(host, { all: true, verbatim: true }); if (results.length === 0 || results.some((r) => isPrivateIp(r.address))) throw new Error("Plugin HTTP host resolves to a restricted address."); }
function isPrivateIp(address: string): boolean { if (net.isIPv4(address)) { const p = address.split(".").map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); } const v = address.toLowerCase(); return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168."); }

class WindowCounter { count = 0; started = Date.now(); tick(max: number, label: string): void { const now = Date.now(); if (now - this.started >= 60_000) this.reset(); this.count += 1; check(this.count <= max, `Plugin ${label} quota exceeded.`); } reset(): void { this.count = 0; this.started = Date.now(); } }
function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
function validateStorageKey(key: string): string { if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(key))) throw new Error("Invalid plugin storage key."); return String(key); }
function validateSchedule(id: string, delayMs: number, min: number): void { if (!scheduleIdPattern.test(id)) throw new Error("Invalid plugin schedule id."); if (!Number.isFinite(delayMs) || delayMs < min) throw new Error("Invalid plugin schedule delay."); }
function validateCommand(command: PluginCommand): PluginCommand { if (!command || !commandIdPattern.test(command.id)) throw new Error("Invalid plugin command id."); if (typeof command.title !== "string" || command.title.trim() === "" || command.title.length > 80) throw new Error("Invalid plugin command title."); if (command.description !== undefined && (typeof command.description !== "string" || command.description.length > 240)) throw new Error("Invalid plugin command description."); return { id: command.id, title: command.title, description: command.description, form: validateCommandForm(command.form) }; }
function validateCommandForm(form: unknown): PluginCommandForm | undefined { if (form === undefined) return undefined; if (!isRecord(form) || !Array.isArray(form.fields) || form.fields.length < 1 || form.fields.length > 8) throw new Error("Invalid plugin command form."); const seen = new Set<string>(); const fields = form.fields.map((field) => { if (!isRecord(field) || typeof field.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field.id) || seen.has(field.id)) throw new Error("Invalid plugin command form field id."); seen.add(field.id); if (!['text','textarea','number'].includes(String(field.type))) throw new Error("Invalid plugin command form field type."); if (typeof field.label !== "string" || field.label.trim() === "" || field.label.length > 80) throw new Error("Invalid plugin command form label."); const out: PluginCommandFormField = { id: field.id, type: field.type as PluginCommandFormField['type'], label: field.label, required: field.required === true || undefined }; if (out.type === "number") { if (field.default !== undefined && !Number.isFinite(Number(field.default))) throw new Error("Invalid plugin command form default."); if (field.min !== undefined && !Number.isFinite(Number(field.min))) throw new Error("Invalid plugin command form min."); if (field.max !== undefined && !Number.isFinite(Number(field.max))) throw new Error("Invalid plugin command form max."); if (field.min !== undefined) out.min = Number(field.min); if (field.max !== undefined) out.max = Number(field.max); if (out.min !== undefined && out.max !== undefined && out.min > out.max) throw new Error("Invalid plugin command form range."); if (field.default !== undefined) out.default = Number(field.default); } else { if (field.default !== undefined && typeof field.default !== "string") throw new Error("Invalid plugin command form default."); if (field.maxLength !== undefined && (!Number.isInteger(Number(field.maxLength)) || Number(field.maxLength) < 1 || Number(field.maxLength) > 1000)) throw new Error("Invalid plugin command form maxLength."); if (field.default !== undefined) out.default = field.default; if (field.maxLength !== undefined) out.maxLength = Number(field.maxLength); } return out; }); const submitLabel = typeof form.submitLabel === "string" && form.submitLabel.trim() && form.submitLabel.length <= 40 ? form.submitLabel : undefined; return { fields, submitLabel }; }
function validateCommandFormValues(form: PluginCommandForm, args: unknown): Record<string, unknown> { const input = isRecord(args) ? args : {}; const out: Record<string, unknown> = {}; for (const field of form.fields) { if (field.type === "number") { const n = Number(input[field.id] ?? field.default ?? 0); if (!Number.isFinite(n)) throw new Error(`${field.label} must be a number.`); if (field.min !== undefined && n < field.min) throw new Error(`${field.label} is too small.`); if (field.max !== undefined && n > field.max) throw new Error(`${field.label} is too large.`); out[field.id] = n; } else { const text = String(input[field.id] ?? field.default ?? "").trim(); if (field.required && !text) throw new Error(`${field.label} is required.`); if (field.maxLength !== undefined && text.length > field.maxLength) throw new Error(`${field.label} is too long.`); out[field.id] = text; } } return out; }
function validateStatus(status: PluginStatus | string): PluginStatus { const value = typeof status === "string" ? { text: status } : status; if (!value || typeof value.text !== "string" || value.text.trim() === "" || value.text.length > 120) throw new Error("Invalid plugin status text."); if (value.tone !== undefined && !["info", "success", "warning", "error"].includes(value.tone)) throw new Error("Invalid plugin status tone."); return { text: value.text, tone: value.tone }; }
function validateMoveBy(value: unknown): { x: number; y: number; durationMs?: number } { if (!isRecord(value)) throw new Error("Invalid pet movement options."); const x = Number(value.x); const y = Number(value.y); if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid pet movement distance."); return { x, y, durationMs: value.durationMs === undefined ? undefined : Number(value.durationMs) }; }
function validateWander(value: unknown): { distance?: number; durationMs?: number } { const options = isRecord(value) ? value : {}; return { distance: options.distance === undefined ? undefined : Number(options.distance), durationMs: options.durationMs === undefined ? undefined : Number(options.durationMs) }; }
function parseDaily(spec: string | { time: string; days?: number[] }): { time: string; days?: number[] } { const value = typeof spec === "string" ? { time: spec } : spec; const m = /^(\d{2}):(\d{2})$/.exec(value.time); if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error("Daily schedule time must be HH:mm between 00:00 and 23:59."); if (value.days && (!Array.isArray(value.days) || value.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error("Daily schedule days must be weekdays 0-6."); return value; }
function msUntilDaily(spec: { time: string; days?: number[] }): number { const [hour, minute] = spec.time.split(":").map(Number); const now = new Date(); for (let add = 0; add <= 7; add += 1) { const next = new Date(now); next.setDate(now.getDate() + add); next.setHours(hour ?? 0, minute ?? 0, 0, 0); if (next > now && (!spec.days || spec.days.includes(next.getDay()))) return next.getTime() - now.getTime(); } return 24 * 60 * 60 * 1000; }
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> { return new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("Plugin command timed out.")), timeoutMs); promise.then((v) => { clearTimeout(timeout); resolve(v); }, (e) => { clearTimeout(timeout); reject(e); }); }); }
function safeError(error: unknown): string { return error instanceof Error ? error.message : "Plugin SDK callback failed."; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
