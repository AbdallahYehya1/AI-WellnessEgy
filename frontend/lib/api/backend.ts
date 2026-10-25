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
  options: {
    token?: string;
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  // Server-only: lets this server reach a backend behind Vercel Deployment
  // Protection ("Protection Bypass for Automation"). Never a NEXT_PUBLIC_ value.
  // The API still verifies the user's Supabase token on every data endpoint.
  const bypass = process.env.API_PROTECTION_BYPASS?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
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

export type MoodCheckin = {
  checkin_id: string;
  /** "checkin": a legacy 1-5 rating; "reflection": Daily Reflection feelings. */
  kind?: "checkin" | "reflection";
  mood_score: number | null;
  emotions?: string[];
  factors?: string[];
  tags: string[];
  note: string | null;
  submitted_at: string;
};

export type ReflectionCreated = { checkin_id: string; submitted_at: string; suggested_assistants: string[] };

export type MoodInsights = {
  period: "week" | "month";
  start: string;
  end: string;
  reflections: number;
  days_with_reflections: number;
  enough_data: boolean;
  emotions: { label: string; count: number }[];
  factors: { label: string; count: number }[];
  links: { emotion: string; factor: string; days: number }[];
  calendar: { day: string; emotions: string[] }[];
};

export function recordReflection(token: string, emotions: string[], factors: string[]) {
  return request<ReflectionCreated>("/mood/reflections", {
    token,
    method: "POST",
    body: { emotions, factors },
  });
}

export function fetchMoodInsights(token: string, period: "week" | "month", tzOffset: number) {
  const params = new URLSearchParams({ period, tz_offset: String(tzOffset) });
  return request<MoodInsights>(`/mood/insights?${params.toString()}`, { token });
}

export function recordMoodCheckin(token: string, moodScore: number) {
  return request<{ checkin_id: string; submitted_at: string }>("/mood/checkins", {
    token,
    method: "POST",
    body: { mood_score: moodScore },
  });
}

export function fetchMoodHistory(token: string, limit: number) {
  return request<{ checkins: MoodCheckin[] }>(`/mood/history?limit=${encodeURIComponent(limit)}`, {
    token,
  });
}

// --- Chat (adult only). Typed questions are limited to supported topics (D-53). ---

export type ChatStatus =
  | "reply"
  | "support"
  /** Nothing recognised yet: the assistant asks for a little more (never a refusal). */
  | "clarify"
  | "out_of_scope"
  | "no_evidence"
  | "unable_to_answer"
  | "unavailable";

export type RefusalReason =
  | "unsupported_topic"
  | "multiple_topics"
  | "needs_context"
  | "too_long"
  | "personal_or_unclear"
  | "personal_details"
  | "clinical"
  | "sensitive"
  | "regulated"
  | "needs_detail"
  | "daily_limit"
  | "shared_limit";

export type ChatCitation = {
  chunk_id: string;
  source_title: string;
  publisher: string;
  source_ref: string;
  version_label: string;
  synthetic: boolean;
  /** "approved" | "draft" (publisher guidance, not clinically reviewed) | "synthetic" */
  review_status?: string;
};

/** The reviewed question a typed message was recognised as. */
export type ChatTopic = { prompt_id: string; question: string };

export type ConversationSummary = {
  conversation_id: string;
  assistant_id?: string;
  title: string;
  message_count: number;
  created_at: string;
  last_activity_at: string;
};

export type ChatResponse = {
  status: ChatStatus;
  reply: { text: string; signature: string; citations: ChatCitation[]; model?: string | null } | null;
  notice: string | null;
  prototype: boolean;
  refusal_reason?: RefusalReason | null;
  topic?: ChatTopic | null;
  conversation?: ConversationSummary | null;
  user_message_id?: string | null;
  assistant_message_id?: string | null;
  created_at?: string | null;
  assistant_id?: string | null;
  /** A better-suited assistant, suggested only; nothing is shared with it. */
  handoff?: string | null;
  support_kind?: SupportKind | null;
  /** With "clarify": the closest concerns this assistant can answer, in the user's language. */
  suggestions?: string[];
  /** What the AI provider received about the situation (identifiers removed), when opted in. */
  provider_context?: string | null;
  /** With a relationship-safety notice: vetted sources about abuse and getting help. */
  resources?: ChatCitation[];
};

export type SupportKind = "crisis" | "relationship_safety" | "medical" | "danger";

/** Provider context (D-59): whether a user's situation, minus identifiers, may reach the AI provider. */
export type ContextSettings = {
  mode: "structured" | "minimized" | "original";
  available: boolean;
  enabled: boolean;
  consent_version: string;
  consented_version: string | null;
  provider: string | null;
  model: string | null;
  processing_region: string | null;
  retention: string | null;
};

export type AssistantInfo = {
  assistant_id: string;
  status: "ready" | "preview";
  icon: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  starters_en: string[];
  starters_ar: string[];
};

export type HistorySettings = {
  /** The server can store history (configured and migrated). */
  available: boolean;
  /** This user opted in. */
  enabled: boolean;
  consent_version: string;
  consented_version: string | null;
  retention_days: number;
  max_conversations: number;
};

export type SupportedTopic = { prompt_id: string; en: string; ar: string };

export type ChatConfig = {
  enabled: boolean;
  age_band: string;
  age_band_label: string;
  test_only_policy: boolean;
  prototype: boolean;
  /** "scripted": a test generator quotes passages; "model": an AI model writes replies. */
  generator?: "scripted" | "model" | null;
  model?: string | null;
  demo_curated?: boolean;
  demo_prompts?: { prompt_id: string; en: string; ar: string; follow_up: boolean }[];
  /** "topics": typed questions only within the supported topics; "free": test-only. */
  typed_input?: "topics" | "free";
  supported_topics?: SupportedTopic[];
  history?: HistorySettings | null;
  assistants?: AssistantInfo[];
  context?: ContextSettings | null;
};

export type StoredMessage = {
  message_id: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  language: "en" | "ar";
  topic: ChatTopic | null;
  citations: ChatCitation[];
  model: string | null;
  signature: string | null;
  created_at: string;
};

export type ConversationPage = { conversations: ConversationSummary[]; next_cursor: string | null };

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: StoredMessage[];
  next_before: number | null;
};

