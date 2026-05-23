import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import openPetsLogoUrl from "../../../assets/openpets.webp";
import defaultThumbUrl from "../../../assets/default-pet-thumbnail.png";

type Filter = "all" | "installed" | "featured" | "originals" | "western" | "asian" | "codex";
type InstalledPet = { id: string; displayName: string; description?: string; builtIn: boolean; protected: boolean; installed: boolean; broken?: boolean; brokenReason?: string; source?: { kind?: "catalog"; preview?: string } | { kind: "codex"; path: string } };
type PetEntry = { id: string; displayName: string; description?: string; searchText?: string; preview?: string; thumbnail?: string; spritesheet?: string; category?: "western" | "asian"; original?: boolean; featured?: boolean; catalogPage?: number; sourceKind?: "installed" | "catalog" | "codex"; installed?: boolean; builtIn?: boolean; protected?: boolean; broken?: boolean; brokenReason?: string };
type SearchPetEntry = Pick<PetEntry, "id" | "displayName" | "category" | "original" | "featured"> & { searchText?: string; catalogPage?: number };
type StateSnapshot = { preferences: { defaultPetId: string }; pets: { installed: InstalledPet[] } };
type CatalogState = { pets: PetEntry[]; source: string; error?: string; page?: number; pageCount?: number; total?: number; categories?: { id: "western" | "asian"; label: string; count: number }[]; originalsCount?: number; featuredCount?: number };
type CodexState = { pets: PetEntry[]; error?: string };
type PetScaleOption = { label: string; value: number };
type UserSelectableAnimationState = "idle" | "review" | "running" | "waiting" | "waving" | "jumping" | "failed";
type ReactionAnimationOverrides = Record<string, UserSelectableAnimationState>;
type SettingsState = { preferences: { openDefaultPetOnLaunch: boolean; petScale: number; reactionAnimationOverrides?: ReactionAnimationOverrides }; petScaleOptions: PetScaleOption[] };
type LaunchAtLoginState = { supported: boolean; enabled: boolean };
type UpdateStatus = { state: "idle" | "checking" | "available" | "current" | "error"; currentVersion: string; latestVersion?: string; releaseUrl?: string; checkedAt?: number; error?: string };
type ReactionAnimationSettings = { reactions: { id: string; label: string; description: string; defaultAnimation: UserSelectableAnimationState }[]; animations: { id: UserSelectableAnimationState; label: string; description: string }[]; sprite: { frameWidth: number; frameHeight: number; columns: number; rows: number; states: Record<UserSelectableAnimationState, { row: number; frames: number; durationMs: number; iterations?: number | "infinite" }> }; overrides: ReactionAnimationOverrides; previewSpriteUrl: string };
type PluginFilter = "all" | "installed" | "catalog" | "local" | "broken";
type PluginPermission = "pet:speak" | "pet:reaction" | "timer" | "schedule" | "storage" | "status" | "commands" | "network";
type PluginConfigField = { type: "text" | "textarea" | "number" | "boolean" | "select" | "time" | "multiSelect" | "list"; label?: string; description?: string; default?: string | number | boolean | string[] | Array<Record<string, unknown>>; options?: Array<{ label: string; value: string }>; min?: number; max?: number; step?: number; maxLength?: number; maxItems?: number; itemSchema?: Record<string, PluginConfigField> };
type PluginConfigSchema = Record<string, PluginConfigField>;
type PluginConfig = Record<string, unknown>;
type PluginCommand = { id: string; title: string; description?: string };
type PluginStatus = { text: string; tone?: "info" | "success" | "warning" | "error" };
type PluginConfigError = { path?: string; code?: string; message?: string };
type SafePluginRecord = { id: string; name?: string; version: string; source: "catalog" | "local"; enabled: boolean; brokenReason?: string; approvedPermissions: PluginPermission[]; runtime?: "declarative" | "javascript"; sdkVersion?: string; catalogDisabled?: boolean; catalogDeprecated?: boolean; catalogStatusReason?: string; configSchema?: PluginConfigSchema; effectiveConfig?: PluginConfig; configErrors?: PluginConfigError[]; commands?: PluginCommand[]; status?: PluginStatus };
type SafeCatalogPluginRecord = { id: string; name: string; version: string; description: string; runtime: "declarative" | "javascript"; sdkVersion?: string; permissions: PluginPermission[]; installed: boolean; deprecated?: boolean; statusReason?: string };
type PluginServiceSnapshot = { plugins: SafePluginRecord[] };
type PluginCatalogSnapshot = { plugins: SafeCatalogPluginRecord[] };
type PluginServiceResult = { ok: true; snapshot: PluginServiceSnapshot } | { ok: false; error: string; snapshot: PluginServiceSnapshot };
type PluginEntry = { id: string; installed?: SafePluginRecord; catalog?: SafeCatalogPluginRecord };
type ControlCenterApi = {
  getPetsState(): Promise<StateSnapshot>;
  getSettingsState(): Promise<SettingsState>;
  updatePreferences(patch: Partial<SettingsState["preferences"]>): Promise<SettingsState>;
  getReactionAnimationSettings(): Promise<ReactionAnimationSettings>;
  getLaunchAtLogin(): Promise<LaunchAtLoginState>;
  setLaunchAtLogin(enabled: boolean): Promise<LaunchAtLoginState>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  openUpdateReleasePage(): Promise<void>;
  resetDefaultPetPosition(): Promise<SettingsState>;
  getPluginsSnapshot(): Promise<PluginServiceSnapshot>;
  getPluginCatalogSnapshot(refresh?: boolean): Promise<PluginCatalogSnapshot>;
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginServiceResult>;
  savePluginConfig(id: string, config: PluginConfig): Promise<PluginServiceResult>;
  reloadPlugin(id: string): Promise<PluginServiceResult>;
  executePluginCommand(id: string, commandId: string): Promise<PluginServiceResult>;
  loadLocalPlugin(): Promise<PluginServiceResult>;
  installCatalogPlugin(id: string): Promise<PluginServiceResult>;
  updateCatalogPlugin(id: string): Promise<PluginServiceResult>;
  uninstallPlugin(id: string): Promise<PluginServiceResult>;
  getCatalog(): Promise<CatalogState>;
  getCatalogPage(page: number): Promise<CatalogState>;
  getCatalogSearch(): Promise<{ pets: SearchPetEntry[]; error?: string }>;
  getCodexPets(): Promise<CodexState>;
  setDefaultPet(petId: string): Promise<StateSnapshot>;
  installPet(petId: string): Promise<unknown>;
  importCodexPet(petId: string): Promise<unknown>;
  removePet(petId: string): Promise<StateSnapshot>;
};

const api = (window as unknown as { openPetsControlCenter: ControlCenterApi }).openPetsControlCenter;


// Inline SVG Icons for actions, pagination, and filters
const InstallIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const ImportIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M12 18v-6" />
    <path d="m9 15 3 3 3-3" />
  </svg>
);

const SetDefaultIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const RemoveIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

const ConfigureIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="21" x2="14" y1="4" y2="4" />
    <line x1="10" x2="3" y1="4" y2="4" />
    <line x1="21" x2="12" y1="12" y2="12" />
    <line x1="8" x2="3" y1="12" y2="12" />
    <line x1="21" x2="16" y1="20" y2="20" />
    <line x1="12" x2="3" y1="20" y2="20" />
    <line x1="14" x2="14" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    <line x1="16" x2="16" y1="18" y2="22" />
  </svg>
);

const FolderPlusIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 10v6" />
    <path d="M9 13h6" />
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

const SaveIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8A2 2 0 0 1 21 8.8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M17 21v-7H7v7" />
    <path d="M7 3v5h8" />
  </svg>
);

const CloseIcon = () => (
  <svg className="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const PrevIcon = () => (
  <svg className="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const NextIcon = () => (
  <svg className="btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const FilterAllIcon = () => (
  <svg className="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </svg>
);

