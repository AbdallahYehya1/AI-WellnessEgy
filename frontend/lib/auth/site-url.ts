import "server-only";

// The public origin used in confirmation and password-reset email links.
// Configured rather than taken from the request's Host header, which a client could
// spoof. It must match the Supabase project's allowed redirect URLs.
//
// Order: SITE_URL (set it in every real environment), then, on Vercel, the project's
// production domain, which Vercel itself sets (VERCEL_PROJECT_PRODUCTION_URL, not
// request input), so a missing SITE_URL can't silently send users to localhost.
const DEFAULT_SITE_URL = "http://localhost:3000";

export function siteUrl(): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProduction && /^[a-z0-9.-]+$/i.test(vercelProduction)) {
    return `https://${vercelProduction}`;
  }
  return DEFAULT_SITE_URL;
}