/** A turn sent back to the server. Assistant turns carry the server signature. */
export type ChatTurn = { role: "user" | "assistant"; text: string; signature?: string };

export type SendChatBody = {
  message: string;
  history?: ChatTurn[];
  conversation_id?: string;
  client_message_id?: string;
  assistant_id?: string;
};

// Safety assessment (2s) plus generation (10s) can exceed the default timeout.
const CHAT_TIMEOUT_MS = 15000;

export function fetchChatConfig(token: string) {
  return request<ChatConfig>("/chat/config", { token });
}

export function sendChatMessage(token: string, body: SendChatBody) {
  return request<ChatResponse>("/chat/messages", {
    token,
    method: "POST",
    body: { history: [], ...body },
    timeoutMs: CHAT_TIMEOUT_MS,
  });
}

export function updateHistorySettings(token: string, enabled: boolean, consentVersion?: string) {
  return request<HistorySettings>("/chat/history", {
    token,
    method: "PUT",
    body: enabled ? { enabled, consent_version: consentVersion } : { enabled },
  });
}

export function updateContextSettings(token: string, enabled: boolean, consentVersion?: string) {
  return request<ContextSettings>("/chat/context", {
    token,
    method: "PUT",
    body: enabled ? { enabled, consent_version: consentVersion } : { enabled },
  });
}

export function listConversations(
  token: string,
  options: { cursor?: string; q?: string; limit?: number; assistant?: string } = {},
) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 30) });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.q) params.set("q", options.q);
  if (options.assistant) params.set("assistant", options.assistant);
  return request<ConversationPage>(`/chat/conversations?${params.toString()}`, { token });
}

export function fetchConversation(token: string, id: string, options: { before?: number; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.before) params.set("before", String(options.before));
  return request<ConversationDetail>(`/chat/conversations/${encodeURIComponent(id)}?${params.toString()}`, {
    token,
  });
}

export function renameConversation(token: string, id: string, title: string) {
  return request<ConversationSummary>(`/chat/conversations/${encodeURIComponent(id)}`, {
    token,
    method: "PATCH",
    body: { title },
  });
}

export function deleteConversation(token: string, id: string) {
  return request<null>(`/chat/conversations/${encodeURIComponent(id)}`, { token, method: "DELETE" });
}

export function deleteAllConversations(token: string) {
  return request<null>("/chat/conversations", { token, method: "DELETE" });
}
