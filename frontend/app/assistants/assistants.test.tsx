import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatActions, ChatWorkspace } from "@/components/chat/workspace";
import type { AssistantInfo, ChatConfig, ChatResponse } from "@/lib/api/backend";
import { backend, fail, getVerifiedSession, myConsent, ok, SESSION, VERSION } from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

let acceptLanguage = "en";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": acceptLanguage }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/preferences/actions", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { default: AssistantsPage } = await import("@/app/assistants/page");
const { default: ChatPage } = await import("@/app/chat/page");

function assistant(id: string, status: AssistantInfo["status"], name: string, extra: Partial<AssistantInfo> = {}): AssistantInfo {
  return {
    assistant_id: id,
    status,
    icon: "heart",
    name_en: name,
    name_ar: `${name} (ar)`,
    description_en: `${name} description`,
    description_ar: `${name} وصف`,
    starters_en: [`${name} starter one`, `${name} starter two`, `${name} starter three`],
    starters_ar: [`${name} بداية`],
    ...extra,
  };
}

const ASSISTANTS = [
  assistant("relationships", "ready", "Marriage & Healthy Relationships"),
  assistant("career", "ready", "Career & Work", { icon: "briefcase" }),
  assistant("emotional", "ready", "Emotional Wellbeing & Resilience", { icon: "leaf" }),
  assistant("finance", "preview", "Financial Wellbeing", { icon: "wallet" }),
];

const CONFIG: ChatConfig = {
  enabled: true,
  age_band: "adult",
  age_band_label: "Adult",
  test_only_policy: false,
  prototype: true,
  generator: "model",
  model: "openai/gpt-oss-20b",
  demo_curated: true,
  demo_prompts: [
    { prompt_id: "sleep", en: "What habits help with better sleep?", ar: "نوم", follow_up: false },
    { prompt_id: "summary", en: "Can you give me a short summary?", ar: "ملخص", follow_up: true },
  ],
  typed_input: "topics",
  supported_topics: [{ prompt_id: "sleep", en: "What habits help with better sleep?", ar: "نوم" }],
  history: null,
  assistants: ASSISTANTS,
};

beforeEach(() => {
  vi.resetAllMocks();
  acceptLanguage = "en";
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
  backend.fetchChatConfig.mockResolvedValue(ok(CONFIG));
  backend.listConversations.mockResolvedValue(ok({ conversations: [], next_cursor: null }));
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
});

describe("assistants directory", () => {
  it("requires sign-in and consent", async () => {
    getVerifiedSession.mockResolvedValue(null);
    expect(await expectRedirect(AssistantsPage())).toBe("/sign-in?next=/assistants");
    getVerifiedSession.mockResolvedValue(SESSION);
    backend.fetchMyConsent.mockResolvedValue(ok(myConsent("outdated")));
    expect(await expectRedirect(AssistantsPage())).toBe("/onboarding/consent");
  });

  it("asks how it can help and opens only ready assistants", async () => {
    render(await AssistantsPage());
    expect(screen.getByRole("heading", { level: 1, name: "How can we help you today?" })).toBeTruthy();
    expect(screen.getByText(/not therapy, medical, legal or financial advice/)).toBeTruthy();
    const career = screen.getByRole("link", { name: /Career & Work/ });
    expect(career.getAttribute("href")).toBe("/chat?assistant=career");
    expect(career.textContent).toContain("Career & Work starter two");
    expect(career.textContent).not.toContain("starter three"); // two examples only
    const finance = screen.getByRole("heading", { name: "Financial Wellbeing" }).closest("li")!;
    expect(within(finance).queryByRole("link")).toBeNull();
    expect(finance.textContent).toContain("Coming soon");
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order.at(-1)).toBe("Financial Wellbeing"); // ready ones first
  });

  it("shows Arabic names and starters to Arabic visitors", async () => {
    acceptLanguage = "ar";
    render(await AssistantsPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("How can we help you today?");
    const career = screen.getByRole("link", { name: /^Career & Work \(ar\)/ });
    expect(career.textContent).toContain("Career & Work بداية");
  });

  it("explains when the assistants are switched off", async () => {
    backend.fetchChatConfig.mockResolvedValue(ok({ ...CONFIG, enabled: false }));
    render(await AssistantsPage());
    expect(screen.getByRole("status").textContent).toMatch(/isn.t available yet/);
    expect(screen.queryByRole("link", { name: /Career/ })).toBeNull();
  });

  it("fails closed when the config can't be loaded", async () => {
    backend.fetchChatConfig.mockResolvedValue(fail(503, "service_unavailable"));
    render(await AssistantsPage());
    expect(screen.queryByRole("link", { name: /Career/ })).toBeNull();
  });
});

