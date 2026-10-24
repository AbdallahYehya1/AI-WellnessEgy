import { vi } from "vitest";

import type { ApiResult, ConsentStatus, CurrentConsent, Me, MyConsent, Profile } from "@/lib/api/backend";

// Fixtures and helpers for tests that mock `@/lib/api/backend` and
// `@/lib/auth/session`. Nothing here touches the network.

export const SESSION = { accessToken: "test-access-token", email: "person@example.com" };
export const VERSION = "2026-09-29.draft-1";

export function ok<T>(data: T, status = 200): ApiResult<T> {
  return { ok: true, status, data };
}

export function fail<T>(status: number, error: string): ApiResult<T> {
  return { ok: false, status, error };
}

export function myConsent(status: ConsentStatus, recorded: string | null = null): MyConsent {
  return {
    current_version: VERSION,
    status,
    recorded_version: recorded,
    recorded_at: recorded ? "2026-09-29T10:00:00Z" : null,
  };
}

export const CURRENT: CurrentConsent = {
  version: VERSION,
  consent_type: "required",
  published_at: "2026-09-29T00:00:00Z",
  summary_url: "/onboarding/consent",
  pending_legal_review: true,
};

export const PROFILE: Profile = {
  user_id: "11111111-2222-4333-8444-555555555555",
  display_name: null,
  goals: [],
  preferences: {},
  created_at: "2026-09-29T10:00:00Z",
  updated_at: "2026-09-29T10:00:00Z",
};

export const ME: Me = {
  user_id: PROFILE.user_id,
  supabase_user_id: "7d8f7b0e-3c1a-4b8e-9d2f-5a6c7e8f9a0b",
  email: SESSION.email,
  display_name: "Salma",
  created_at: PROFILE.created_at,
};

export const backend = {
  fetchMe: vi.fn(),
  fetchProfile: vi.fn(),
  updateProfile: vi.fn(),
  fetchMyConsent: vi.fn(),
  fetchCurrentConsent: vi.fn(),
  recordConsent: vi.fn(),
  recordMoodCheckin: vi.fn(),
  fetchMoodHistory: vi.fn(),
  recordReflection: vi.fn(),
  fetchMoodInsights: vi.fn(),
  fetchChatConfig: vi.fn(),
  sendChatMessage: vi.fn(),
  updateHistorySettings: vi.fn(),
  listConversations: vi.fn(),
  fetchConversation: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  deleteAllConversations: vi.fn(),
};

export function moodCheckin(score: number, submittedAt: string, id = `c-${score}-${submittedAt}`) {
  return { checkin_id: id, mood_score: score, tags: [], note: null, submitted_at: submittedAt };
}

export const getVerifiedSession = vi.fn<() => Promise<typeof SESSION | null>>();
