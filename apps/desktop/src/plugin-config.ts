import type { OpenPetsPluginManifest, PluginConfigField } from "./plugin-manifest.js";

export type PluginConfigValue = string | number | boolean;
export type PluginConfig = Record<string, PluginConfigValue>;

export type PluginConfigValidationError = { path: string; code: string; message: string };
export type PluginConfigValidationResult = { ok: true; config: PluginConfig; errors: [] } | { ok: false; errors: PluginConfigValidationError[] };

export function getPluginDefaultConfig(manifest: OpenPetsPluginManifest): PluginConfig {
  const config: PluginConfig = {};
  for (const [key, field] of configSchemaEntries(manifest)) {
    if (isValidDefault(field)) config[key] = field.default;
  }
  return config;
}

export function validatePluginConfigReplacement(manifest: OpenPetsPluginManifest, value: unknown): PluginConfigValidationResult {
  return validateConfigObject(manifest, value, { rejectUnknown: true, applyDefaults: false });
}

export function getEffectivePluginConfig(manifest: OpenPetsPluginManifest, persisted: unknown): PluginConfigValidationResult {
  return validateConfigObject(manifest, persisted, { rejectUnknown: false, applyDefaults: true });
}

export function resolvePluginNumericConfig(manifest: OpenPetsPluginManifest, persisted: unknown, fieldName: string, options: { min?: number } = {}): number {
  const schema = manifest.configSchema;
  const field = schema && Object.prototype.hasOwnProperty.call(schema, fieldName) ? schema[fieldName] : undefined;
  if (!field || field.type !== "number") throw new Error(`Plugin numeric config ${fieldName} must reference a number config field.`);
  const result = getEffectivePluginConfig(manifest, persisted);
  if (!result.ok) throw new Error(`Plugin numeric config ${fieldName} is invalid: ${result.errors.map((error) => error.message).join("; ")}`);
  if (!Object.prototype.hasOwnProperty.call(result.config, fieldName)) throw new Error(`Plugin numeric config ${fieldName} must resolve to an integer.`);
  const value = result.config[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) throw new Error(`Plugin numeric config ${fieldName} must resolve to an integer.`);
  if (options.min !== undefined && value < options.min) throw new Error(`Plugin numeric config ${fieldName} must be an integer of at least ${options.min}.`);
  return value;
}

export function resolvePluginStringConfig(manifest: OpenPetsPluginManifest, persisted: unknown, fieldName: string, allowedType: "text" | "select"): string {
  const schema = manifest.configSchema;
  const field = schema && Object.prototype.hasOwnProperty.call(schema, fieldName) ? schema[fieldName] : undefined;
  if (!field || field.type !== allowedType) throw new Error(`Plugin string config reference must point to a ${allowedType} config field.`);
  const result = getEffectivePluginConfig(manifest, persisted);
  if (!result.ok) throw new Error("Plugin string config is invalid.");
  if (!Object.prototype.hasOwnProperty.call(result.config, fieldName)) throw new Error("Plugin string config must resolve to a value.");
  const value = result.config[fieldName];
  if (typeof value !== "string") throw new Error("Plugin string config must resolve to a string.");
  return value;
}

function validateConfigObject(manifest: OpenPetsPluginManifest, value: unknown, options: { rejectUnknown: boolean; applyDefaults: boolean }): PluginConfigValidationResult {
  const errors: PluginConfigValidationError[] = [];
  if (!isPlainRecord(value)) return { ok: false, errors: [{ path: "$", code: "invalid_config", message: "Plugin config must be a plain object." }] };
  const config: PluginConfig = options.applyDefaults ? getPluginDefaultConfig(manifest) : {};
  const schema = manifest.configSchema ?? {};

  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    const field = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined;
    if (!field) {
      if (options.rejectUnknown) errors.push({ path: `$.${key}`, code: "unknown_config_key", message: `Unknown config key ${key}.` });
      continue;
    }
    const fieldErrors = validateFieldValue(value[key], field, `$.${key}`);
    if (fieldErrors.length > 0) errors.push(...fieldErrors);
    else config[key] = value[key] as PluginConfigValue;
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config, errors: [] };
}

function validateFieldValue(value: unknown, field: PluginConfigField, path: string): PluginConfigValidationError[] {
  const errors: PluginConfigValidationError[] = [];
  if (value === null || Array.isArray(value) || typeof value === "object") return [{ path, code: "invalid_config_value", message: "Config value must be a string, finite number, or boolean matching the field type." }];
  if (field.type === "text" || field.type === "textarea") {
    if (typeof value !== "string") errors.push({ path, code: "invalid_config_value", message: "Config value must be a string." });
  } else if (field.type === "select") {
    if (typeof value !== "string") errors.push({ path, code: "invalid_config_value", message: "Select config value must be a string." });
    else if (!field.options?.some((option) => option.value === value)) errors.push({ path, code: "invalid_select_value", message: "Select config value must match one of the schema options." });
  } else if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) errors.push({ path, code: "invalid_config_value", message: "Config value must be a finite number." });
  } else if (field.type === "boolean") {
    if (typeof value !== "boolean") errors.push({ path, code: "invalid_config_value", message: "Config value must be a boolean." });
  }
  return errors;
}

function configSchemaEntries(manifest: OpenPetsPluginManifest): Array<[string, PluginConfigField]> {
  return Object.entries(manifest.configSchema ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

function isValidDefault(field: PluginConfigField): field is PluginConfigField & { default: PluginConfigValue } {
  if (field.default === undefined) return false;
  return validateFieldValue(field.default, field, "$.default").length === 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
