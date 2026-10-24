"use server";

import { redirect } from "next/navigation";

import { recordReflection } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { CHECK_IN_PATH, EMOTIONS, FACTORS } from "@/lib/mood/score";
import { ONBOARDING_CONSENT } from "@/lib/onboarding/steps";

export type ReflectionFormState = {
  fieldError?: string;
  formError?: string;
  saved?: { emotions: string[]; factors: string[]; suggestions: string[] };
};

/** Daily Reflection: feelings (one or more) and optional factors. No note (D-32). */
export async function submitReflection(_: ReflectionFormState, formData: FormData): Promise<ReflectionFormState> {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHECK_IN_PATH}`);

  const pick = (name: string, allowed: readonly string[]) =>
    [...new Set(formData.getAll(name).map(String))].filter((v) => allowed.includes(v));
  const emotions = pick("emotions", EMOTIONS);
  const factors = pick("factors", FACTORS);
  if (emotions.length === 0) return { fieldError: "Choose at least one feeling." };

  const result = await recordReflection(session.accessToken, emotions, factors);
  if (!result.ok) {
    if (result.status === 401) redirect(`/sign-in?next=${CHECK_IN_PATH}`);
    if (result.error === "consent_required") redirect(ONBOARDING_CONSENT);
    if (result.status === 422) return { fieldError: "Choose at least one feeling." };
    return { formError: "We couldn't save your reflection right now. Please try again." };
  }
  return { saved: { emotions, factors, suggestions: result.data.suggested_assistants } };
}