describe("chat page with an assistant", () => {
  it("opens the requested assistant with its own starters and no wellbeing topic list", async () => {
    render(await ChatPage({ searchParams: Promise.resolve({ assistant: "career" }) }));
    expect(screen.getByRole("heading", { level: 2, name: "Career & Work" })).toBeTruthy();
    expect(screen.getByText("Career & Work starter one")).toBeTruthy();
    expect(screen.queryByText("Topics I can answer right now")).toBeNull();
    expect(screen.getByRole("link", { name: "All assistants" }).getAttribute("href")).toBe("/assistants");
  });

  it("lists only that assistant's saved chats", async () => {
    backend.fetchChatConfig.mockResolvedValue(
      ok({ ...CONFIG, history: { available: true, enabled: true, consent_version: "chat-history-v1", consented_version: "chat-history-v1", retention_days: 90, max_conversations: 50 } }),
    );
    render(await ChatPage({ searchParams: Promise.resolve({ assistant: "relationships" }) }));
    expect(backend.listConversations).toHaveBeenCalledWith(SESSION.accessToken, { assistant: "relationships" });
  });

  it.each(["finance", "unknown", "../../etc"])("falls back to the default assistant for %s", async (requested) => {
    render(await ChatPage({ searchParams: Promise.resolve({ assistant: requested }) }));
    // The default is Emotional Wellbeing, a full assistant with its own starters.
    expect(screen.getByRole("heading", { level: 2, name: "Emotional Wellbeing & Resilience" })).toBeTruthy();
    expect(screen.getByText("Emotional Wellbeing & Resilience starter one")).toBeTruthy();
    expect(screen.queryByText(/Financial Wellbeing/)).toBeNull();
  });
});

describe("workspace handoff", () => {
  function actions(response: ChatResponse): ChatActions {
    return {
      send: vi.fn().mockResolvedValue({ kind: "response", response }),
      loadConversations: vi.fn().mockResolvedValue({ ok: true, data: { conversations: [], next_cursor: null } }),
      openConversation: vi.fn(),
      renameChat: vi.fn(),
      deleteChat: vi.fn(),
      deleteAllChats: vi.fn(),
      setHistoryEnabled: vi.fn(),
    };
  }

  async function send(a: ChatActions, names: Record<string, string>) {
    render(
      <ChatWorkspace
        actions={a}
        assistant={{ id: "relationships", name: "Marriage & Healthy Relationships", description: "", icon: "heart" }}
        assistantNames={names}
        showTopics={false}
        suggestions={[]}
        topics={[]}
        typedInput="topics"
        modeNote={null}
        history={null}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Ask a general question"), "My manager keeps changing my deadlines");
    await user.click(screen.getByRole("button", { name: "Send" }));
  }

  const handoff: ChatResponse = {
    status: "out_of_scope",
    reply: null,
    notice: "server text",
    prototype: true,
    refusal_reason: "unsupported_topic",
    assistant_id: "relationships",
    handoff: "career",
  };

  it("sends the assistant id and suggests a better-suited ready assistant, sharing nothing", async () => {
    const a = actions(handoff);
    await send(a, { career: "Career & Work" });
    expect(vi.mocked(a.send).mock.calls[0]?.[0].assistantId).toBe("relationships");
    const link = await screen.findByRole("link", { name: "Open Career & Work" });
    expect(link.getAttribute("href")).toBe("/chat?assistant=career");
    expect(screen.getByText(/nothing from this chat is shared/)).toBeTruthy();
  });

  it("never links to an assistant that isn't ready", async () => {
    await send(actions({ ...handoff, handoff: "finance" }), { career: "Career & Work" });
    await screen.findByRole("note");
    expect(screen.queryByRole("link", { name: /Open / })).toBeNull();
  });

  it("an answer can carry a handoff suggestion too", async () => {
    const answered: ChatResponse = {
      status: "reply",
      reply: { text: "Some practical steps.", signature: "sig", citations: [] },
      notice: null,
      prototype: true,
      assistant_id: "relationships",
      handoff: "career",
    };
    await send(actions(answered), { career: "Career & Work" });
    await screen.findByText("Some practical steps.");
    expect(screen.getByRole("link", { name: "Open Career & Work" }).getAttribute("href")).toBe("/chat?assistant=career");
  });

  it("asks for more instead of refusing, and a suggestion can be sent", async () => {
    const clarify: ChatResponse = {
      status: "clarify",
      reply: null,
      notice: "server text",
      prototype: true,
      assistant_id: "relationships",
      suggestions: ["Communicate openly and listen to each other"],
    };
    const a = actions(clarify);
    await send(a, {});
    const note = await screen.findByRole("note");
    expect(note.getAttribute("data-status")).toBe("clarify");
    expect(note.textContent).toContain("Tell me a bit more");
    expect(note.textContent).not.toContain("Outside what I can answer");
    await userEvent.setup().click(screen.getByRole("button", { name: "Communicate openly and listen to each other" }));
    expect(vi.mocked(a.send).mock.calls[1]?.[0].message).toBe("Communicate openly and listen to each other");
  });
});
