import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Markdown, parseBlocks } from "@/components/chat/markdown";
import { type ChatActions, ChatWorkspace } from "@/components/chat/workspace";
import type { ChatConfig, ChatResponse, ConversationSummary, HistorySettings, StoredMessage } from "@/lib/api/backend";
import { backend, fail, getVerifiedSession, myConsent, ok, SESSION, VERSION } from "@/test/backend-mock";
import { expectRedirect, redirectMock } from "@/test/supabase-mock";

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedSession: () => getVerifiedSession() }));
vi.mock("@/lib/api/backend", () => backend);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/preferences/actions", () => ({ setLocale: vi.fn(), setTheme: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { default: ChatPage } = await import("@/app/chat/page");
const actionsModule = await import("@/lib/chat/actions");
const { sendChat, renameChat, openConversation, deleteChat, setHistoryEnabled, loadConversations } = actionsModule;

const CONV_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-2222-4333-8444-555555555555";
const CLIENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const HISTORY_OFF: HistorySettings = {
  available: true,
  enabled: false,
  consent_version: "chat-history-v1",
  consented_version: null,
  retention_days: 90,
  max_conversations: 200,
};
const HISTORY_ON: HistorySettings = { ...HISTORY_OFF, enabled: true, consented_version: "chat-history-v1" };

const TOPICS = [
  { prompt_id: "sleep", en: "What habits help with better sleep?", ar: "إيه العادات اللي تساعد على نوم أحسن؟" },
  { prompt_id: "mindfulness", en: "What is mindfulness?", ar: "يعني إيه اليقظة الذهنية (mindfulness)؟" },
];
const PROMPTS = [
  { prompt_id: "sleep", en: TOPICS[0]!.en, ar: TOPICS[0]!.ar, follow_up: false },
  { prompt_id: "summary", en: "Can you give me a short summary?", ar: "ممكن ملخص قصير؟", follow_up: true },
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
  demo_prompts: PROMPTS,
  typed_input: "topics",
  supported_topics: TOPICS,
  history: HISTORY_OFF,
};

const WHO = {
  chunk_id: "c1",
  source_title: "Doing What Matters in Times of Stress",
  publisher: "World Health Organization",
  source_ref: "https://www.who.int/publications/i/item/9789240003927",
  version_label: "2020-en",
  synthetic: false,
  review_status: "draft",
};

function summary(id = CONV_ID, title = "What habits help with better sleep?"): ConversationSummary {
  return { conversation_id: id, title, message_count: 2, created_at: "2026-10-20T08:00:00Z", last_activity_at: "2026-10-20T08:00:00Z" };
}

function reply(text: string, extra: Partial<ChatResponse> = {}): ChatResponse {
  return {
    status: "reply",
    reply: { text, signature: "sig-1", citations: [WHO, { ...WHO, chunk_id: "c2" }], model: "openai/gpt-oss-20b" },
    notice: null,
    prototype: true,
    topic: { prompt_id: "sleep", question: "What habits help with better sleep?" },
    ...extra,
  };
}

function refusal(reason: ChatResponse["refusal_reason"]): ChatResponse {
  return { status: "out_of_scope", reply: null, notice: "server text", prototype: true, refusal_reason: reason };
}

function stored(seq: number, role: "user" | "assistant", text: string): StoredMessage {
  return {
    message_id: `m${seq}`,
    seq,
    role,
    text,
    language: "en",
    topic: role === "user" ? { prompt_id: "sleep", question: "What habits help with better sleep?" } : null,
    citations: role === "assistant" ? [WHO] : [],
    model: role === "assistant" ? "openai/gpt-oss-20b" : null,
    signature: role === "assistant" ? `sig-${seq}` : null,
    created_at: "2026-10-20T08:00:00Z",
  };
}

function fakeActions(overrides: Partial<ChatActions> = {}): ChatActions {
  return {
    send: vi.fn().mockResolvedValue({ kind: "response", response: reply("Keep a regular schedule.\n\n- Tip one\n- **Tip two**") }),
    loadConversations: vi.fn().mockResolvedValue({ ok: true, data: { conversations: [], next_cursor: null } }),
    openConversation: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn().mockResolvedValue({ ok: true, data: null }),
    deleteAllChats: vi.fn().mockResolvedValue({ ok: true, data: null }),
    setHistoryEnabled: vi.fn().mockResolvedValue({ ok: true, data: HISTORY_ON }),
    ...overrides,
  };
}

