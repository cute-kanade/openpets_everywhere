import { allowedReactions } from "./local-ipc-protocol.js";

export const OPENPETS_PLUGIN_MANIFEST_FILENAME = "openpets.plugin.json";
export const openPetsPluginManifestFilename = OPENPETS_PLUGIN_MANIFEST_FILENAME;

export type PluginRuntime = "declarative";
export type KnownPluginRuntime = PluginRuntime | "javascript";
export type PluginPermission = "pet:speak" | "pet:reaction" | "timer";
export type PluginConfigFieldType = "text" | "textarea" | "number" | "boolean" | "select";

export type PluginConfigField = {
  type: PluginConfigFieldType;
  label?: string;
  description?: string;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
};

export type PluginStringConfigRef = { config: string };
export type PluginAction = { type: "pet.speak"; message: string | PluginStringConfigRef } | { type: "pet.react"; reaction: string | PluginStringConfigRef };
export type PluginTimerEveryMinutes = number | { config: string };
export type PluginTrigger = { on: "timer"; everyMinutes: PluginTimerEveryMinutes; actions: PluginAction[] };

export type OpenPetsPluginManifest = {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  runtime: PluginRuntime;
  permissions: PluginPermission[];
  configSchema?: Record<string, PluginConfigField>;
  triggers: PluginTrigger[];
};

export type PluginManifestValidationError = {
  path: string;
  code: string;
  message: string;
};

export type PluginManifestValidationResult =
  | { ok: true; manifest: OpenPetsPluginManifest; errors: [] }
  | { ok: false; errors: PluginManifestValidationError[] };

const topLevelFields = new Set(["manifestVersion", "id", "name", "version", "runtime", "permissions", "configSchema", "triggers"]);
const configFieldFields = new Set(["type", "label", "description", "default", "options"]);
const configOptionFields = new Set(["label", "value"]);
const triggerFields = new Set(["on", "everyMinutes", "actions"]);
const speakActionFields = new Set(["type", "message"]);
const reactActionFields = new Set(["type", "reaction"]);
const supportedConfigTypes = new Set(["text", "textarea", "number", "boolean", "select"]);
const deferredConfigTypes = new Set(["multi-select", "time", "date", "schedule", "connection", "secret"]);
const deferredConfigFeatures = new Set(["dynamicOptions"]);
export const pluginPermissions = ["pet:speak", "pet:reaction", "timer"] as const satisfies readonly PluginPermission[];
export const pluginPermissionSet: ReadonlySet<string> = new Set(pluginPermissions);

export function canonicalizePluginPermissions(value: unknown): PluginPermission[] {
  if (!Array.isArray(value)) throw new Error("Plugin permissions must be an array.");
  const seen = new Set<string>();
  for (const permission of value) {
    if (typeof permission !== "string" || !pluginPermissionSet.has(permission)) throw new Error(`Invalid plugin permission: ${String(permission)}`);
    if (seen.has(permission)) throw new Error(`Duplicate plugin permission: ${permission}`);
    seen.add(permission);
  }
  return pluginPermissions.filter((permission) => seen.has(permission));
}

export function validatePluginManifest(input: unknown): PluginManifestValidationResult {
  const errors: PluginManifestValidationError[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "$", code: "invalid_manifest", message: "Plugin manifest must be a JSON object." }] };
  }

  rejectUnknownFields(input, topLevelFields, "$", errors);
  if (input.manifestVersion !== 1) addError(errors, "$.manifestVersion", "invalid_manifest_version", "manifestVersion must be 1.");
  validateString(input.id, "$.id", "id", errors, /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/);
  validateString(input.name, "$.name", "name", errors);
  validateString(input.version, "$.version", "version", errors, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);

  if (input.runtime === "javascript") {
    addError(errors, "$.runtime", "unsupported_runtime", 'Runtime "javascript" is recognized but unsupported in manifest v1. Use "declarative".');
  } else if (input.runtime !== "declarative") {
    addError(errors, "$.runtime", "invalid_runtime", 'runtime must be "declarative".');
  }

  const permissions = validatePermissions(input.permissions, errors);
  const configFields = validateConfigSchema(input.configSchema, errors);
  validateTriggers(input.triggers, permissions, configFields, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: input as OpenPetsPluginManifest, errors: [] };
}

function validatePermissions(value: unknown, errors: PluginManifestValidationError[]): Set<string> {
  const permissions = new Set<string>();
  if (!Array.isArray(value)) {
    addError(errors, "$.permissions", "invalid_permissions", "permissions must be an array.");
    return permissions;
  }
  value.forEach((permission, index) => {
    if (typeof permission !== "string" || !pluginPermissionSet.has(permission)) {
      addError(errors, `$.permissions[${index}]`, "invalid_permission", "Permission must be one of pet:speak, pet:reaction, timer.");
      return;
    }
    if (permissions.has(permission)) {
      addError(errors, `$.permissions[${index}]`, "duplicate_permission", `Duplicate permission ${permission}.`);
      return;
    }
    permissions.add(permission);
  });
  return permissions;
}

