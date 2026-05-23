const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getPetsState: () => ipcRenderer.invoke("openpets:get-pets-state"),
  getCatalog: () => ipcRenderer.invoke("openpets:get-catalog"),
  getCatalogPage: (page) => ipcRenderer.invoke("openpets:get-catalog-page", page),
  getCatalogSearch: () => ipcRenderer.invoke("openpets:get-catalog-search"),
  getCodexPets: () => ipcRenderer.invoke("openpets:get-codex-pets"),
  setDefaultPet: (petId) => ipcRenderer.invoke("openpets:set-default-pet", petId),
  installPet: (petId) => ipcRenderer.invoke("openpets:install-pet", petId),
  importCodexPet: (petId) => ipcRenderer.invoke("openpets:import-codex-pet", petId),
  removePet: (petId) => ipcRenderer.invoke("openpets:remove-pet", petId),
};

contextBridge.exposeInMainWorld("openPetsControlCenter", api);