function workspace(actions: ChatActions, props: Partial<React.ComponentProps<typeof ChatWorkspace>> = {}) {
  return render(
    <ChatWorkspace
      actions={actions}
      suggestions={PROMPTS.map((p) => ({ id: p.prompt_id, text: p.en, followUp: p.follow_up }))}
      topics={TOPICS}
      typedInput="topics"
      modeNote="An AI model (openai/gpt-oss-20b, via Groq) writes replies."
      history={HISTORY_OFF}
      {...props}
    />,
  );
}

async function typeAndSend(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Ask a general question"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  getVerifiedSession.mockResolvedValue(SESSION);
  backend.fetchMyConsent.mockResolvedValue(ok(myConsent("granted", VERSION)));
  backend.fetchChatConfig.mockResolvedValue(ok(CONFIG));
  backend.sendChatMessage.mockResolvedValue(ok(reply("Hello.")));
  backend.listConversations.mockResolvedValue(ok({ conversations: [], next_cursor: null }));
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
});

// --- Page -------------------------------------------------------------------------------

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
    expect(screen.queryByLabelText("Ask a general question")).toBeNull();
  });

  it("renders the full workspace with a working composer, topics and the Groq note", async () => {
    render(await ChatPage());
    const input = screen.getByLabelText("Ask a general question") as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    expect(screen.getByRole("heading", { name: "New chat" })).toBeTruthy();
    expect(screen.getByText("Topics I can answer right now")).toBeTruthy();
    expect(screen.getByText("Sleep")).toBeTruthy();
    expect(screen.getByText(/never your own words/)).toBeTruthy();
    expect(screen.getByText(/isn't a therapist or doctor/)).toBeTruthy();
    expect(screen.getAllByText("Not saved").length).toBeGreaterThan(0);
    // Only the conversation list is loaded on page load, never messages.
    expect(backend.listConversations).toHaveBeenCalledTimes(1);
    expect(backend.fetchConversation).not.toHaveBeenCalled();
  });

  it("does not load history when the server can't store it", async () => {
    backend.fetchChatConfig.mockResolvedValue(ok({ ...CONFIG, history: { ...HISTORY_OFF, available: false } }));
    render(await ChatPage());
    expect(backend.listConversations).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Saved chats aren't available yet/).length).toBeGreaterThan(0);
  });

  it("explains when chat is switched off", async () => {
    backend.fetchChatConfig.mockResolvedValue(ok({ ...CONFIG, enabled: false }));
    render(await ChatPage());
    expect(screen.getByRole("status").textContent).toMatch(/isn.t available yet/);
    expect(screen.queryByLabelText("Ask a general question")).toBeNull();
  });
});

// --- Server actions ----------------------------------------------------------------------

