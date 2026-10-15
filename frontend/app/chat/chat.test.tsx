import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatClient } from "@/components/chat/chat-client";
import type { ChatConfig, ChatResponse } from "@/lib/api/backend";
import type { ChatActionResult } from "@/lib/chat/actions";
import { backend, fail, getVerifiedSession, myConsent, ok, SESSION, VERSION } from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { default: ChatPage } = await import("@/app/chat/page");
const { sendChat } = await import("@/lib/chat/actions");

const CONFIG: ChatConfig = {
  enabled: true,
  age_band: "adult",
  age_band_label: "Adult",
  test_only_policy: true,
  prototype: true,
};

const CITATION = {
  chunk_id: "c1",
  source_title: "Synthetic fixture - slow breathing (EN)",
  publisher: "AI Wellness Egypt test fixtures",
  source_ref: "fixture:synthetic-adult-breathing",
  version_label: "0.1-synthetic",
  synthetic: true,
};

function reply(text: string, signature = "sig-1"): ChatResponse {
  return { status: "reply", reply: { text, signature, citations: [CITATION] }, notice: null, prototype: true };
}

function notice(status: ChatResponse["status"], text: string): ChatResponse {
  return { status, reply: null, notice: text, prototype: true };
}

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
  backend.fetchChatConfig.mockResolvedValue(ok(CONFIG));
  backend.sendChatMessage.mockResolvedValue(ok(reply("Hello.")));
});

describe("chat page", () => {
  it("requires a signed-in user", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(ChatPage())).toBe("/sign-in?next=/chat");
  });

  it.each([
    ["missing", "/onboarding"],
    ["outdated", "/onboarding/consent"],
  ] as const)("is gated on consent (%s → %s)", async (status, step) => {
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent(status)));
    expect(await expectRedirect(ChatPage())).toBe(step);
    expect(backend.fetchChatConfig).not.toHaveBeenCalled();
  });

  it("fails closed when consent can't be checked", async () => {
    backend.fetchMyConsent.mockResolvedValue(fail(0, "network_error"));
    render(await ChatPage());
    expect(screen.queryByLabelText("Your message")).toBeNull();
  });

  it("shows the adult prototype badge, scope statement and test-mode note", async () => {
    render(await ChatPage());
    expect(screen.getByText("Adult")).toBeTruthy();
    expect(screen.getByText("Prototype")).toBeTruthy();
    expect(screen.getByText(/not a therapist or doctor/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/not clinically reviewed/);
    expect(screen.getByLabelText("Your message")).toBeTruthy();
  });

  it("hides the composer when the server reports chat as disabled", async () => {
    backend.fetchChatConfig.mockResolvedValue(ok({ ...CONFIG, enabled: false, test_only_policy: false }));
    render(await ChatPage());
    expect(screen.getByRole("status").textContent).toMatch(/isn.t available yet/);
    expect(screen.queryByLabelText("Your message")).toBeNull();
  });
});

describe("sendChat", () => {
  it("forwards the message and only the last six well-formed turns", async () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ role: "user" as const, text: `t${i}` }));
    const result = await sendChat("  hi  ", [...history, { role: "system", text: "x" } as never]);
    expect(result).toEqual({ kind: "response", response: reply("Hello.") });
    const [, message, sent] = backend.sendChatMessage.mock.calls[0] ?? [];
    expect(message).toBe("hi");
    expect(sent).toHaveLength(6);
    expect(sent[5]).toEqual({ role: "user", text: "t7" });
  });

  it.each(["", "   ", "x".repeat(2001)])("rejects %j without calling the API", async (message) => {
    expect((await sendChat(message, [])).kind).toBe("error");
    expect(backend.sendChatMessage).not.toHaveBeenCalled();
  });

  it.each([
    [fail(401, "unauthorized"), "/sign-in?next=/chat"],
    [fail(403, "consent_required"), "/onboarding/consent"],
  ])("redirects on %o", async (result, url) => {
    backend.sendChatMessage.mockResolvedValue(result);
    expect(await expectRedirect(sendChat("hi", []))).toBe(url);
  });

  it.each([
    ["rate_limited", /wait a minute/],
    ["invalid_history", /start over/],
    ["network_error", /couldn.t respond/],
  ])("maps %s to a safe message", async (code, pattern) => {
    backend.sendChatMessage.mockResolvedValue(fail(code === "rate_limited" ? 429 : 0, code));
    const result = await sendChat("hi", []);
    expect(result.kind === "error" && result.message).toMatch(pattern);
  });
});

describe("chat client", () => {
  async function type(text: string) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your message"), text);
    await user.click(screen.getByRole("button", { name: "Send" }));
  }

  it("shows the reply with labelled synthetic citations and sends signed turns back", async () => {
    const send = vi
      .fn<(m: string, h: unknown[]) => Promise<ChatActionResult>>()
      .mockResolvedValueOnce({ kind: "response", response: reply("First answer.", "sig-a") })
      .mockResolvedValueOnce({ kind: "response", response: reply("Second answer.", "sig-b") });
    render(<ChatClient send={send} />);

    await type("breathing");
    expect(await screen.findByText("First answer.")).toBeTruthy();
    expect(screen.getByText(/Synthetic test content/)).toBeTruthy();
    expect(screen.getByText(/slow breathing \(EN\)/)).toBeTruthy();

    await type("more");
    await screen.findByText("Second answer.");
    expect(send.mock.calls[1]).toEqual([
      "more",
      [
        { role: "user", text: "breathing" },
        { role: "assistant", text: "First answer.", signature: "sig-a" },
      ],
    ]);
  });

  it("shows notices for non-reply outcomes and never sends them back as assistant turns", async () => {
    const send = vi
      .fn<(m: string, h: unknown[]) => Promise<ChatActionResult>>()
      .mockResolvedValueOnce({ kind: "response", response: notice("no_evidence", "No reviewed info.") })
      .mockResolvedValueOnce({ kind: "response", response: reply("ok") });
    render(<ChatClient send={send} />);
    await type("something");
    expect((await screen.findByRole("note")).textContent).toContain("No reviewed info.");
    await type("again");
    await screen.findByText("ok");
    expect(send.mock.calls[1]?.[1]).toEqual([{ role: "user", text: "something" }]);
  });

  it("keeps the draft and shows an alert on errors", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "error", message: "Please wait a minute." });
    render(<ChatClient send={send} />);
    await type("hello");
    expect((await screen.findByRole("alert")).textContent).toBe("Please wait a minute.");
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("hello");
  });

  it("can start over, clearing the browser-held conversation", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "response", response: reply("Answer.") });
    render(<ChatClient send={send} />);
    await type("hello");
    await screen.findByText("Answer.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.queryByText("Answer.")).toBeNull());
  });

  it("does not send an empty message", () => {
    const send = vi.fn();
    render(<ChatClient send={send} />);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