type ConfigFieldSets = { text: Set<string>; select: Set<string>; number: Set<string>; schema: Record<string, unknown> };

function validateConfigSchema(value: unknown, errors: PluginManifestValidationError[]): ConfigFieldSets {
  const fields: ConfigFieldSets = { text: new Set(), select: new Set(), number: new Set(), schema: isRecord(value) ? value : {} };
  if (value === undefined) return fields;
  if (!isRecord(value)) {
    addError(errors, "$.configSchema", "invalid_config_schema", "configSchema must be an object.");
    return fields;
  }
  for (const [key, field] of Object.entries(value)) {
    const path = `$.configSchema.${key}`;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) addError(errors, path, "invalid_config_key", "Config field keys must be simple identifiers.");
    if (!isRecord(field)) {
      addError(errors, path, "invalid_config_field", "Config field must be an object.");
      continue;
    }
    rejectUnknownFields(field, configFieldFields, path, errors);
    for (const feature of deferredConfigFeatures) {
      if (Object.prototype.hasOwnProperty.call(field, feature)) addError(errors, `${path}.${feature}`, "deferred_config_feature", `${feature} is deferred and unsupported in v1.`);
    }
    if (typeof field.type !== "string" || !supportedConfigTypes.has(field.type)) {
      const code = typeof field.type === "string" && deferredConfigTypes.has(field.type) ? "deferred_config_type" : "invalid_config_type";
      addError(errors, `${path}.type`, code, "Config field type must be text, textarea, number, boolean, or select.");
    } else {
      validateConfigFieldSemantics(field, path, errors);
      if (field.type === "number") fields.number.add(key);
      if (field.type === "text") fields.text.add(key);
      if (field.type === "select") fields.select.add(key);
    }
  }
  return fields;
}

function validateConfigFieldSemantics(field: Record<string, unknown>, path: string, errors: PluginManifestValidationError[]): void {
  if (field.label !== undefined) validateString(field.label, `${path}.label`, "label", errors);
  if (field.description !== undefined) validateString(field.description, `${path}.description`, "description", errors);
  if (field.type !== "select" && field.options !== undefined) addError(errors, `${path}.options`, "invalid_options", "options are only valid for select config fields.");
  if ((field.type === "text" || field.type === "textarea") && field.default !== undefined && typeof field.default !== "string") addError(errors, `${path}.default`, "invalid_default", "Default must be a string.");
  if (field.type === "number" && field.default !== undefined && (typeof field.default !== "number" || !Number.isFinite(field.default))) addError(errors, `${path}.default`, "invalid_default", "Default must be a finite number.");
  if (field.type === "boolean" && field.default !== undefined && typeof field.default !== "boolean") addError(errors, `${path}.default`, "invalid_default", "Default must be a boolean.");
  if (field.type === "select") validateSelectField(field, path, errors);
}

function validateSelectField(field: Record<string, unknown>, path: string, errors: PluginManifestValidationError[]): void {
  if (!Array.isArray(field.options) || field.options.length === 0) {
    addError(errors, `${path}.options`, "invalid_options", "select config fields must have non-empty options.");
    return;
  }
  const values = validateOptions(field.options, path, errors);
  if (field.default !== undefined) {
    if (typeof field.default !== "string") addError(errors, `${path}.default`, "invalid_default", "Select default must be a string.");
    else if (!values.has(field.default)) addError(errors, `${path}.default`, "invalid_default", "Select default must match one of the option values.");
  }
}

function validateOptions(value: unknown, path: string, errors: PluginManifestValidationError[]): Set<string> {
  const values = new Set<string>();
  if (!Array.isArray(value)) {
    addError(errors, `${path}.options`, "invalid_options", "options must be an array.");
    return values;
  }
  value.forEach((option, index) => {
    const optionPath = `${path}.options[${index}]`;
    if (!isRecord(option)) return addError(errors, optionPath, "invalid_option", "Option must be an object.");
    rejectUnknownFields(option, configOptionFields, optionPath, errors);
    validateString(option.label, `${optionPath}.label`, "option label", errors);
    validateString(option.value, `${optionPath}.value`, "option value", errors);
    if (typeof option.value === "string" && option.value.trim() !== "") {
      if (values.has(option.value)) addError(errors, `${optionPath}.value`, "duplicate_option_value", `Duplicate option value ${option.value}.`);
      values.add(option.value);
    }
  });
  return values;
}

