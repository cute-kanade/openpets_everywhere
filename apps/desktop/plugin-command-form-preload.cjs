const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openPetsCommandForm", {
  submit: (channel, values) => ipcRenderer.invoke(String(channel), values && typeof values === "object" ? values : {}),
  close: () => window.close(),
});
