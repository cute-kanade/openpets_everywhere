const { contextBridge, ipcRenderer } = require("electron");

const tokenArg = process.argv.find((arg) => arg.startsWith("--openpets-plugin-token="));
const channel = tokenArg ? `openpets:plugin-sdk:${tokenArg.slice("--openpets-plugin-token=".length)}` : "";
let callbackId = 0;
const callbacks = new Map();

async function call(path, args) {
  if (!channel) throw new Error("OpenPets plugin SDK is unavailable.");
  return ipcRenderer.invoke(channel, path, normalizeForIpc(args));
}

function normalizeForIpc(value, depth = 0) {
  if (depth > 20) return null;
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => normalizeForIpc(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value).slice(0, 100)) {
      const normalized = normalizeForIpc(nested, depth + 1);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  }
  return String(value);
}

function registerCallback(fn) {
  if (typeof fn !== "function") return undefined;
  const id = `cb-${++callbackId}`;
  callbacks.set(id, fn);
  return id;
}

const sdk = {
  pet: {
    speak: (message) => call("pet.speak", [message]),
    react: (reaction) => call("pet.react", [reaction]),
  },
  schedule: {
    once: (id, delayMs, callback) => call("schedule.once", [id, delayMs, registerCallback(callback)]),
    every: (id, intervalMs, callback) => call("schedule.every", [id, intervalMs, registerCallback(callback)]),
    daily: (id, spec, callback) => call("schedule.daily", [id, spec, registerCallback(callback)]),
    cancel: (id) => call("schedule.cancel", [id]),
    cancelAll: () => call("schedule.cancelAll", []),
  },
  storage: {
    get: (key) => call("storage.get", [key]),
    set: (key, value) => call("storage.set", [key, value]),
    delete: (key) => call("storage.delete", [key]),
  },
  config: {
    get: () => call("config.get", []),
    onChange: (listener) => {
      const id = registerCallback(listener);
      void call("config.onChange", [id]);
      return () => { callbacks.delete(id); void call("config.offChange", [id]); };
    },
  },
  commands: {
    register: (command, handler) => call("commands.register", [command, registerCallback(handler)]),
    unregister: (id) => call("commands.unregister", [id]),
  },
  status: {
    set: (status) => call("status.set", [status]),
    clear: () => call("status.clear", []),
  },
  http: {
    fetch: (url, options) => call("http.fetch", [url, options]),
  },
  log: Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (...args) => call(`log.${level}`, args)])),
};

contextBridge.exposeInMainWorld("__openPetsSdk", sdk);
contextBridge.exposeInMainWorld("__openPetsRunCallback", async (id, args) => {
  const callback = callbacks.get(id);
  if (callback) return callback(...(Array.isArray(args) ? args : []));
  return undefined;
});
