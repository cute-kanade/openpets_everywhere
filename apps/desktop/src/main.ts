import { app } from "electron";

import { initializeAppState, isOnboardingCompleted, releaseStartupInstallLock } from "./app-state.js";
import { installDefaultPetDisplayHandlers, shouldOpenDefaultPetOnLaunch, showDefaultPet } from "./default-pet-controller.js";
import { installAppLifecycle } from "./lifecycle.js";
import { error as logError, getLogFilePath, info, initializeLogger } from "./logger.js";
import { startLocalIpcServer } from "./local-ipc.js";
import { defaultPluginPetApi } from "./plugin-pet-api.js";
import { initializePluginService } from "./plugin-service.js";
import { createAppTray, refreshTrayMenu } from "./tray.js";
import { checkForGitHubReleaseUpdate } from "./update-checker.js";
import { installInternalUiHandlers, installInternalUiProtocol, openTaskWindow } from "./windows.js";

// OpenPets does not store browser passwords, cookies, or encrypted app secrets.
// Keep Chromium/Electron from prompting for macOS Keychain or Linux keyring access
// during startup/profile initialization.
app.commandLine.appendSwitch("use-mock-keychain");
app.commandLine.appendSwitch("password-store", "basic");

// GNOME Wayland does not allow Electron apps to reliably control window
// z-order or absolute position, which breaks the desktop-pet contract: staying
// above normal windows and dragging to a user-chosen screen position. Prefer
// X11/Xwayland on Linux unless the user explicitly chooses another Ozone
// backend at launch.
if (process.platform === "linux" && !app.commandLine.hasSwitch("ozone-platform")) {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  installAppLifecycle();

  app.whenReady().then(async () => {
    initializeLogger();
    app.setName("OpenPets");
    info("app", "startup begin", { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, pid: process.pid, ozonePlatform: app.commandLine.getSwitchValue("ozone-platform") || null });

    if (process.platform === "darwin") {
      app.dock?.hide();
    }

    initializeAppState();
    await initializePluginService(app.getPath("userData"), defaultPluginPetApi, app.getVersion()).start();
    installInternalUiProtocol();
    installInternalUiHandlers();
    createAppTray();
    installDefaultPetDisplayHandlers();
    await startLocalIpcServer();
    releaseStartupInstallLock();
    if (shouldOpenDefaultPetOnLaunch()) {
      showDefaultPet();
    }
    if (!isOnboardingCompleted()) {
      try {
        openTaskWindow("onboarding");
      } catch (error) {
        console.error("Failed to open OpenPets onboarding; continuing with tray app.", error);
      }
    }
    refreshTrayMenu();
    void checkForGitHubReleaseUpdate().then(() => refreshTrayMenu());
    info("app", "startup complete", { logFile: getLogFilePath(), openDefaultPetOnLaunch: shouldOpenDefaultPetOnLaunch(), onboardingCompleted: isOnboardingCompleted() });
    console.log("OpenPets desktop shell ready.");
  }).catch((error: unknown) => {
    releaseStartupInstallLock();
    logError("app", "startup failed", error);
    console.error("Failed to start OpenPets desktop shell.", error);
    app.quit();
  });
}