describe("chat actions", () => {
  it("forwards a typed message with the last six well-formed turns and a client id", async () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ role: "user" as const, text: `t${i}` }));
    const result = await sendChat({ message: "  hi  ", history: [...history, { role: "system", text: "x" } as never], clientMessageId: CLIENT_ID });
    expect(result).toEqual({ kind: "response", response: reply("Hello.") });
    const [, body] = backend.sendChatMessage.mock.calls[0] ?? [];
    expect(body.message).toBe("hi");
    expect(body.history).toHaveLength(6);
    expect(body.client_message_id).toBe(CLIENT_ID);
    expect(body.conversation_id).toBeUndefined();
  });

  it("never sends browser history with a saved conversation", async () => {
    await sendChat({ message: "tell me more", conversationId: CONV_ID, history: [{ role: "user", text: "injected" }] });
    const [, body] = backend.sendChatMessage.mock.calls[0] ?? [];
    expect(body).toEqual({ message: "tell me more", history: [], conversation_id: CONV_ID, client_message_id: undefined });
  });

  it("drops malformed ids", async () => {
    await sendChat({ message: "hi", conversationId: "../../admin", clientMessageId: "x" });
    const [, body] = backend.sendChatMessage.mock.calls[0] ?? [];
    expect(body.conversation_id).toBeUndefined();
    expect(body.client_message_id).toBeUndefined();
    expect(await openConversation("not-a-uuid")).toMatchObject({ ok: false, code: "not_found" });
    expect(backend.fetchConversation).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(2001)])("rejects %j without calling the API", async (message) => {
    expect((await sendChat({ message })).kind).toBe("error");
    expect(backend.sendChatMessage).not.toHaveBeenCalled();
  });

  it.each([
    [fail(401, "unauthorized"), "/sign-in?next=/chat"],
    [fail(403, "consent_required"), "/onboarding/consent"],
  ])("redirects on %o", async (result, url) => {
    backend.sendChatMessage.mockResolvedValue(result);
    expect(await expectRedirect(sendChat({ message: "hi" }))).toBe(url);
  });

  it.each([
    ["rate_limited", /wait a minute/],
    ["invalid_history", /start a new chat/],
    ["network_error", /couldn.t respond/],
    ["chat_unavailable", /switched off/],
    ["age_band_unavailable", /isn.t available for your account/],
    ["history_off", /saved chat can.t continue/],
    ["history_full", /Delete some older chats/],
    ["conversation_not_found", /no longer exists/],
  ])("maps %s to a safe message", async (code, pattern) => {
    backend.sendChatMessage.mockResolvedValue(fail(code === "rate_limited" ? 429 : 0, code));
    const result = await sendChat({ message: "hi" });
    expect(result.kind === "error" && result.message).toMatch(pattern);
  });

  it("validates titles and treats an already-deleted chat as deleted", async () => {
    expect(await renameChat(CONV_ID, "   ")).toMatchObject({ ok: false, code: "invalid" });
    expect(await renameChat(CONV_ID, "x".repeat(81))).toMatchObject({ ok: false, code: "invalid" });
    expect(backend.renameConversation).not.toHaveBeenCalled();
    backend.renameConversation.mockResolvedValue(ok(summary(CONV_ID, "Sleep notes")));
    expect(await renameChat(CONV_ID, "  Sleep \n notes ")).toMatchObject({ ok: true });
    expect(backend.renameConversation).toHaveBeenCalledWith(SESSION.accessToken, CONV_ID, "Sleep notes");
    backend.deleteConversation.mockResolvedValue(fail(404, "conversation_not_found"));
    expect(await deleteChat(CONV_ID)).toEqual({ ok: true, data: null });
  });

  it("passes the consent version only when opting in, and trims searches", async () => {
    backend.updateHistorySettings.mockResolvedValue(ok(HISTORY_ON));
    await setHistoryEnabled(true, "chat-history-v1");
    await setHistoryEnabled(false);
    expect(backend.updateHistorySettings.mock.calls).toEqual([
      [SESSION.accessToken, true, "chat-history-v1"],
      [SESSION.accessToken, false, undefined],
    ]);
    await loadConversations(undefined, `  ${"q".repeat(100)}  `);
    expect(backend.listConversations.mock.calls[0]?.[1]).toEqual({ cursor: undefined, q: "q".repeat(80) });
  });
});

// --- Workspace ---------------------------------------------------------------------------

