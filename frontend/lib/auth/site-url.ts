import "server-only";

// The public origin used in confirmation-email links. Configured rather than
// taken from the request's Host header, which a client could spoof.
// It must match the Supabase project's allowed redirect URLs.
const DEFAULT_SITE_URL = "http://localhost:3000";

export function siteUrl(): string {
  return (process.env.SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, "");
}
