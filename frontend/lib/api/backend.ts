import "server-only";

// Server-side calls to the FastAPI backend. The access token is forwarded
// from the server, so it never has to be handled by browser JavaScript.

export type Me = {
  user_id: string;
  supabase_user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
};

export type Profile = {
  user_id: string;
  display_name: string | null;
  goals: string[];
  preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ConsentStatus = "missing" | "granted" | "declined" | "outdated";

export type MyConsent = {
  current_version: string;
  status: ConsentStatus;
  recorded_version: string | null;
  recorded_at: string | null;
};

export type CurrentConsent = {
  version: string;
  consent_type: "required";
  published_at: string;
  summary_url: string;
  pending_legal_review: boolean;
};

export type ConsentRecord = {
  consent_id: string;
  version: string;
  granted: boolean;
  recorded_at: string;
};

/** Outcome of an API call. `error` is the API's error code, never raw text. */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export type MeResult =
  | { status: "ok"; me: Me }
  | { status: "unauthorized" }
  | { status: "unavailable" };

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const TIMEOUT_MS = 5000;

export function apiBaseUrl(): string {
  return (process.env.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function errorCode(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: { code?: unknown } }).error;
    if (typeof error?.code === "string") return error.code;
  }
  return "unknown_error";
}

async function request<T>(
  path: string,
  options: { token?: string; method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: errorCode(body) };
    return { ok: true, status: response.status, data: body as T };
  } catch {
    // Network error or timeout. Never surface raw errors to the page.
    return { ok: false, status: 0, error: "network_error" };
  }
}

function isMe(value: unknown): value is Me {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.user_id === "string" &&
    typeof record.supabase_user_id === "string" &&
    (typeof record.email === "string" || record.email === null)
  );
}

export async function fetchMe(accessToken: string): Promise<MeResult> {
  const result = await request<unknown>("/me", { token: accessToken });
  if (result.ok) return isMe(result.data) ? { status: "ok", me: result.data } : { status: "unavailable" };
  return result.status === 401 ? { status: "unauthorized" } : { status: "unavailable" };
}

export function fetchProfile(token: string) {
  return request<Profile>("/profile", { token });
}

export function updateProfile(token: string, changes: { display_name: string | null }) {
  return request<Profile>("/profile", { token, method: "PATCH", body: changes });
}

export function fetchMyConsent(token: string) {
  return request<MyConsent>("/consents/me", { token });
}

export function fetchCurrentConsent() {
  return request<CurrentConsent>("/consents/current");
}

export function recordConsent(token: string, version: string, granted: boolean) {
  return request<ConsentRecord>("/consents", {
    token,
    method: "POST",
    body: { version, granted, consent_type: "required" },
  });
}
