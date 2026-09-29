import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * A Supabase client for Server Components, Server Actions and Route
 * Handlers. Create a new one per request; never share it.
 * Returns null when Supabase is not configured.
 */
export async function createClient(): Promise<SupabaseClient | null> {
  // Read cookies first, even when unconfigured: this makes every caller
  // render per request, so auth-dependent pages are never prerendered.
  const cookieStore = await cookies();
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every navigation, so this is safe to ignore there.
        }
      },
    },
  });
}
