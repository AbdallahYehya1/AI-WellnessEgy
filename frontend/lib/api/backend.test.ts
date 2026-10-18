// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchCurrentConsent,
  fetchMe,
  fetchMoodHistory,
  fetchMyConsent,
  recordConsent,
  recordMoodCheckin,
  updateProfile,
} = await import("@/lib/api/backend");

const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_BASE_URL", "http://api.test/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("backend client", () => {
  it("sends the bearer token and never caches", async () => {
    respond(200, { current_version: "v1", status: "missing", recorded_version: null, recorded_at: null });
    const result = await fetchMyConsent("tok");
    expect(result).toMatchObject({ ok: true, data: { status: "missing" } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/consents/me");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init?.cache).toBe("no-store");
  });

  it("sends the deployment-protection bypass only when configured", async () => {
    respond(200, { version: "v1" });
    await fetchCurrentConsent();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-vercel-protection-bypass");
    vi.stubEnv("API_PROTECTION_BYPASS", " bypass-secret ");
    respond(200, { version: "v1" });
    await fetchCurrentConsent();
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)["x-vercel-protection-bypass"]).toBe(
      "bypass-secret",
    );
    vi.unstubAllEnvs();
    vi.stubEnv("API_BASE_URL", "http://api.test/");
  });

  it("does not send a token for the public current-consent endpoint", async () => {
    respond(200, { version: "v1" });
    await fetchCurrentConsent();
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("posts an explicit, typed consent decision", async () => {
    respond(201, { consent_id: "c1", version: "v1", granted: true, recorded_at: "t" });
    await recordConsent("tok", "v1", true);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      version: "v1",
      granted: true,
      consent_type: "required",
    });
  });

  it("sends only the display name when updating the profile", async () => {
    respond(200, {});
    await updateProfile("tok", { display_name: "Salma" });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ display_name: "Salma" });
  });

  it("returns the API error code, never raw error text", async () => {
    respond(422, { error: { code: "unknown_version", message: "internal detail" } });
    const result = await recordConsent("tok", "bad", true);
    expect(result).toEqual({ ok: false, status: 422, error: "unknown_version" });
  });

  it("maps network failures to a generic error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("connect ECONNREFUSED 10.0.0.1"));
    expect(await fetchMyConsent("tok")).toEqual({ ok: false, status: 0, error: "network_error" });
  });

  it("validates the /me payload", async () => {
    respond(200, { user_id: "u" }); // missing fields
    expect(await fetchMe("tok")).toEqual({ status: "unavailable" });
    respond(401, { error: { code: "unauthorized", message: "x" } });
    expect(await fetchMe("tok")).toEqual({ status: "unauthorized" });
  });
});

describe("mood client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("API_BASE_URL", "http://api.test");
  });

  it("posts only the score with the bearer token", async () => {
    respond(201, { checkin_id: "c1", submitted_at: "t" });
    await recordMoodCheckin("tok", 3);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/mood/checkins");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ mood_score: 3 });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("requests a bounded history", async () => {
    respond(200, { checkins: [] });
    const result = await fetchMoodHistory("tok", 7);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/mood/history?limit=7");
    expect(result).toEqual({ ok: true, status: 200, data: { checkins: [] } });
  });

  it("surfaces consent_required as an error code", async () => {
    respond(403, { error: { code: "consent_required", message: "x" } });
    expect(await recordMoodCheckin("tok", 3)).toEqual({
      ok: false,
      status: 403,
      error: "consent_required",
    });
  });
});
