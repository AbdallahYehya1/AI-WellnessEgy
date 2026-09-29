"use server";

import { redirect } from "next/navigation";

import { recordConsent, updateProfile } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { ONBOARDING_CONSENT } from "@/lib/onboarding/steps";
import { validateDisplayName } from "@/lib/onboarding/validation";

export type ProfileFormState = { fieldError?: string; formError?: string; displayName?: string };
export type ConsentFormState = { fieldError?: string; formError?: string; declined?: boolean };

const SERVICE_UNAVAILABLE = "We couldn't save this right now. Please try again.";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveProfile(
  _: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/onboarding");

  if (text(formData, "intent") === "skip") redirect(ONBOARDING_CONSENT);

  const raw = text(formData, "displayName");
  const { value, error } = validateDisplayName(raw);
  if (error) return { fieldError: error, displayName: raw };

  const result = await updateProfile(session.accessToken, { display_name: value });
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in?next=/onboarding");
    return {
      formError:
        result.status === 422 ? "That name can't be used. Please try another." : SERVICE_UNAVAILABLE,
      displayName: raw,
    };
  }
  redirect(ONBOARDING_CONSENT);
}

export async function submitConsent(
  _: ConsentFormState,
  formData: FormData,
): Promise<ConsentFormState> {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${ONBOARDING_CONSENT}`);

  const version = text(formData, "version");
  const accepting = text(formData, "intent") === "accept";
  // Accepting must be a deliberate act: the confirmation box is required.
  if (accepting && formData.get("confirmRead") !== "on") {
    return { fieldError: "Please confirm that you have read and agree to the terms." };
  }

  const result = await recordConsent(session.accessToken, version, accepting);
  if (!result.ok) {
    if (result.status === 401) redirect(`/sign-in?next=${ONBOARDING_CONSENT}`);
    if (result.error === "consent_version_not_current" || result.error === "unknown_version") {
      return {
        formError: "The terms were updated while you were reading. Please review the new version.",
      };
    }
    return { formError: SERVICE_UNAVAILABLE };
  }
  if (!accepting) return { declined: true };
  redirect("/dashboard");
}
