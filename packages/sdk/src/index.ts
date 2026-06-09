/**
 * Type definitions for OpenPets plugins.
 *
 * This package ships **types only**. There is no runtime to import — the
 * OpenPets desktop app injects the `OpenPetsPlugin` global into the plugin
 * sandbox and passes your `start(ctx)` handler an {@link OpenPetsContext}.
 *
 * In a plain JavaScript plugin, reference these types for editor IntelliSense:
 *
 * ```js
 * /// <reference types="@open-pets/plugin-sdk" />
 *
 * OpenPetsPlugin.register({
 *   async start(ctx) {
 *     await ctx.pet.speak("Hello!")
 *   },
 * })
 * ```
 *
 * @packageDocumentation
 */

/** Capabilities a plugin can request in its manifest's `permissions` array. */
export type OpenPetsPermission =
  | "pet:speak"
  | "pet:reaction"
  | "pet:move"
  | "schedule"
  | "storage"
  | "status"
  | "commands"
  | "network";

/**
 * Reaction name passed to {@link OpenPetsPetApi.react}. Common values are
 * listed for autocomplete; any string the host accepts is allowed.
 */
export type OpenPetsReaction =
  | "idle"
  | "thinking"
  | "working"
  | "editing"
  | "running"
  | "testing"
  | "waiting"
  | "waving"
  | "success"
  | "error"
  | "celebrating"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/** Tone shown alongside a plugin's status line in the Plugins window. */
export type OpenPetsStatusTone = "info" | "success" | "warning" | "error";

/** A status line, either a bare string or text plus a {@link OpenPetsStatusTone}. */
export type OpenPetsStatus = string | { text: string; tone?: OpenPetsStatusTone };

/** A single field in a command's input form. */
export interface OpenPetsCommandFormField {
  /** Identifier for this field; the submitted value is keyed by it. */
  id: string;
  type: "text" | "textarea" | "number";
  label: string;
  default?: string | number;
  /** Minimum value (number fields only). */
  min?: number;
  /** Maximum value (number fields only). */
  max?: number;
  /** Maximum length (text/textarea fields only). */
  maxLength?: number;
  required?: boolean;
}

/** Optional input form attached to a command. */
export interface OpenPetsCommandForm {
  fields: OpenPetsCommandFormField[];
  submitLabel?: string;
}

/** A right-click pet action registered via {@link OpenPetsCommandsApi.register}. */
export interface OpenPetsCommand {
  /** Short, stable id (`[A-Za-z0-9._:-]`, 1–64 chars). */
  id: string;
  title: string;
  description?: string;
  /** When present, the host opens a dialog and passes validated values to the handler. */
  form?: OpenPetsCommandForm;
}

/** A daily schedule time, optionally restricted to specific weekdays. */
export type OpenPetsDailySpec = string | { time: string; days?: number[] };

/** Options for {@link OpenPetsPetApi.moveBy}. */
export interface OpenPetsMoveByOptions {
  x: number;
  y: number;
  durationMs?: number;
}

/** Options for {@link OpenPetsPetApi.wander}. */
export interface OpenPetsWanderOptions {
  distance?: number;
  durationMs?: number;
}

/** Options for {@link OpenPetsHttpApi.fetch}. GET-only by design. */
export interface OpenPetsHttpOptions {
  method?: "GET";
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Response returned by {@link OpenPetsHttpApi.fetch}. */
export interface OpenPetsHttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
  json?: unknown;
}

/** Make the default pet speak, react, or move. */
export interface OpenPetsPetApi {
  /** Requires `pet:speak`. Messages are capped at 140 chars and content-filtered. */
  speak(message: string): Promise<void>;
  /** Requires `pet:reaction`. */
  react(reaction: OpenPetsReaction): Promise<void>;
  /** Requires `pet:move`. Movement is bounded to the work area. */
  moveBy(options: OpenPetsMoveByOptions): Promise<void>;
  /** Requires `pet:move`. */
  wander(options?: OpenPetsWanderOptions): Promise<void>;
  /** Requires `pet:move`. */
  moveToHome(): Promise<void>;
}

/** A callback fired by a schedule. */
export type OpenPetsScheduleHandler = () => void | Promise<void>;

