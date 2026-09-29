import type { ConsentStatus } from "@/lib/api/backend";

export const ONBOARDING_PROFILE = "/onboarding";
export const ONBOARDING_CONSENT = "/onboarding/consent";

/**
 * Where a signed-in user must go before using the app, or null when they
 * have accepted the current consent version.
 *
 * - missing: brand-new user, start with the (optional) profile step.
 * - declined / outdated: go straight to the consent step. An earlier
 *   acceptance of an older version never counts for the current one.
 */
export function requiredOnboardingStep(status: ConsentStatus): string | null {
  switch (status) {
    case "granted":
      return null;
    case "missing":
      return ONBOARDING_PROFILE;
    case "declined":
    case "outdated":
      return ONBOARDING_CONSENT;
  }
}