const FilterInstalledIcon = () => (
  <svg className="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const FilterFeaturedIcon = () => (
  <svg className="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3q1 4 4 6.5t3 5.5a7 7 0 0 1-14 0 5 5 0 0 1 1-3 3 3 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
  </svg>
);

const FilterOriginalIcon = () => (
  <svg className="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" />
  </svg>
);

const FilterWesternIcon = () => (
  <svg className="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const FilterAsianIcon = () => (
  <svg className="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const FilterCodexIcon = () => (
  <svg className="filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

// Navigation Shell Types and Icons
type Route = "dashboard" | "pets" | "settings" | "plugins" | "integrations" | "onboarding";

const DashboardIcon = () => (
  <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect fill="currentColor" width="7" height="9" x="3" y="3" rx="1" />
    <rect fill="currentColor" width="7" height="5" x="14" y="3" rx="1" />
    <rect fill="currentColor" width="7" height="9" x="14" y="12" rx="1" />
    <rect fill="currentColor" width="7" height="5" x="3" y="16" rx="1" />
  </svg>
);

const PetsIcon = () => (
  <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle fill="currentColor" cx="11" cy="4" r="2" />
    <circle fill="currentColor" cx="18" cy="8" r="2" />
    <circle fill="currentColor" cx="20" cy="16" r="2" />
    <path fill="currentColor" d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045q-.64-2.065-2.7-2.705A3.5 3.5 0 0 1 5.5 10Z" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path fill="currentColor" d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle fill="currentColor" cx="12" cy="12" r="3" />
  </svg>
);

const PluginsIcon = () => (
  <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path fill="currentColor" d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" />
    <rect fill="currentColor" width="8" height="8" x="14" y="2" rx="1" />
  </svg>
);

const IntegrationsIcon = () => (
  <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path fill="currentColor" d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1zm0 2v-2" />
    <path fill="currentColor" d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10m16 11v-2M3 5V3" />
    <path fill="currentColor" d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2zm3-5V3" />
  </svg>
);

const OnboardingIcon = () => (
  <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path fill="currentColor" d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" />
    <path fill="currentColor" d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" />
    <path fill="currentColor" d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" />
  </svg>
);

const navTabs = [
  { id: "dashboard" as const, label: "Dashboard", icon: <DashboardIcon /> },
  { id: "pets" as const, label: "Pets", icon: <PetsIcon /> },
  { id: "settings" as const, label: "Settings", icon: <SettingsIcon /> },
  { id: "plugins" as const, label: "Plugins", icon: <PluginsIcon /> },
  { id: "integrations" as const, label: "Integrations", icon: <IntegrationsIcon /> },
  { id: "onboarding" as const, label: "Onboarding", icon: <OnboardingIcon /> },
];

const routeMetadata: Record<Route, { title: string; description: string }> = {
  dashboard: {
    title: "Dashboard",
    description: "Overview of your active companions, status, and system metrics.",
  },
  pets: {
    title: "Pets",
    description: "Install, import, preview, and choose your default desktop companion.",
  },
  settings: {
    title: "Settings",
    description: "Configure startup behaviors, scale preferences, and animation settings.",
  },
  plugins: {
    title: "Plugins",
    description: "Extend your desktop experience with custom tools and behaviors.",
  },
  integrations: {
    title: "Integrations",
    description: "Connect your companions to Claude Code, VS Code, Cursor, and more.",
  },
  onboarding: {
    title: "Onboarding",
    description: "A quick walkthrough to configure and personalize your first pet.",
  },
};

function PlaceholderView({ route }: { route: Exclude<Route, "pets"> }) {
  const meta = routeMetadata[route];
  return (
    <div className="grid grid-cols-1 w-full">
      <GlassCard className="flex flex-col items-center justify-center text-center py-16 px-8 h-full min-h-[420px]">
        <div className="p-4 rounded-3xl bg-blue-50/80 border border-blue-100/50 mb-6 text-brand">
          {route === "dashboard" && <DashboardIcon />}
          {route === "settings" && <SettingsIcon />}
          {route === "plugins" && <PluginsIcon />}
          {route === "integrations" && <IntegrationsIcon />}
          {route === "onboarding" && <OnboardingIcon />}
        </div>
        <h2 className="font-monoDisplay text-2xl font-black mb-2 text-navy">{meta.title}</h2>
        <p className="text-sm text-slatecopy max-w-md mb-6">{meta.description}</p>
        <span className="inline-flex items-center rounded-full bg-blue-50/80 px-4 py-1.5 text-xs font-bold text-brand border border-blue-200/50">
          Coming Soon • Next Migration Target
        </span>
      </GlassCard>
    </div>
  );
}

const filterIcons: Record<Filter, React.ReactNode> = {
  all: <FilterAllIcon />,
  installed: <FilterInstalledIcon />,
  featured: <FilterFeaturedIcon />,
  originals: <FilterOriginalIcon />,
  western: <FilterWesternIcon />,
  asian: <FilterAsianIcon />,
  codex: <FilterCodexIcon />,
};

const filterLabels: Record<Filter, string> = {
  all: "All",
  installed: "Installed",
  featured: "Featured",
  originals: "Originals",
  western: "Western",
  asian: "Asian",
  codex: "Codex",
};

const buttonVariantClass = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  success: "btn-success",
  warning: "btn-warning",
} as const;

const statusPillToneClass = {
  blue: "pill-blue",
  green: "pill-green",
  orange: "pill-orange",
  purple: "pill-purple",
  yellow: "pill-yellow",
  red: "pill-red",
  slate: "pill-slate",
} as const;

