import "server-only";

import { createClient } from "@/lib/supabase/server";

export type VerifiedSession = { accessToken: string; email: string | null };

/**
 * The signed-in user's session, or null. `getClaims()` verifies the JWT
 * first; only then is the session's access token used (to call the API,
 * which verifies it again independently).
 */
export async function getVerifiedSession(): Promise<VerifiedSession | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (typeof claims?.sub !== "string") return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return {
    accessToken: session.access_token,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}