/** Run callbacks once, on an interval, or daily. Requires `schedule`. */
export interface OpenPetsScheduleApi {
  /** Fire once after `delayMs`. */
  once(id: string, delayMs: number, handler: OpenPetsScheduleHandler): Promise<void>;
  /** Fire repeatedly every `intervalMs` (a minimum interval is enforced). */
  every(id: string, intervalMs: number, handler: OpenPetsScheduleHandler): Promise<void>;
  /** Fire daily at `HH:mm`, optionally only on the given weekdays (0–6, Sunday = 0). */
  daily(id: string, spec: OpenPetsDailySpec, handler: OpenPetsScheduleHandler): Promise<void>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
}

/** Persist small per-plugin state across restarts. Requires `storage`. */
export interface OpenPetsStorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Read user configuration and react to changes. Always available. */
export interface OpenPetsConfigApi {
  get<T = Record<string, unknown>>(): Promise<T>;
  /** Subscribe to config changes. Returns an unsubscribe function. */
  onChange<T = Record<string, unknown>>(handler: (config: T) => void | Promise<void>): () => void;
}

/** Handler invoked when a command runs, with validated form values when present. */
export type OpenPetsCommandHandler = (values?: Record<string, unknown>) => void | Promise<void>;

/** Register right-click pet actions. Requires `commands`. */
export interface OpenPetsCommandsApi {
  register(command: OpenPetsCommand, handler: OpenPetsCommandHandler): Promise<void>;
  unregister(id: string): Promise<void>;
}

/** Show a short status line in the Plugins window. Requires `status`. */
export interface OpenPetsStatusApi {
  set(status: OpenPetsStatus): Promise<void>;
  clear(): Promise<void>;
}

/** Fetch approved HTTPS hosts through the OpenPets proxy. Requires `network`. */
export interface OpenPetsHttpApi {
  fetch(url: string, options?: OpenPetsHttpOptions): Promise<OpenPetsHttpResponse>;
}

/** Write to the desktop app log under the `plugin` scope. Always available. */
export interface OpenPetsLogApi {
  debug(...args: unknown[]): Promise<void>;
  info(...args: unknown[]): Promise<void>;
  warn(...args: unknown[]): Promise<void>;
  error(...args: unknown[]): Promise<void>;
}

/**
 * The capability object passed to {@link OpenPetsPluginDefinition.start}.
 *
 * Each namespace is only functional when the matching permission is approved
 * in the manifest. `config` and `log` are always available.
 */
export interface OpenPetsContext {
  pet: OpenPetsPetApi;
  schedule: OpenPetsScheduleApi;
  storage: OpenPetsStorageApi;
  config: OpenPetsConfigApi;
  commands: OpenPetsCommandsApi;
  status: OpenPetsStatusApi;
  http: OpenPetsHttpApi;
  log: OpenPetsLogApi;
}

/** The object you pass to {@link OpenPetsPluginApi.register}. */
export interface OpenPetsPluginDefinition {
  /** Runs when the plugin is enabled or the app launches. */
  start(ctx: OpenPetsContext): void | Promise<void>;
  /** Optional cleanup. Schedules and commands are torn down for you. */
  stop?(ctx?: OpenPetsContext): void | Promise<void>;
}

/** The injected global used to register a plugin. */
export interface OpenPetsPluginApi {
  register(definition: OpenPetsPluginDefinition): void;
}

/**
 * The signature of an exported `register` function — the testable plugin
 * style used by the official plugins:
 *
 * ```ts
 * export function register(OpenPetsPlugin: OpenPetsPluginApi) {
 *   OpenPetsPlugin.register({ async start(ctx) {} })
 * }
 * ```
 */
export type OpenPetsPluginEntry = (api: OpenPetsPluginApi) => void | Promise<void>;

/** Field types supported by `configSchema` in the manifest. */
export type OpenPetsConfigFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "time"
  | "list"
  | "multiselect";

declare global {
  /**
   * Injected by the OpenPets runtime. Call once at the top level of your
   * entry file to register your plugin.
   */
  const OpenPetsPlugin: OpenPetsPluginApi;
}

export {};
