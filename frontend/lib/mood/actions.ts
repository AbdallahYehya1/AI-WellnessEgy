"use server";

import { redirect } from "next/navigation";

import { recordMoodCheckin } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { CHECK_IN_PATH, parseMoodScore } from "@/lib/mood/score";
import { ONBOARDING_CONSENT } from "@/lib/onboarding/steps";

export type MoodFormState = { fieldError?: string; formError?: string };

export async function submitMoodCheckin(
  _: MoodFormState,
  formData: FormData,
): Promise<MoodFormState> {
  const session = await getVerifiedSession();
  if (!session) redirect(`/sign-in?next=${CHECK_IN_PATH}`);

  const score = parseMoodScore(formData.get("moodScore"));
  if (score === null) return { fieldError: "Choose a number from 1 to 5." };

  const result = await recordMoodCheckin(session.accessToken, score);
  if (!result.ok) {
    if (result.status === 401) redirect(`/sign-in?next=${CHECK_IN_PATH}`);
    if (result.error === "consent_required") redirect(ONBOARDING_CONSENT);
    if (result.status === 422) return { fieldError: "Choose a number from 1 to 5." };
    return { formError: "We couldn't save your check-in right now. Please try again." };
  }
  redirect("/dashboard?status=checked-in");
}
