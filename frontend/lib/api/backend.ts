import "server-only";

// Server-side calls to the FastAPI backend. The access token is forwarded
// from the server, so it never has to be handled by browser JavaScript.

export type Me = { user_id: string; email: string | null };

export type MeResult =
  | { status: "ok"; me: Me }
  | { status: "unauthorized" }
  | { status: "unavailable" };

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const TIMEOUT_MS = 5000;

export function apiBaseUrl(): string {
  return (process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function isMe(value: unknown): value is Me {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.user_id === "string" &&
    (typeof record.email === "string" || record.email === null)
  );
}

export async function fetchMe(accessToken: string): Promise<MeResult> {
  try {
    const response = await fetch(`${apiBaseUrl()}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) return { status: "unauthorized" };
    if (!response.ok) return { status: "unavailable" };
    const body: unknown = await response.json();
    return isMe(body) ? { status: "ok", me: body } : { status: "unavailable" };
  } catch {
    // Network error or timeout. Never surface raw errors to the page.
    return { status: "unavailable" };
  }
}