describe("chat workspace", () => {
  it("sends a typed question and renders a formatted, cited answer", async () => {
    const actions = fakeActions();
    workspace(actions);
    await typeAndSend("How can I sleep better at night?");
    expect(await screen.findByText("Tip one")).toBeTruthy();
    expect(screen.getByText("Tip two").tagName).toBe("STRONG");
    expect(screen.getByText("Tip one").closest("ul")).toBeTruthy();
    expect(screen.getByText(/Answered as:/).textContent).toMatch(/What habits help with better sleep\?/);
    expect(screen.getByText("Sources (1)")).toBeTruthy(); // two passages, one source
    const link = screen.getByRole("link", { name: /who\.int/ });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("Publisher guidance, not clinically reviewed")).toBeTruthy();
    const input = (actions.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(input).toMatchObject({ message: "How can I sleep better at night?", history: [], conversationId: undefined });
    expect(input.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
    expect((screen.getByLabelText("Ask a general question") as HTMLTextAreaElement).value).toBe("");
  });

  it("explains refusals in plain language and keeps refused turns out of the context", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ kind: "response", response: refusal("unsupported_topic") })
      .mockResolvedValueOnce({ kind: "response", response: reply("Answer.") })
      .mockResolvedValueOnce({ kind: "response", response: reply("More.") });
    workspace(fakeActions({ send }));
    await typeAndSend("My boss shouts at me");
    expect((await screen.findByRole("note")).textContent).toMatch(/couldn't match that to one of the topics/);
    await typeAndSend("What is mindfulness?");
    await screen.findByText("Answer.");
    await typeAndSend("tell me more");
    await screen.findByText("More.");
    expect(send.mock.calls[2]?.[0].history).toEqual([
      { role: "user", text: "What is mindfulness?" },
      { role: "assistant", text: "Answer.", signature: "sig-1" },
    ]);
  });

  it.each([
    ["clinical", /can't help with diagnoses, medication or physical symptoms/],
    ["personal_details", /remove personal details/],
    ["sensitive", /outside what this wellness-education assistant covers/],
  ] as const)("explains a %s refusal", async (reason, text) => {
    workspace(fakeActions({ send: vi.fn().mockResolvedValue({ kind: "response", response: refusal(reason) }) }));
    await typeAndSend("anything");
    expect((await screen.findByRole("note")).textContent).toMatch(text);
  });

  it("shows follow-up suggestions only after an answer", async () => {
    workspace(fakeActions());
    expect(screen.queryByRole("button", { name: "Can you give me a short summary?" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "What habits help with better sleep?" }));
    await screen.findByText("Tip one");
    const followUps = screen.getByRole("list", { name: "Follow-up questions" });
    expect(within(followUps).getByRole("button", { name: "Can you give me a short summary?" })).toBeTruthy();
  });

  it("sends with Enter, adds a line with Shift+Enter, and never sends empty text", async () => {
    const actions = fakeActions();
    workspace(actions);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Ask a general question") as HTMLTextAreaElement;
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, "   {Enter}");
    expect(actions.send).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "What is{Shift>}{Enter}{/Shift}mindfulness?");
    expect(input.value).toBe("What is\nmindfulness?");
    await user.type(input, "{Enter}");
    await waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
  });

  it("prevents a duplicate send while one is in flight", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const send = vi.fn().mockImplementation(() => new Promise((r) => (resolve = r)));
    workspace(fakeActions({ send }));
    const input = screen.getByLabelText("Ask a general question");
    fireEvent.change(input, { target: { value: "What is mindfulness?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "What is mindfulness?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ kind: "response", response: reply("Done.") }));
    expect(await screen.findByText("Done.")).toBeTruthy();
  });

  it("keeps the text on errors and retries with the same client id", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ kind: "error", message: "The assistant couldn't respond right now. Please try again.", code: "failed" })
      .mockResolvedValueOnce({ kind: "response", response: reply("Recovered.") });
    workspace(fakeActions({ send }));
    await typeAndSend("What is mindfulness?");
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't respond/);
    expect((screen.getByLabelText("Ask a general question") as HTMLTextAreaElement).value).toBe("What is mindfulness?");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Recovered.")).toBeTruthy();
    expect(send.mock.calls[1]?.[0].clientMessageId).toBe(send.mock.calls[0]?.[0].clientMessageId);
  });

  it("saves into the sidebar when history is on, then continues by conversation id", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ kind: "response", response: reply("First.", { conversation: summary() }) })
      .mockResolvedValueOnce({ kind: "response", response: reply("Second.", { conversation: { ...summary(), message_count: 4 } }) });
    workspace(fakeActions({ send }), { history: HISTORY_ON });
    await typeAndSend("How can I sleep better?");
    await screen.findByText("First.");
    const nav = screen.getAllByRole("navigation", { name: "Chats" })[0]!;
    expect(within(nav).getByRole("button", { name: /^What habits help with better sleep\?/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Saved")).toBeTruthy();
    await typeAndSend("tell me more");
    await screen.findByText("Second.");
    expect(send.mock.calls[1]?.[0]).toMatchObject({ conversationId: CONV_ID, history: [] });
  });

  it("restores an older conversation and continues it", async () => {
    const openConversation = vi.fn().mockResolvedValue({
      ok: true,
      data: { conversation: summary(), messages: [stored(1, "user", "How can I sleep better?"), stored(2, "assistant", "Old answer.")], next_before: null },
    });
    const send = vi.fn().mockResolvedValue({ kind: "response", response: reply("Continued.", { conversation: summary() }) });
    workspace(fakeActions({ openConversation, send }), {
      history: HISTORY_ON,
      initialConversations: { conversations: [summary(), summary(OTHER_ID, "What is mindfulness?")], next_cursor: null },
    });
    const nav = screen.getAllByRole("navigation", { name: "Chats" })[0]!;
    await userEvent.setup().click(within(nav).getByRole("button", { name: /^What habits help/ }));
    expect(await screen.findByText("Old answer.")).toBeTruthy();
    expect(openConversation).toHaveBeenCalledWith(CONV_ID);
    expect(screen.getByRole("heading", { name: "What habits help with better sleep?" })).toBeTruthy();
    await typeAndSend("tell me more");
    await screen.findByText("Continued.");
    expect(send.mock.calls[0]?.[0]).toMatchObject({ conversationId: CONV_ID, history: [] });
  });

  it("loads earlier messages on request", async () => {
    const openConversation = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { conversation: summary(), messages: [stored(3, "user", "Newer q"), stored(4, "assistant", "Newer a")], next_before: 3 } })
      .mockResolvedValueOnce({ ok: true, data: { conversation: summary(), messages: [stored(1, "user", "Older q"), stored(2, "assistant", "Older a")], next_before: null } });
    workspace(fakeActions({ openConversation }), { history: HISTORY_ON, initialConversations: { conversations: [summary()], next_cursor: null } });
    const user = userEvent.setup();
    await user.click(within(screen.getAllByRole("navigation", { name: "Chats" })[0]!).getByRole("button", { name: /^What habits/ }));
    await screen.findByText("Newer a");
    await user.click(screen.getByRole("button", { name: "Show earlier messages" }));
    expect(await screen.findByText("Older a")).toBeTruthy();
    expect(openConversation).toHaveBeenLastCalledWith(CONV_ID, 3);
    const texts = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(texts.findIndex((x) => x.includes("Older q"))).toBeLessThan(texts.findIndex((x) => x.includes("Newer q")));
  });

  it("renames and deletes a conversation from the sidebar", async () => {
    const renameChat = vi.fn().mockResolvedValue({ ok: true, data: summary(CONV_ID, "Sleep notes") });
    const deleteChat = vi.fn().mockResolvedValue({ ok: true, data: null });
    workspace(fakeActions({ renameChat, deleteChat }), { history: HISTORY_ON, initialConversations: { conversations: [summary()], next_cursor: null } });
    const user = userEvent.setup();
    const nav = screen.getAllByRole("navigation", { name: "Chats" })[0]!;
    await user.click(within(nav).getByRole("button", { name: /Actions for/ }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByLabelText("Chat title");
    await user.clear(field);
    await user.type(field, "Sleep notes{Enter}");
    expect(await within(nav).findByText("Sleep notes")).toBeTruthy();
    expect(renameChat).toHaveBeenCalledWith(CONV_ID, "Sleep notes");
    await user.click(within(nav).getByRole("button", { name: /Actions for/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(nav).queryByText("Sleep notes")).toBeNull());
    expect(deleteChat).toHaveBeenCalledWith(CONV_ID);
  });

  it("searches titles on the server", async () => {
    const loadConversations = vi.fn().mockResolvedValue({ ok: true, data: { conversations: [summary(OTHER_ID, "What is mindfulness?")], next_cursor: null } });
    workspace(fakeActions({ loadConversations }), { history: HISTORY_ON, initialConversations: { conversations: [summary()], next_cursor: null } });
    await userEvent.setup().type(screen.getAllByLabelText("Search saved chats")[0]!, "mind");
    await waitFor(() => expect(loadConversations).toHaveBeenCalledWith(undefined, "mind"));
    const nav = screen.getAllByRole("navigation", { name: "Chats" })[0]!;
    expect(await within(nav).findByText("What is mindfulness?")).toBeTruthy();
    expect(within(nav).queryByText("What habits help with better sleep?")).toBeNull();
  });

  it("asks for informed consent before saving, and declining keeps chats unsaved", async () => {
    const actions = fakeActions();
    workspace(actions);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Turn on saved chats" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Save your chats?" });
    expect(dialog.textContent).toMatch(/isn't end-to-end encryption/);
    expect(dialog.textContent).toMatch(/90 days/);
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.setHistoryEnabled).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Turn on saved chats" })[0]!);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Turn on saved chats" })[0]!);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save my chats" }));
    await waitFor(() => expect(actions.setHistoryEnabled).toHaveBeenCalledWith(true, "chat-history-v1"));
    expect(await screen.findAllByText("Saving chats is on")).toBeTruthy();
  });

  it("can stop saving and delete all saved chats", async () => {
    const actions = fakeActions({ setHistoryEnabled: vi.fn().mockResolvedValue({ ok: true, data: HISTORY_OFF }) });
    workspace(actions, { history: HISTORY_ON, initialConversations: { conversations: [summary()], next_cursor: null } });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Stop saving new chats" })[0]!);
    expect(actions.setHistoryEnabled).toHaveBeenCalledWith(false);
    expect((await screen.findAllByText(/Chats you saved earlier stay here/)).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Delete all saved chats" })[0]!);
    await user.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(actions.deleteAllChats).toHaveBeenCalled());
    const nav = screen.getAllByRole("navigation", { name: "Chats" })[0]!;
    await waitFor(() => expect(within(nav).queryByText("What habits help with better sleep?")).toBeNull());
  });

  it("opens the chat list as a drawer on phones and closes it with Escape", async () => {
    workspace(fakeActions(), { history: HISTORY_ON, initialConversations: { conversations: [summary()], next_cursor: null } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open chat list" }));
    const drawer = screen.getByRole("dialog", { name: "Chats" });
    expect(drawer.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull();
  });

  it("hides the phone tab bar while composing", () => {
    workspace(fakeActions());
    const input = screen.getByLabelText("Ask a general question");
    fireEvent.focus(input);
    expect(document.documentElement.dataset.chatComposing).toBe("true");
    fireEvent.blur(input);
    expect(document.documentElement.dataset.chatComposing).toBeUndefined();
  });

  it("works in Arabic, right to left", async () => {
    workspace(fakeActions({ send: vi.fn().mockResolvedValue({ kind: "response", response: refusal("multiple_topics") }) }), { locale: "ar" });
    expect(screen.getByText("المواضيع اللي أقدر أرد عليها دلوقتي")).toBeTruthy();
    const input = screen.getByLabelText("اسأل سؤال عام");
    expect(input.getAttribute("dir")).toBe("auto");
    await userEvent.setup().type(input, "نصايح للنوم والتوتر{Enter}");
    expect((await screen.findByRole("note")).textContent).toMatch(/موضوع واحد/);
  });

  it("never stores the conversation in browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    workspace(fakeActions());
    await typeAndSend("What is mindfulness?");
    await screen.findByText("Tip one");
    expect(setItem).not.toHaveBeenCalled();
  });
});

// --- Markdown ---------------------------------------------------------------------------

describe("markdown", () => {
  it("parses paragraphs, bullets and numbered lists", () => {
    expect(parseBlocks("Intro line\n\n1. One\n2. Two\n\n- a\n- b\ncontinued")).toEqual([
      { kind: "p", lines: ["Intro line"] },
      { kind: "ol", items: ["One", "Two"], start: 1 },
      { kind: "ul", items: ["a", "b continued"] },
    ]);
  });

  it("renders text only: no HTML, images or links from model output", () => {
    const html = renderToStaticMarkup(
      <Markdown text={'<img src=x onerror="alert(1)"> [click](https://evil.example) **bold** <script>x</script>'} />,
    );
    expect(html).not.toMatch(/<img|<script|<a /);
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>bold</strong>");
  });
});
