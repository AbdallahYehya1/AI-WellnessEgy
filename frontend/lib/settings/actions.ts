"use server";

import { redirect } from "next/navigation";

import { updateProfile } from "@/lib/api/backend";
import { getVerifiedSession } from "@/lib/auth/session";
import { validateDisplayName } from "@/lib/onboarding/validation";

export type DisplayNameState = { saved?: boolean; fieldError?: string; formError?: string; displayName?: string };

/** Update the display name from Settings (same validation and API as onboarding). */
export async function updateDisplayName(_: DisplayNameState, formData: FormData): Promise<DisplayNameState> {
  const session = await getVerifiedSession();
  if (!session) redirect("/sign-in?next=/settings");

  const rawValue = formData.get("displayName");
  const raw = typeof rawValue === "string" ? rawValue : "";
  const { value, error } = validateDisplayName(raw);
  if (error) return { fieldError: error, displayName: raw };

  const result = await updateProfile(session.accessToken, { display_name: value });
  if (!result.ok) {
    if (result.status === 401) redirect("/sign-in?next=/settings");
    return {
      formError:
        result.status === 422
          ? "That name can't be used. Please try another."
          : "We couldn't save this right now. Please try again.",
      displayName: raw,
    };
  }
  return { saved: true, displayName: result.data.display_name ?? "" };
}
