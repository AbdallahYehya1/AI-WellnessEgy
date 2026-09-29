import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MeResult } from "@/lib/api/backend";
import { createFakeAuth, expectRedirect, redirectMock, TEST_USER, type FakeAuth } from "@/test/supabase-mock";

let auth: FakeAuth;
let configured = true;
const fetchMe = vi.fn<(token: string) => Promise<MeResult>>();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => (configured ? { auth } : null)),
}));
vi.mock("@/lib/api/backend", () => ({ fetchMe: (token: string) => fetchMe(token) }));

const { default: DashboardPage } = await import("@/app/dashboard/page");

beforeEach(() => {
  configured = true;
  auth = createFakeAuth({ signedIn: true });
  fetchMe.mockResolvedValue({
    status: "ok",
    me: { user_id: TEST_USER.sub, email: TEST_USER.email },
  });
});

describe("DashboardPage", () => {
  it("redirects to sign-in without a verified session", async () => {
    auth = createFakeAuth({ signedIn: false });
    expect(await expectRedirect(DashboardPage())).toBe("/sign-in?next=/dashboard");
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it("redirects when Supabase is not configured", async () => {
    configured = false;
    expect(await expectRedirect(DashboardPage())).toBe("/sign-in?next=/dashboard");
  });

  it("shows the signed-in user and the API's verification", async () => {
    render(await DashboardPage());
    expect(screen.getByText(TEST_USER.email)).toBeTruthy();
    expect(screen.getByText(/verified by the AI Wellness Egypt API/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("sends the session's access token to the API", async () => {
    await DashboardPage();
    expect(auth.getClaims).toHaveBeenCalled();
    expect(fetchMe).toHaveBeenCalledWith("test-access-token");
  });

  it("explains when the API rejects the session", async () => {
    fetchMe.mockResolvedValueOnce({ status: "unauthorized" });
    render(await DashboardPage());
    expect(screen.getByRole("alert").textContent).toContain("could not verify your session");
  });

  it("stays usable when the API is down", async () => {
    fetchMe.mockResolvedValueOnce({ status: "unavailable" });
    render(await DashboardPage());
    expect(screen.getByText(/can.t be reached right now/)).toBeTruthy();
    expect(screen.getByText(TEST_USER.email)).toBeTruthy();
  });
});
