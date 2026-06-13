export interface OnboardingPreferenceLike {
  readonly onboardingCompleted?: unknown;
}

export const petScaleOptions = [
  { label: "XS", value: 0.5 },
  { label: "Small", value: 0.75 },
  { label: "Medium", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Huge", value: 1.5 },
] as const;
export type PetScaleValue = typeof petScaleOptions[number]["value"];
export const defaultPetScale: PetScaleValue = 1;

export function normalizePetScale(value: unknown): PetScaleValue {
  return petScaleOptions.find((option) => option.value === value)?.value ?? defaultPetScale;
}

export function normalizeOnboardingCompleted(value: OnboardingPreferenceLike): boolean {
  return typeof value.onboardingCompleted === "boolean" ? value.onboardingCompleted : false;
}

export function markOnboardingCompleted<T extends { readonly preferences: Record<string, unknown> }>(state: T): T {
  return {
    ...state,
    preferences: {
      ...state.preferences,
      onboardingCompleted: true,
    },
  };
}

export function shouldShowDefaultPetForExternalEvent(_visible: boolean, _openOnLaunch: boolean, paused: boolean): boolean {
  // Agent activity is an explicit display trigger; open-on-launch only controls startup.
  return !paused;
}