function validateTriggers(value: unknown, permissions: Set<string>, configFields: ConfigFieldSets, errors: PluginManifestValidationError[]): void {
  if (!Array.isArray(value)) return addError(errors, "$.triggers", "invalid_triggers", "triggers must be an array.");
  value.forEach((trigger, index) => {
    const path = `$.triggers[${index}]`;
    if (!isRecord(trigger)) return addError(errors, path, "invalid_trigger", "Trigger must be an object.");
    rejectUnknownFields(trigger, triggerFields, path, errors);
    if (trigger.on !== "timer") addError(errors, `${path}.on`, "invalid_trigger", 'Only timer triggers are supported in v1.');
    requirePermission(permissions, "timer", path, errors);
    validateEveryMinutes(trigger.everyMinutes, configFields.number, `${path}.everyMinutes`, errors);
    if (!Array.isArray(trigger.actions)) return addError(errors, `${path}.actions`, "invalid_actions", "actions must be an array.");
    trigger.actions.forEach((action, actionIndex) => validateAction(action, permissions, configFields, `${path}.actions[${actionIndex}]`, errors));
  });
}

function validateEveryMinutes(value: unknown, numberConfigFields: Set<string>, path: string, errors: PluginManifestValidationError[]): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 5) addError(errors, path, "invalid_timer_interval", "Timer interval must be an integer of at least 5 minutes.");
    return;
  }
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, "config") || typeof value.config !== "string") {
    addError(errors, path, "invalid_timer_interval", "Timer interval must be an integer or { config: string }.");
    return;
  }
  if (!numberConfigFields.has(value.config)) addError(errors, `${path}.config`, "invalid_timer_config_reference", "Timer config reference must point to a number config field.");
}

function validateStringOrConfigRef(value: unknown, allowedFields: Set<string>, path: string, label: string, fieldType: string, errors: PluginManifestValidationError[]): void {
  if (typeof value === "string") return validateString(value, path, label, errors);
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, "config") || typeof value.config !== "string") {
    addError(errors, path, "invalid_config_reference", `${label} must be a non-empty string or { config: string }.`);
    return;
  }
  if (!allowedFields.has(value.config)) addError(errors, `${path}.config`, "invalid_config_reference", `${label} config reference must point to a ${fieldType} config field.`);
}

function validateReactionSelectReference(schema: Record<string, unknown>, fieldName: string, path: string, errors: PluginManifestValidationError[]): void {
  if (!Object.prototype.hasOwnProperty.call(schema, fieldName)) return;
  const field = schema[fieldName];
  if (!isRecord(field) || field.type !== "select") return;
  const reactions = new Set<string>(allowedReactions);
  if (!Object.prototype.hasOwnProperty.call(field, "default") || typeof field.default !== "string" || !reactions.has(field.default)) {
    addError(errors, `${path}.config`, "invalid_reaction_config_reference", "Reaction select config must have a valid OpenPets reaction default.");
  }
  if (Array.isArray(field.options)) {
    for (const option of field.options) {
      if (isRecord(option) && typeof option.value === "string" && !reactions.has(option.value)) addError(errors, `${path}.config`, "invalid_reaction_config_reference", "Reaction select options must be valid OpenPets reactions.");
    }
  }
}

function validateAction(value: unknown, permissions: Set<string>, configFields: ConfigFieldSets, path: string, errors: PluginManifestValidationError[]): void {
  if (!isRecord(value)) return addError(errors, path, "invalid_action", "Action must be an object.");
  if (value.type === "pet.speak") {
    rejectUnknownFields(value, speakActionFields, path, errors);
    validateStringOrConfigRef(value.message, configFields.text, `${path}.message`, "message", "text", errors);
    requirePermission(permissions, "pet:speak", path, errors);
  } else if (value.type === "pet.react") {
    rejectUnknownFields(value, reactActionFields, path, errors);
    validateStringOrConfigRef(value.reaction, configFields.select, `${path}.reaction`, "reaction", "select", errors);
    if (isRecord(value.reaction) && typeof value.reaction.config === "string" && configFields.select.has(value.reaction.config)) validateReactionSelectReference(configFields.schema, value.reaction.config, `${path}.reaction`, errors);
    requirePermission(permissions, "pet:reaction", path, errors);
  } else {
    addError(errors, `${path}.type`, "invalid_action", "Action type must be pet.speak or pet.react.");
  }
}

function requirePermission(permissions: Set<string>, permission: string, path: string, errors: PluginManifestValidationError[]): void {
  if (!permissions.has(permission)) addError(errors, path, "missing_permission", `Missing required permission ${permission}.`);
}

function rejectUnknownFields(record: Record<string, unknown>, allowed: Set<string>, path: string, errors: PluginManifestValidationError[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, "unknown_field", `Unknown field ${key}.`);
  }
}

function validateString(value: unknown, path: string, label: string, errors: PluginManifestValidationError[], pattern?: RegExp): void {
  if (typeof value !== "string" || value.trim() === "") return addError(errors, path, "invalid_string", `${label} must be a non-empty string.`);
  if (pattern && !pattern.test(value)) addError(errors, path, "invalid_format", `${label} has an invalid format.`);
}

function addError(errors: PluginManifestValidationError[], path: string, code: string, message: string): void {
  errors.push({ path, code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