function Button({
  children,
  variant = "primary",
  size = "normal",
  onClick,
  disabled,
  icon,
  iconPosition = "left",
  fullWidth
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "success" | "warning";
  size?: "normal" | "compact";
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
}) {
  return (
    <button
      className={`btn ${buttonVariantClass[variant]} ${size === "compact" ? "btn-compact" : ""} ${fullWidth ? "w-full" : ""} ${icon ? "has-icon" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && iconPosition === "left" && <span className="btn-icon-wrapper mr-1.5 inline-flex items-center justify-center">{icon}</span>}
      <span className="btn-text">{children}</span>
      {icon && iconPosition === "right" && <span className="btn-icon-wrapper ml-1.5 inline-flex items-center justify-center">{icon}</span>}
    </button>
  );
}
function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <section className={`glass ${className}`}>{children}</section>; }
function StatusPill({ children, tone = "blue" }: { children: React.ReactNode; tone?: keyof typeof statusPillToneClass }) { return <span className={`pill ${statusPillToneClass[tone]}`}>{children}</span>; }
function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input className="search" placeholder="Search pets..." {...props} />; }

function isAllowedCatalogPreview(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && 
      url.hostname === "openpets.dev" && 
      url.port === "" && 
      url.username === "" && 
      url.password === "" && 
      url.pathname.startsWith("/pets/") && 
      url.pathname.endsWith(".webp");
  } catch {
    return false;
  }
}

function isAllowedCodexPreview(value: string | undefined): value is string {
  return typeof value === "string" && /^openpets-codex:\/\/spritesheet\/[a-zA-Z0-9%][a-zA-Z0-9%_-]{0,128}$/u.test(value);
}

function isAllowedDataUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^data:image\/(?:png|webp|jpeg|jpg);base64,[a-z0-9+/=]+$/iu.test(value);
}

function safePetImage(value: string | undefined): string | undefined {
  return isAllowedCatalogPreview(value) || isAllowedCodexPreview(value) || isAllowedDataUrl(value) ? value : undefined;
}

function imageDebug(value: string | undefined): string {
  if (!value) return "missing";
  if (value.startsWith("data:image/")) return `data:${value.slice(5, 16)}`;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function logPetsEvent(event: string, fields: Record<string, unknown>): void {
  console.info(`[ControlCenterPets] ${JSON.stringify({ event, ...fields })}`);
}

function logPetsError(event: string, fields: Record<string, unknown>): void {
  console.error(`[ControlCenterPets] ${JSON.stringify({ event, ...fields })}`);
}

const spriteFrameSizes = {
  thumb: { width: 54, height: 58 },
  detail: { width: 144, height: 156 },
  mini: { width: 56, height: 61 },
} as const;

const spriteStates = {
  idle: { row: 0, frames: 6, duration: "1.65s" },
  thinking: { row: 8, frames: 6, duration: "1.55s" },
  wave: { row: 3, frames: 4, duration: "1.25s" },
  happy: { row: 4, frames: 5, duration: "1.35s" },
} as const;

function SpriteFrame({ src, label, state = "idle", size = "detail" }: { src?: string; label: string; state?: "idle" | "thinking" | "happy" | "wave"; size?: "thumb" | "detail" | "mini" }) {
  const safeSrc = safePetImage(src);
  if (!safeSrc) return <img src={defaultThumbUrl} alt="" />;
  const frame = spriteFrameSizes[size];
  const sprite = spriteStates[state];
  const xValues = Array.from({ length: sprite.frames }, (_, index) => String(-index * frame.width)).join(";");
  const y = -sprite.row * frame.height;
  return <svg className={`sprite-frame sprite-${state} sprite-${size}`} width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img" aria-label={label}>
    <image href={safeSrc} x="0" y={y} width={frame.width * 8} height={frame.height * 9} preserveAspectRatio="none" onError={() => logPetsError("sprite-failed", { label, state, size, src: imageDebug(safeSrc) })}>
      <animate attributeName="x" values={xValues} dur={sprite.duration} repeatCount="indefinite" calcMode="discrete" />
    </image>
  </svg>;
}

function PetImage({ src, alt = "", debugLabel }: { src?: string; alt?: string; debugLabel: string }) {
  const safeSrc = safePetImage(src) || defaultThumbUrl;
  return <img src={safeSrc} alt={alt} draggable="false" onError={() => logPetsError("image-failed", { label: debugLabel, src: imageDebug(safeSrc) })} />;
}

function ToggleRow({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`settings-row ${disabled ? "opacity-60" : ""}`}>
    <div className="settings-row-info"><strong>{title}</strong><small>{description}</small></div>
    <input className="settings-toggle" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

function formatUpdateStatus(status: UpdateStatus | null): string {
  if (!status) return "Update status has not loaded yet.";
  if (status.state === "checking") return "Checking for updates…";
  if (status.state === "available") return `Version ${status.latestVersion ?? "latest"} is available.`;
  if (status.state === "current") return `Up to date.`;
  if (status.state === "error") return status.error || "Update check failed.";
  return `Version: ${status.currentVersion}.`;
}

function ReactionPreviewSprite({ settings, state }: { settings: ReactionAnimationSettings; state: UserSelectableAnimationState }) {
  const frame = { width: settings.sprite.frameWidth, height: settings.sprite.frameHeight };
  const sprite = settings.sprite.states[state] ?? settings.sprite.states.idle;
  const xValues = Array.from({ length: sprite.frames }, (_, index) => String(-index * frame.width)).join(";");
  const y = -sprite.row * frame.height;

  return (
    <div className="reaction-preview-sprite-shell">
      <svg className="reaction-preview-sprite" width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img" aria-label={`Animation: ${state}`}>
        <image href={settings.previewSpriteUrl} x="0" y={y} width={frame.width * settings.sprite.columns} height={frame.height * settings.sprite.rows} preserveAspectRatio="none">
          <animate attributeName="x" values={xValues} dur={`${sprite.durationMs}ms`} repeatCount="indefinite" calcMode="discrete" />
        </image>
      </svg>
    </div>
  );
}

function SettingsView() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [reactionSettings, setReactionSettings] = useState<ReactionAnimationSettings | null>(null);
  const [launchAtLogin, setLaunchAtLogin] = useState<LaunchAtLoginState | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "reactions">("general");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const reactionSaveQueue = useRef(Promise.resolve());

  async function loadSettings() {
    setError("");
    const [nextSettings, nextReactions, nextLaunch, nextUpdate] = await Promise.all([
      api.getSettingsState(),
      api.getReactionAnimationSettings(),
      api.getLaunchAtLogin(),
      api.getUpdateStatus(),
    ]);
    setSettings(nextSettings);
    setReactionSettings(nextReactions);
    setLaunchAtLogin(nextLaunch);
    setUpdateStatus(nextUpdate);
    if (nextUpdate.state === "checking") {
      void api.checkForUpdates().then(setUpdateStatus).catch((err) => setError(String(err?.message ?? err)));
    }
  }

  useEffect(() => { void loadSettings().catch((err) => setError(String(err?.message ?? err))); }, []);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function run(label: string, fn: () => Promise<void>) {
    try { setBusy(label); setError(""); setMessage(""); await fn(); }
    catch (err) { setError(String((err as Error)?.message ?? err)); }
    finally { setBusy(""); }
  }

  function patchPreferences(patch: Partial<SettingsState["preferences"]>, success: string) {
    void run("Saving", async () => {
      const next = await api.updatePreferences(patch);
      setSettings(next);
      if ("reactionAnimationOverrides" in patch) {
        setReactionSettings((current) => current ? { ...current, overrides: next.preferences.reactionAnimationOverrides ?? {} } : current);
      }
      setMessage(success);
    });
  }

  function updateReactionOverride(reaction: ReactionAnimationSettings["reactions"][number], value: UserSelectableAnimationState) {
    const queuedSave = reactionSaveQueue.current.catch(() => undefined).then(() => run("Saving", async () => {
      const latestReactions = await api.getReactionAnimationSettings();
      const nextOverrides = { ...(latestReactions.overrides ?? {}) };
      if (value === reaction.defaultAnimation) delete nextOverrides[reaction.id];
      else nextOverrides[reaction.id] = value;
      const nextSettings = await api.updatePreferences({ reactionAnimationOverrides: nextOverrides });
      setSettings(nextSettings);
      setReactionSettings({ ...latestReactions, overrides: nextSettings.preferences.reactionAnimationOverrides ?? {} });
      setMessage("Reaction animation saved.");
    }));
    reactionSaveQueue.current = queuedSave;
    void queuedSave;
  }

  const overrides = settings?.preferences.reactionAnimationOverrides ?? {};

  return <div className="settings-layout">
    {error && <div className="error settings-message">{error}</div>}
    {message && <div className="settings-success settings-message">{message}</div>}

    <div className="settings-container">
      <aside className="settings-sidebar">
        <button className={`settings-nav-item ${activeTab === "general" ? "active" : ""}`} onClick={() => setActiveTab("general")}>
          <SettingsIcon />
          <span>General</span>
        </button>
        <button className={`settings-nav-item ${activeTab === "reactions" ? "active" : ""}`} onClick={() => setActiveTab("reactions")}>
          <PetsIcon />
          <span>Reaction Mapping</span>
        </button>
      </aside>

      <main className="settings-content">
        {activeTab === "general" && (
          <div className="settings-section">
            <p className="eyebrow">Environment</p>
            <h2 className="settings-section-title">General Settings</h2>

            <div className="settings-group">
              <ToggleRow
                title="Show pet on launch"
                description="Keep OpenPets in the tray but hide the pet until requested."
                checked={settings?.preferences.openDefaultPetOnLaunch ?? false}
                disabled={!settings || !!busy}
                onChange={(checked) => patchPreferences({ openDefaultPetOnLaunch: checked }, "Startup preference saved.")}
              />
              <ToggleRow
                title="Launch at login"
                description={launchAtLogin?.supported ? "Start OpenPets automatically when your computer starts." : "Not supported on this platform."}
                checked={launchAtLogin?.enabled ?? false}
                disabled={!launchAtLogin?.supported || !!busy}
                onChange={(checked) => void run("Saving", async () => { setLaunchAtLogin(await api.setLaunchAtLogin(checked)); setMessage("Login startup preference saved."); })}
              />
              <div className="settings-row">
                <div className="settings-row-info">
                  <strong>Pet scale</strong>
                  <small>Adjust how large the default desktop pet appears.</small>
                </div>
                <select className="settings-select" value={settings?.preferences.petScale ?? ""} disabled={!settings || !!busy} onChange={(event) => patchPreferences({ petScale: Number(event.target.value) }, "Pet scale saved.")}>
                  {(settings?.petScaleOptions ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </div>

            <div className="settings-actions">
              <Button variant="secondary" size="compact" disabled={!!busy} onClick={() => void run("Resetting", async () => { setSettings(await api.resetDefaultPetPosition()); setMessage("Default pet position reset."); })}>Reset Pet Position</Button>
            </div>

            <div className="settings-system-footer">
              <div className="settings-system-info">
                <RefreshIcon />
                <span>System Status</span>
                <span className="settings-system-version">{updateStatus?.currentVersion}</span>
                <span className="opacity-60">{formatUpdateStatus(updateStatus)}</span>
              </div>
              <div className="flex gap-2">
                {updateStatus?.state === "available" && (
                  <Button variant="primary" size="compact" disabled={!!busy} onClick={() => void run("Opening", async () => { await api.openUpdateReleasePage(); })}>Update Available</Button>
                )}
                <Button variant="secondary" size="compact" disabled={!!busy || updateStatus?.state === "checking"} onClick={() => void run("Checking", async () => { setUpdateStatus(await api.checkForUpdates()); })}>
                  {busy === "Checking" ? "Checking…" : "Check for Updates"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "reactions" && (
          <div className="settings-section">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Behavior</p>
                <h2 className="settings-section-title">Reaction Mapping</h2>
              </div>
              <Button variant="secondary" size="compact" disabled={!settings || !!busy || !Object.keys(overrides).length} onClick={() => patchPreferences({ reactionAnimationOverrides: {} }, "Reaction animations reset.")}>Reset to Defaults</Button>
            </div>
            <p className="text-sm text-slatecopy -mt-2 mb-2">Customize which animation plays for each agent reaction. Previews use the default pet.</p>

            <div className="settings-group">
              <div className="reaction-grid">
                {(reactionSettings?.reactions ?? []).map((reaction) => {
                  const currentAnimation = overrides[reaction.id] ?? reaction.defaultAnimation;
                  return (
                    <div className="reaction-row" key={reaction.id}>
                      <div className="reaction-preview-box">
                        {reactionSettings?.previewSpriteUrl && (
                          <ReactionPreviewSprite settings={reactionSettings} state={currentAnimation} />
                        )}
                      </div>
                      <div className="reaction-info">
                        <strong>{reaction.label}</strong>
                        <small>{reaction.description}</small>
                      </div>
                      <select
                        className="settings-select"
                        value={currentAnimation}
                        disabled={!reactionSettings || !settings || !!busy}
                        onChange={(event) => {
                          const value = event.target.value as UserSelectableAnimationState;
                          updateReactionOverride(reaction, value);
                        }}
                      >
                        {(reactionSettings?.animations ?? []).map((animation) => (
                          <option key={animation.id} value={animation.id}>{animation.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  </div>;
}

const pluginFilterLabels: Record<PluginFilter, string> = {
  all: "All",
  installed: "Installed",
  catalog: "Catalog",
  local: "Local / Dev",
  broken: "Broken",
};

const pluginPermissionLabels: Record<PluginPermission, string> = {
  "pet:speak": "Speech",
  "pet:reaction": "Reactions",
  timer: "Timers",
  schedule: "Schedule",
  storage: "Storage",
  status: "Status",
  commands: "Commands",
  network: "Network",
};

const pluginStatusTone: Record<NonNullable<PluginStatus["tone"]>, keyof typeof statusPillToneClass> = {
  info: "blue",
  success: "green",
  warning: "orange",
  error: "red",
};

function PluginGlyph({ className = "plugin-glyph" }: { className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 3 6.5l9 4.5 9-4.5z" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 17.5 9 4.5 9-4.5" />
  </svg>;
}

function pluginName(entry: PluginEntry): string {
  return entry.installed?.name || entry.catalog?.name || entry.id;
}

function pluginDescription(entry: PluginEntry): string {
  if (entry.installed?.brokenReason) return entry.installed.brokenReason;
  return entry.catalog?.description || (entry.installed ? "Installed plugin ready for configuration." : "Available from the plugin catalog.");
}

function pluginPrimaryTone(entry: PluginEntry): keyof typeof statusPillToneClass {
  if (entry.installed?.brokenReason) return "red";
  if (entry.installed?.catalogDisabled) return "orange";
  if (entry.installed?.enabled) return "green";
  if (entry.installed) return "slate";
  return "blue";
}

function pluginPrimaryLabel(entry: PluginEntry): string {
  if (entry.installed?.brokenReason) return "Broken";
  if (entry.installed?.catalogDisabled) return "Catalog disabled";
  if (entry.installed?.enabled) return "Active";
  if (entry.installed) return "Disabled";
  return "Available";
}

function mergePluginEntries(snapshot: PluginServiceSnapshot | null, catalog: PluginCatalogSnapshot | null): PluginEntry[] {
  const merged = new Map<string, PluginEntry>();
  for (const installed of snapshot?.plugins ?? []) merged.set(installed.id, { id: installed.id, installed });
  for (const catalogPlugin of catalog?.plugins ?? []) {
    const current = merged.get(catalogPlugin.id) ?? { id: catalogPlugin.id };
    merged.set(catalogPlugin.id, { ...current, catalog: catalogPlugin });
  }
  return [...merged.values()].sort((a, b) => {
    const installedDelta = Number(Boolean(b.installed)) - Number(Boolean(a.installed));
    if (installedDelta) return installedDelta;
    return pluginName(a).localeCompare(pluginName(b));
  });
}

function initialConfigValue(field: PluginConfigField): unknown {
  if (field.default !== undefined) return field.default;
  if (field.type === "boolean") return false;
  if (field.type === "number") return field.min ?? 0;
  if (field.type === "multiSelect" || field.type === "list") return [];
  return "";
}

function materializeListItemDefaults(schema: PluginConfigSchema, value: Record<string, unknown> = {}): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) next[key] = materializeConfigValue(field, value[key]);
  return next;
}

function materializeConfigValue(field: PluginConfigField, value: unknown): unknown {
  if (field.type === "list" && field.itemSchema) {
    const items = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
    return items.map((item) => materializeListItemDefaults(field.itemSchema ?? {}, item));
  }
  return value ?? initialConfigValue(field);
}

function materializeConfigDraft(schema: PluginConfigSchema | undefined, config: PluginConfig | undefined): PluginConfig {
  const next: PluginConfig = {};
  for (const [key, field] of Object.entries(schema ?? {})) next[key] = materializeConfigValue(field, config?.[key]);
  return next;
}

function ConfigFieldEditor({ fieldKey, field, value, onChange }: { fieldKey: string; field: PluginConfigField; value: unknown; onChange: (value: unknown) => void }) {
  const label = field.label || fieldKey;
  const description = field.description;
  const textValue = typeof value === "string" ? value : typeof field.default === "string" ? field.default : "";

  if (field.type === "boolean") {
    return <label className="plugin-config-row plugin-config-row-boolean">
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
      <input className="settings-toggle" type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
    </label>;
  }

  if (field.type === "list" && field.itemSchema) {
    const items = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
    const maxed = typeof field.maxItems === "number" && items.length >= field.maxItems;
    return <div className="plugin-config-row">
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
      <div className="plugin-list-editor">
        {items.map((item, index) => (
          <div className="plugin-list-item" key={index}>
            <div className="plugin-list-item-header"><span>Item {index + 1}</span><Button variant="danger" size="compact" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>
            {Object.entries(field.itemSchema ?? {}).map(([childKey, childField]) => (
              <ConfigFieldEditor key={childKey} fieldKey={childKey} field={childField} value={item[childKey] ?? initialConfigValue(childField)} onChange={(nextValue) => onChange(items.map((existing, itemIndex) => itemIndex === index ? { ...existing, [childKey]: nextValue } : existing))} />
            ))}
          </div>
        ))}
        <Button variant="secondary" size="compact" disabled={maxed} onClick={() => onChange([...items, materializeListItemDefaults(field.itemSchema ?? {})])}>Add Item</Button>
      </div>
    </div>;
  }

  return <label className="plugin-config-row">
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    {field.type === "textarea" ? (
      <textarea className="plugin-input plugin-textarea" value={textValue} maxLength={field.maxLength} onChange={(event) => onChange(event.target.value)} />
    ) : field.type === "select" ? (
      <select className="settings-select plugin-select" value={textValue} onChange={(event) => onChange(event.target.value)}>
        {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label || option.value}</option>)}
      </select>
    ) : field.type === "multiSelect" ? (
      <span className="plugin-chip-list">
        {(field.options ?? []).map((option) => {
          const selected = Array.isArray(value) && value.includes(option.value);
          return <button type="button" key={option.value} className={`plugin-chip ${selected ? "active" : ""}`} onClick={() => {
            const current = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
            onChange(selected ? current.filter((item) => item !== option.value) : [...current, option.value]);
          }}>{option.label || option.value}</button>;
        })}
      </span>
    ) : (
      <input className="plugin-input" type={field.type === "number" ? "number" : field.type === "time" ? "time" : "text"} value={field.type === "number" && typeof value === "number" ? String(value) : textValue} min={field.min} max={field.max} step={field.step} maxLength={field.maxLength} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)} />
    )}
  </label>;
}

function PluginsView() {
  const [snapshot, setSnapshot] = useState<PluginServiceSnapshot | null>(null);
  const [catalog, setCatalog] = useState<PluginCatalogSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [configDraft, setConfigDraft] = useState<PluginConfig>({});

  async function load(refreshCatalog = false, clearMessages = true) {
    if (clearMessages) setError("");
    const [nextSnapshot, nextCatalog] = await Promise.all([
      api.getPluginsSnapshot(),
      api.getPluginCatalogSnapshot(refreshCatalog).catch(() => ({ plugins: [] } as PluginCatalogSnapshot)),
    ]);
    setSnapshot(nextSnapshot);
    setCatalog(nextCatalog);
    const entries = mergePluginEntries(nextSnapshot, nextCatalog);
    setSelectedId((current) => entries.some((entry) => entry.id === current) ? current : "");
  }

  useEffect(() => { void load().catch((err) => setError(String(err?.message ?? err))); }, []);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const entries = useMemo(() => mergePluginEntries(snapshot, catalog), [snapshot, catalog]);
  const selected = entries.find((entry) => entry.id === selectedId);
  const installed = selected?.installed;
  const catalogPlugin = selected?.catalog;

  useEffect(() => { setConfigDraft(materializeConfigDraft(installed?.configSchema, installed?.effectiveConfig)); }, [installed?.id, installed?.configSchema, installed?.effectiveConfig]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filter === "installed" && !entry.installed) return false;
      if (filter === "catalog" && entry.installed) return false;
      if (filter === "local" && entry.installed?.source !== "local") return false;
      if (filter === "broken" && !entry.installed?.brokenReason) return false;
      return true;
    });
  }, [entries, filter]);

  async function run(label: string, fn: () => Promise<void>) {
    try { setBusy(label); setError(""); setMessage(""); await fn(); }
    catch (err) { setError(String((err as Error)?.message ?? err)); }
    finally { setBusy(""); }
  }

  function applyResult(result: PluginServiceResult, success?: string) {
    setSnapshot(result.snapshot);
    if (!result.ok) { setError(result.error); return false; }
    if (success) setMessage(success);
    return true;
  }

  function updateDraft(key: string, value: unknown) {
    setConfigDraft((current) => ({ ...current, [key]: value }));
  }

  async function installCatalogEntry(entry: PluginEntry) {
    const result = await api.installCatalogPlugin(entry.id);
    if (!applyResult(result)) return;
    const installedPlugin = result.snapshot.plugins.find((plugin) => plugin.id === entry.id);
    if (!installedPlugin) { setMessage("No plugin installed."); return; }
    await load(false, false);
    setMessage("Plugin installed.");
  }

  async function updateCatalogEntry(plugin: SafePluginRecord) {
    const previousVersion = plugin.version;
    const result = await api.updateCatalogPlugin(plugin.id);
    if (!applyResult(result)) return;
    const updatedPlugin = result.snapshot.plugins.find((nextPlugin) => nextPlugin.id === plugin.id);
    setMessage(updatedPlugin && updatedPlugin.version !== previousVersion ? "Plugin updated." : "No plugin update applied.");
  }

  return <div className="plugins-layout">
    {error && <div className="error settings-message">{error}</div>}
    {message && <div className="settings-success settings-message">{message}</div>}
    <GlassCard className="plugins-hub">
      <div className="filters">
        {(["all", "installed", "catalog", "local", "broken"] as PluginFilter[]).map((nextFilter) => (
          <button key={nextFilter} className={`filter ${filter === nextFilter ? "active" : ""}`} onClick={() => setFilter(nextFilter)}>{pluginFilterLabels[nextFilter]}</button>
        ))}
      </div>
      <div className="plugin-grid">
        {filteredEntries.map((entry) => (
          <article key={entry.id} className={`plugin-card ${entry.installed?.brokenReason ? "broken" : ""}`}>
            <div className="plugin-card-body">
              <span className="plugin-card-icon"><PluginGlyph /></span>
              <div className="plugin-card-content">
                <strong>{pluginName(entry)}</strong>
                <small>{pluginDescription(entry)}</small>
                <div className="badges mt-1">
                  <StatusPill tone={pluginPrimaryTone(entry)}>{pluginPrimaryLabel(entry)}</StatusPill>
                  {entry.installed?.source === "local" && <StatusPill tone="orange">Local</StatusPill>}
                  {entry.installed?.runtime === "javascript" || entry.catalog?.runtime === "javascript" ? <StatusPill tone="purple">JS</StatusPill> : <StatusPill tone="slate">Declarative</StatusPill>}
                </div>
              </div>
            </div>

            <div className="plugin-card-footer">
              <div className="plugin-card-meta">
                <span className="text-[10px] font-bold text-slatecopy/50 uppercase tracking-tight">v{entry.installed?.version || entry.catalog?.version}</span>
              </div>

              <div className="plugin-card-actions">
                {entry.installed && (
                  <div className="plugin-card-toggle-zone">
                    <span className="plugin-card-toggle-label">{entry.installed.enabled ? "Active" : "Off"}</span>
                    <input
                      className="settings-toggle plugin-card-toggle"
                      type="checkbox"
                      checked={entry.installed.enabled}
                      disabled={!!busy || entry.installed.catalogDisabled || Boolean(entry.installed.brokenReason)}
                      onChange={(event) => void run("Saving", async () => {
                        applyResult(await api.setPluginEnabled(entry.id, event.target.checked), event.target.checked ? "Plugin enabled." : "Plugin disabled.");
                      })}
                    />
                  </div>
                )}

                {entry.installed ? (
                  <Button variant="secondary" size="compact" icon={<ConfigureIcon />} disabled={!!busy} onClick={() => setSelectedId(entry.id)}>Configure</Button>
                ) : (
                  <Button variant="primary" size="compact" icon={<InstallIcon />} disabled={!!busy || entry.catalog?.deprecated} onClick={() => void run("Installing", async () => { await installCatalogEntry(entry); })}>Install Plugin</Button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!filteredEntries.length && <div className="plugin-empty"><PluginGlyph /><strong>No plugins found</strong><small>Try a different filter, refresh the catalog, or load a local plugin folder.</small></div>}
      </div>
      <div className="plugin-hub-footer">
        <span><strong>{snapshot?.plugins.length ?? 0}</strong> installed · <strong>{catalog?.plugins.length ?? 0}</strong> catalog</span>
        <span className="plugin-hub-actions">
          <Button variant="secondary" size="compact" disabled={!!busy} icon={<RefreshIcon />} onClick={() => void run("Refreshing", async () => { await load(true); setMessage("Plugin catalog refreshed."); })}>Refresh</Button>
          <Button variant="secondary" size="compact" icon={<FolderPlusIcon />} disabled={!!busy} onClick={() => void run("Loading", async () => {
            const beforeIds = new Set(snapshot?.plugins.map((plugin) => plugin.id) ?? []);
            const result = await api.loadLocalPlugin();
            if (!applyResult(result)) return;
            const loadedPlugin = result.snapshot.plugins.find((plugin) => plugin.source === "local" && !beforeIds.has(plugin.id));
            setMessage(loadedPlugin ? "Local plugin loaded." : "No local plugin loaded.");
          })}>Load Local Plugin</Button>
        </span>
      </div>
    </GlassCard>
    {selected && <div className="plugin-config-overlay" role="dialog" aria-modal="true" aria-label={`${pluginName(selected)} configuration`}>
      <button className="plugin-config-backdrop" type="button" aria-label="Close plugin configuration" onClick={() => setSelectedId("")} />
      <GlassCard className="plugin-inspector">
      {selected ? <>
        <div className="plugin-inspector-head">
          <span className="plugin-inspector-icon"><PluginGlyph /></span>
          <div className="flex-1 min-w-0"><p className="eyebrow">Plugin Configuration</p><h2>{pluginName(selected)}</h2><p className="desc">{pluginDescription(selected)}</p></div>
          <Button variant="secondary" size="compact" icon={<CloseIcon />} onClick={() => setSelectedId("")}>Close</Button>
        </div>
        <div className="meta">
          <StatusPill tone={pluginPrimaryTone(selected)}>{pluginPrimaryLabel(selected)}</StatusPill>
          <StatusPill tone="slate">v{installed?.version ?? catalogPlugin?.version}</StatusPill>
          {installed?.source === "local" && <StatusPill tone="orange">Local</StatusPill>}
          {(installed?.catalogDeprecated || catalogPlugin?.deprecated) && <StatusPill tone="orange">Deprecated</StatusPill>}
        </div>
        {(installed?.catalogStatusReason || catalogPlugin?.statusReason || installed?.status?.text) && <div className="plugin-status-strip">
          {installed?.status?.text && <StatusPill tone={installed.status.tone ? pluginStatusTone[installed.status.tone] : "blue"}>{installed.status.text}</StatusPill>}
          <span>{installed?.catalogStatusReason || catalogPlugin?.statusReason}</span>
        </div>}
        {installed ? <>
          <section className="plugin-section">
            <div className="plugin-section-title"><small>Runtime</small><strong>State & permissions</strong></div>
            <label className="settings-row plugin-toggle-row">
              <div className="settings-row-info"><strong>{installed.enabled ? "Enabled" : "Disabled"}</strong><small>{installed.brokenReason || (installed.catalogDisabled ? "This plugin is disabled by the catalog." : "Toggle this plugin without leaving the Control Center.")}</small></div>
              <input className="settings-toggle" type="checkbox" checked={installed.enabled} disabled={!!busy || installed.catalogDisabled} onChange={(event) => void run("Saving", async () => { applyResult(await api.setPluginEnabled(installed.id, event.target.checked), event.target.checked ? "Plugin enabled." : "Plugin disabled."); })} />
            </label>
            <div className="badges plugin-permissions">{installed.approvedPermissions.length ? installed.approvedPermissions.map((permission) => <StatusPill key={permission} tone={permission === "network" ? "orange" : "blue"}>{pluginPermissionLabels[permission]}</StatusPill>) : <StatusPill tone="slate">No permissions</StatusPill>}</div>
          </section>
          {!!installed.configErrors?.length && <section className="plugin-section plugin-section-danger"><div className="plugin-section-title"><small>Configuration</small><strong>Needs attention</strong></div><ul>{installed.configErrors.map((configError, index) => <li key={index}>{configError.message || String(configError)}</li>)}</ul></section>}
          {installed.configSchema && <section className="plugin-section">
            <div className="plugin-section-title"><small>Settings</small><strong>Configuration</strong></div>
            <div className="plugin-config-form">{Object.entries(installed.configSchema).map(([key, field]) => <ConfigFieldEditor key={key} fieldKey={key} field={field} value={configDraft[key] ?? initialConfigValue(field)} onChange={(value) => updateDraft(key, value)} />)}</div>
            <Button variant="primary" fullWidth icon={<SaveIcon />} disabled={!!busy} onClick={() => void run("Saving", async () => { applyResult(await api.savePluginConfig(installed.id, configDraft), "Plugin configuration saved."); })}>Save Configuration</Button>
          </section>}
          {!!installed.commands?.length && <section className="plugin-section"><div className="plugin-section-title"><small>Commands</small><strong>Quick actions</strong></div><div className="plugin-command-list">{installed.commands.map((command) => <Button key={command.id} variant="secondary" size="compact" disabled={!!busy} onClick={() => void run("Running", async () => { applyResult(await api.executePluginCommand(installed.id, command.id), "Plugin command ran."); })}>{command.title}</Button>)}</div></section>}
          <section className="plugin-section plugin-actions-section">
            <Button variant="secondary" disabled={!!busy} icon={<RefreshIcon />} onClick={() => void run("Reloading", async () => { applyResult(await api.reloadPlugin(installed.id), "Plugin reloaded."); })}>Reload</Button>
            {installed.source === "catalog" && catalogPlugin && catalogPlugin.version !== installed.version && <Button variant="primary" icon={<InstallIcon />} disabled={!!busy} onClick={() => void run("Updating", async () => { await updateCatalogEntry(installed); })}>Update</Button>}
            <Button variant="danger" icon={<RemoveIcon />} disabled={!!busy} onClick={() => { if (window.confirm(`Uninstall ${pluginName(selected)}?`)) void run("Uninstalling", async () => { if (applyResult(await api.uninstallPlugin(installed.id), "Plugin uninstalled.")) setSelectedId(""); }); }}>Uninstall</Button>
          </section>
        </> : <section className="plugin-section">
          <div className="plugin-section-title"><small>Catalog</small><strong>Ready to install</strong></div>
          <p className="desc">Install this plugin to approve its permissions and make it available in your desktop companion.</p>
          <div className="badges plugin-permissions">{catalogPlugin?.permissions.map((permission) => <StatusPill key={permission} tone={permission === "network" ? "orange" : "blue"}>{pluginPermissionLabels[permission]}</StatusPill>)}</div>
          <Button variant="primary" fullWidth icon={<InstallIcon />} disabled={!!busy || catalogPlugin?.deprecated} onClick={() => void run("Installing", async () => { await installCatalogEntry(selected); })}>Install Plugin</Button>
        </section>}
      </> : <div className="plugin-empty plugin-empty-detail"><PluginGlyph /><strong>No plugin selected</strong><small>Install a catalog plugin or load a local folder to begin.</small></div>}
      </GlassCard>
    </div>}
  </div>;
}

function App() {
  const [currentRoute, setCurrentRoute] = useState<Route>("pets");
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [catalogPages, setCatalogPages] = useState<Record<number, PetEntry[]>>({});
  const [catalogSearch, setCatalogSearch] = useState<SearchPetEntry[] | null>(null);
  const [catalogPage, setCatalogPage] = useState(0);
  const [codex, setCodex] = useState<CodexState>({ pets: [] });
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const [nextState, nextCatalog, nextCodex] = await Promise.all([api.getPetsState(), api.getCatalog(), api.getCodexPets()]);
    logPetsEvent("load-complete", { installed: nextState.pets.installed.length, defaultPetId: nextState.preferences.defaultPetId, catalogSource: nextCatalog.source, catalogPets: nextCatalog.pets.length, catalogPage: nextCatalog.page, catalogPageCount: nextCatalog.pageCount, codexPets: nextCodex.pets.length, catalogError: nextCatalog.error, codexError: nextCodex.error, firstCatalogPet: nextCatalog.pets[0] ? { id: nextCatalog.pets[0].id, preview: imageDebug(nextCatalog.pets[0].preview), thumbnail: imageDebug(nextCatalog.pets[0].thumbnail), spritesheet: imageDebug(nextCatalog.pets[0].spritesheet) } : null });
    setState(nextState); setCatalog(nextCatalog); setCodex(nextCodex);
    setCatalogPage(nextCatalog.page ?? 0);
    setCatalogPages({ [nextCatalog.page ?? 0]: nextCatalog.pets });
    setSelectedId((current) => current || nextState.preferences.defaultPetId || nextState.pets.installed[0]?.id || nextCatalog.pets[0]?.id || "");
  }
  useEffect(() => { void load().catch((err) => setError(String(err?.message ?? err))); }, []);

  const pets = useMemo(() => {
    const installed = new Map((state?.pets.installed ?? []).map((p) => [p.id, p]));
    const catalogMap = new Map<string, PetEntry>();
    for (const pagePets of Object.values(catalogPages)) {
      for (const p of pagePets) {
        catalogMap.set(p.id, p);
      }
    }
    const codexMap = new Map<string, PetEntry>((codex.pets ?? []).map((p) => [p.id, p]));

    const rows: PetEntry[] = (state?.pets.installed ?? []).map((p) => {
      const catalogPet = catalogMap.get(p.id);
      const codexPet = codexMap.get(p.id);
      const spritesheet = safePetImage(codexPet?.spritesheet) || safePetImage(catalogPet?.spritesheet);
      const preview = safePetImage(codexPet?.preview) || safePetImage(catalogPet?.preview) || safePetImage(catalogPet?.thumbnail) || safePetImage(p.source && "preview" in p.source ? (p.source as { preview?: string }).preview : undefined) || defaultThumbUrl;
      const category = catalogPet?.category;
      const original = catalogPet?.original;
      const featured = catalogPet?.featured;
      return {
        ...p,
        spritesheet,
        preview,
        category,
        original,
        featured,
        sourceKind: "installed" as const,
        installed: true,
      };
    });

    for (const p of catalogMap.values()) {
      if (!installed.has(p.id)) {
        rows.push({
          ...p,
          preview: safePetImage(p.preview) || safePetImage(p.thumbnail) || defaultThumbUrl,
          spritesheet: safePetImage(p.spritesheet),
          sourceKind: "catalog",
          installed: false,
        });
      }
    }

    for (const p of codexMap.values()) {
      if (!installed.has(p.id) && !catalogMap.has(p.id)) {
        rows.push({
          ...p,
          preview: safePetImage(p.preview),
          spritesheet: safePetImage(p.spritesheet),
          sourceKind: "codex",
          installed: false,
        });
      }
    }

    return rows.filter((p) => {
      if (filter === "installed" && !p.installed) return false;
      if (filter === "codex" && p.sourceKind !== "codex" && !(installed.get(p.id)?.source?.kind === "codex")) return false;
      if (filter === "originals" && !p.original && !p.builtIn) return false;
      if (filter === "featured" && (!p.featured || p.original)) return false;
      if ((filter === "western" || filter === "asian") && (p.category !== filter || p.featured || p.original)) return false;
      const q = query.trim().toLowerCase();
      return !q || `${p.displayName} ${p.description ?? ""} ${p.searchText ?? ""} ${p.id}`.toLowerCase().includes(q);
    });
  }, [state, catalogPages, catalogSearch, codex, filter, query]);

  const selected = pets.find((p) => p.id === selectedId) ?? pets[0];
  const defaultId = state?.preferences.defaultPetId;

  useEffect(() => {
    if (!selected) return;
    logPetsEvent("selected-pet", { id: selected.id, sourceKind: selected.sourceKind, installed: selected.installed, builtIn: selected.builtIn, preview: imageDebug(selected.preview), spritesheet: imageDebug(selected.spritesheet), hasSafePreview: Boolean(safePetImage(selected.preview)), hasSafeSpritesheet: Boolean(safePetImage(selected.spritesheet)), catalogPages: Object.keys(catalogPages).join(",") });
  }, [selected]);

  const statusText = useMemo(() => {
    if (!selected) return "";
    const isDefault = selected.id === defaultId;
    const isCodex = selected.sourceKind === "codex" || (state?.pets.installed.find(p => p.id === selected.id)?.source?.kind === "codex");
    if (selected.broken) return selected.brokenReason || "This installed pet is broken and cannot be selected as default.";
    if (isDefault) return selected.protected ? "Default built-in pet. Protected from removal." : "Default pet.";
    if (selected.installed) {
      if (isCodex) return "Installed and ready to become your default pet. Also found in ~/.codex/pets.";
      return "Installed and ready to become your default pet.";
    }
    if (selected.sourceKind === "codex") return "Available to import from ~/.codex/pets.";
    return "Available to install from the catalog.";
  }, [selected, defaultId, state]);

  async function act(label: string, fn: () => Promise<unknown>) {
    if (!selected) return;
    try { setBusy(label); setError(""); await fn(); await load(); }
    catch (err) { setError(String((err as Error)?.message ?? err)); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    if (catalogSearch) return;
    void api.getCatalogSearch().then((result) => {
      if (result.error) setError(result.error);
      setCatalogSearch(result.pets ?? []);
    }).catch((err) => setError(String(err?.message ?? err)));
  }, [catalogSearch]);

  useEffect(() => {
    if (!catalogSearch) return;
    const q = query.trim().toLowerCase();
    const needsRemotePages = !!q || filter === "featured" || filter === "originals" || filter === "western" || filter === "asian";
    
    const pages = new Set<number>();
    
    if (state?.pets.installed) {
      for (const p of state.pets.installed) {
        const searchPet = catalogSearch.find(sp => sp.id === p.id);
        if (searchPet && typeof searchPet.catalogPage === "number" && !catalogPages[searchPet.catalogPage]) {
          pages.add(searchPet.catalogPage);
        }
      }
    }

    if (needsRemotePages) {
      for (const pet of catalogSearch) {
        if (pages.size >= 12) break;
        if ((filter === "western" || filter === "asian") && (pet.category !== filter || pet.featured || pet.original)) continue;
        if (filter === "originals" && !pet.original) continue;
        if (filter === "featured" && (!pet.featured || pet.original)) continue;
        if (q && !`${pet.displayName} ${pet.searchText ?? ""} ${pet.id}`.toLowerCase().includes(q)) continue;
        if (typeof pet.catalogPage === "number" && !catalogPages[pet.catalogPage]) pages.add(pet.catalogPage);
      }
    }
    
    if (!pages.size) return;
    let cancelled = false;
    void Promise.all([...pages].map((page) => api.getCatalogPage(page).catch((err) => ({ source: "error", pets: [], error: String((err as Error)?.message ?? err), page } as CatalogState)))).then((results) => {
      if (cancelled) return;
      setCatalogPages((current) => {
        const next = { ...current };
        for (const result of results) if (result.source !== "error") next[result.page ?? 0] = result.pets;
        return next;
      });
      const firstError = results.find((result) => result.source === "error")?.error;
      if (firstError) setError(firstError);
    });
    return () => { cancelled = true; };
  }, [catalogPages, catalogSearch, filter, query, state]);

  async function loadCatalogPage(page: number) {
    if (catalogPages[page]) { setCatalogPage(page); return; }
    try {
      setBusy("Loading page"); setError("");
      const next = await api.getCatalogPage(page);
      setCatalog(next); setCatalogPage(next.page ?? page); setCatalogPages((pages) => ({ ...pages, [next.page ?? page]: next.pets }));
    } catch (err) { setError(String((err as Error)?.message ?? err)); }
    finally { setBusy(""); }
  }

  const currentMeta = routeMetadata[currentRoute];

  return <main className="app-shell">
    <header className="hero">
      <div className="hero-content">
        <p className="eyebrow">Control Center Preview</p>
        <h1>{currentMeta.title}</h1>
        <p className="hero-desc">{currentMeta.description}</p>
      </div>
      <div className="hero-logo-container">
        <img src={openPetsLogoUrl} className="hero-brand-logo" alt="OpenPets" />
      </div>
    </header>

    <nav className="nav-bar">
      {navTabs.map((tab) => (
        <button
          key={tab.id}
          className={`nav-tab ${currentRoute === tab.id ? "active" : ""}`}
          onClick={() => setCurrentRoute(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>

    {error && <div className="error">{error}</div>}

    {currentRoute === "settings" ? (
      <SettingsView />
    ) : currentRoute === "plugins" ? (
      <PluginsView />
    ) : currentRoute !== "pets" ? (
      <PlaceholderView route={currentRoute} />
    ) : (
      <div className="layout">
        <GlassCard className="gallery">
          <div className="toolbar"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="filters">
            {(["all", "installed", "featured", "originals", "western", "asian", "codex"] as Filter[]).map((f) => (
              <button
                key={f}
                className={`filter ${filter === f ? "active" : ""} ${f === "originals" ? "original" : ""} ${f === "featured" ? "featured" : ""}`}
                onClick={() => setFilter(f)}
              >
                <span className="filter-icon-wrapper">{filterIcons[f]}</span>
                <span className="filter-text">{filterLabels[f]}</span>
              </button>
            ))}
          </div>
          <div className="pets-grid">{pets.map((pet) => {
            const isBuiltIn = pet.builtIn;
            const hasDistinctPreview = pet.preview && pet.preview !== pet.spritesheet;
            const useSpritesheetFrame = !isBuiltIn && !hasDistinctPreview && !!pet.spritesheet;
            return (
              <button key={`${pet.sourceKind}-${pet.id}`} className={`pet-card ${selected?.id === pet.id ? "selected" : ""}`} onClick={() => setSelectedId(pet.id)}>
                <span className="thumb">
                  {useSpritesheetFrame ? (
                    <SpriteFrame src={pet.spritesheet} label={`${pet.displayName} thumbnail`} size="thumb" />
                  ) : (
                    <PetImage src={pet.preview} debugLabel={`${pet.id}:card`} />
                  )}
                </span>
                <div className="card-content">
                  <span className="card-title-row">
                    <b className="card-title">{pet.displayName}</b>
                  </span>
                  <p className="card-desc">{pet.description || pet.id}</p>
                  <div className="badges">{pet.id === defaultId && <StatusPill tone="green">Default</StatusPill>}{pet.original || pet.builtIn ? <StatusPill tone="yellow">Original</StatusPill> : pet.featured ? <StatusPill tone="purple">Featured</StatusPill> : null}{pet.category === "western" && !pet.original && !pet.featured && <StatusPill tone="slate">Western</StatusPill>}{pet.category === "asian" && !pet.original && !pet.featured && <StatusPill tone="slate">Asian</StatusPill>}{pet.installed && <StatusPill>Installed</StatusPill>}{pet.sourceKind === "codex" && <StatusPill tone="orange">Codex</StatusPill>}</div>
                </div>
              </button>
            );
          })}</div>
          <div className="pager">
            {!!catalog?.pageCount && catalog.pageCount > 1 ? (
              <Button
                variant="secondary"
                size="compact"
                icon={<PrevIcon />}
                disabled={!!busy || catalogPage <= 0}
                onClick={() => void loadCatalogPage(catalogPage - 1)}
              >
                Prev
              </Button>
            ) : <span />}
            <span className="pager-text">{pets.length} pets{!!catalog?.pageCount && catalog.pageCount > 1 ? ` · Page ${catalogPage + 1} of ${catalog.pageCount}` : ""}</span>
            {!!catalog?.pageCount && catalog.pageCount > 1 ? (
              <Button
                variant="secondary"
                size="compact"
                icon={<NextIcon />}
                iconPosition="right"
                disabled={!!busy || catalogPage >= catalog.pageCount - 1}
                onClick={() => void loadCatalogPage(catalogPage + 1)}
              >
                Next
              </Button>
            ) : <span />}
          </div>
        </GlassCard>
        <GlassCard className="detail">
          {selected ? <><p className="eyebrow">Pet detail</p><h2>{selected.displayName}</h2><p className="desc">{selected.description || selected.id}</p>
            <div className="stage">
              {safePetImage(selected.spritesheet) ? (
                <SpriteFrame src={selected.spritesheet} label={`${selected.displayName} animated preview`} />
              ) : (
                <PetImage src={selected.preview} debugLabel={`${selected.id}:detail-fallback`} />
              )}
            </div>
            <div className="meta">
              {selected.broken && <StatusPill tone="red">Broken</StatusPill>}
              {selected.installed && !selected.broken && <StatusPill tone="green">Ready</StatusPill>}
              {selected.builtIn && <StatusPill tone="orange">Originals</StatusPill>}
              {selected.original && !selected.builtIn && <StatusPill tone="yellow">Original</StatusPill>}
              {selected.featured && !selected.original && <StatusPill tone="purple">Featured</StatusPill>}
              {selected.category === "western" && !selected.original && !selected.featured && <StatusPill tone="slate">Western</StatusPill>}
              {selected.category === "asian" && !selected.original && !selected.featured && <StatusPill tone="slate">Asian</StatusPill>}
            </div>
            {statusText && <p className="text-sm text-slatecopy mt-3 mb-0 font-medium">{statusText}</p>}
            
            {safePetImage(selected.spritesheet) && (
              <>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slatecopy mt-6 mb-3">Preview Animations</h3>
                <div className="grid grid-cols-3 gap-3 mb-2">
                  {[
                    { label: "Thinking", state: "thinking" as const },
                    { label: "Happy", state: "happy" as const },
                    { label: "Wave", state: "wave" as const }
                  ].map((preview) => (
                    <div key={preview.label} className="flex flex-col items-center gap-2 rounded-2xl border border-blue-100 bg-white/50 p-3 shadow-sm">
                      <SpriteFrame src={selected.spritesheet} label={`${selected.displayName} ${preview.label} preview`} state={preview.state} size="mini" />
                      <span className="text-xs font-bold text-slatecopy">{preview.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="actions-container mt-6 flex flex-col gap-3">
              {/* Main Action (Install, Import, Set Default) */}
              {!selected.installed && selected.sourceKind === "catalog" && (
                <Button
                  variant="primary"
                  fullWidth
                  icon={<InstallIcon />}
                  disabled={!!busy}
                  onClick={() => act("Installing", () => api.installPet(selected.id))}
                >
                  {busy || "Install Pet"}
                </Button>
              )}
              {!selected.installed && selected.sourceKind === "codex" && (
                <Button
                  variant="warning"
                  fullWidth
                  icon={<ImportIcon />}
                  disabled={!!busy}
                  onClick={() => act("Importing", () => api.importCodexPet(selected.id))}
                >
                  {busy || "Import Codex Pet"}
                </Button>
              )}
              {selected.installed && selected.id !== defaultId && !selected.broken && (
                <Button
                  variant="primary"
                  fullWidth
                  icon={<SetDefaultIcon />}
                  disabled={!!busy}
                  onClick={() => act("Setting default", () => api.setDefaultPet(selected.id))}
                >
                  {busy || "Set Default Pet"}
                </Button>
              )}

              {/* Secondary Actions (Remove, Refresh) */}
              <div className={`grid gap-3 ${selected.installed && !selected.builtIn && !selected.protected ? "grid-cols-2" : "grid-cols-1"}`}>
                {selected.installed && !selected.builtIn && !selected.protected && (
                  <Button
                    variant="danger"
                    icon={<RemoveIcon />}
                    disabled={!!busy}
                    onClick={() => act("Removing", () => api.removePet(selected.id))}
                  >
                    Remove
                  </Button>
                )}
                <Button
                  variant="secondary"
                  icon={<RefreshIcon />}
                  disabled={!!busy}
                  onClick={() => void load()}
                >
                  Refresh
                </Button>
              </div>
            </div></> : <p>No pets available.</p>}
        </GlassCard>
      </div>
    )}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
