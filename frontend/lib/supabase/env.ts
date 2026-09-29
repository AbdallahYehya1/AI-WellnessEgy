// Browser-safe Supabase settings. Both values are public by design (they
// ship in client JavaScript); server-only secrets must never be read here.
export type SupabaseEnv = { url: string; publishableKey: string };

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}
