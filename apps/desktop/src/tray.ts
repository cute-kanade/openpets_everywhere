import { Menu, Tray, type MenuItemConstructorOptions } from "electron";

import { getAppStateSnapshot, isOnboardingCompleted } from "./app-state.js";
import { createTrayIcon } from "./assets.js";
import { hideDefaultPet, isDefaultPetVisible, setDefaultPetPaused, showDefaultPet } from "./default-pet-controller.js";
import { quitOpenPets } from "./lifecycle.js";
import { info, openLogsFolder } from "./logger.js";
import { shellState, togglePaused } from "./state.js";
import { getUpdateStatus, openUpdateReleasePage } from "./update-checker.js";
import { openControlCenterWindow, openTaskWindow } from "./windows.js";

let tray: Tray | null = null;

export function createAppTray(): Tray {
  if (tray) {
    return tray;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip("OpenPets");
  refreshTrayMenu();
  info("tray", "created");
  console.log("OpenPets tray created.");

  return tray;
}

export function refreshTrayMenu(): void {
  if (!tray) {
    return;
  }

  const state = getAppStateSnapshot();
  const defaultPet = state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId && !pet.broken) ?? state.pets.installed[0];
  const defaultPetName = defaultPet?.displayName ?? "Built-in Pet";

  const continueSetupItems = isOnboardingCompleted()
    ? []
    : [
      {
        label: "Continue Setup...",
        click: () => openTaskWindow("onboarding"),
      },
      { type: "separator" as const },
    ];

  const menu = Menu.buildFromTemplate([
    {
      label: "OpenPets",
      enabled: false,
    },
    ...createUpdateMenuItems(),
    { type: "separator" },
    ...continueSetupItems,
    {
      label: `Default Pet: ${defaultPetName}`,
      click: () => openTaskWindow("pet-manager"),
    },
    {
      label: isDefaultPetVisible() ? "Hide Default Pet" : "Show Default Pet",
      click: () => {
        if (isDefaultPetVisible()) {
          hideDefaultPet();
        } else {
          showDefaultPet();
        }

        refreshTrayMenu();
      },
    },
    {
      label: shellState.paused ? "Resume All Pets" : "Pause All Pets",
      click: () => {
        const paused = togglePaused();
        setDefaultPetPaused(paused);
        info("tray", "pause toggled", { paused });
        console.log(paused ? "OpenPets paused." : "OpenPets resumed.");
        refreshTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "Manage Pets...",
      click: () => openTaskWindow("pet-manager"),
    },
    {
      label: "Control Center Preview...",
      click: () => openControlCenterWindow(),
    },
    {
      label: "Integrations...",
      click: () => openTaskWindow("agent-setup"),
    },
    {
      label: "Plugins...",
      click: () => openTaskWindow("plugins"),
    },
    {
      label: "Settings...",
      click: () => openTaskWindow("settings"),
    },
    {
      label: "Open Logs Folder...",
      click: () => { void openLogsFolder(); },
    },
    { type: "separator" },
    {
      label: "Quit OpenPets",
      click: () => quitOpenPets(),
    },
  ]);

  tray.setContextMenu(menu);
}

function createUpdateMenuItems(): MenuItemConstructorOptions[] {
  const status = getUpdateStatus();
  if (status.state !== "available") return [];
  return [
    {
      label: `Update available: ${status.latestVersion ?? "latest"}...`,
      click: () => { void openUpdateReleasePage(); },
    },
  ];
}
