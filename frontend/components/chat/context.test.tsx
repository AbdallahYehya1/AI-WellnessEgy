import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatActions, ChatWorkspace, DRAFT_KEY } from "@/components/chat/workspace";
import { ReflectionForm } from "@/components/mood/reflection-form";
import type { ChatCitation, ChatResponse, ContextSettings } from "@/lib/api/backend";
import type { ReflectionFormState } from "@/lib/mood/actions";

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

const CONTEXT_OFF: ContextSettings = {
  mode: "minimized",
  available: true,
  enabled: false,
  consent_version: "chat-context-v1",
  consented_version: null,
  provider: "Groq",
  model: "openai/gpt-oss-20b",
  processing_region: "United States",
  retention: "server text",
};
const SOURCE: ChatCitation = {
  chunk_id: "c1",
  source_title: "Signs of Abuse",
  publisher: "Office on Women's Health (OWH)",
  source_ref: "https://womenshealth.gov/relationships-and-safety/signs-abuse",
  version_label: "page-2026-10-24",
  synthetic: false,
  review_status: "draft",
};

function reply(extra: Partial<ChatResponse> = {}): ChatResponse {
  return {
    status: "reply",
    reply: { text: "Try planning one calm talk this week.", signature: "sig", citations: [], model: "openai/gpt-oss-20b" },
    notice: null,
    prototype: true,
    ...extra,
  };
}

function actions(overrides: Partial<ChatActions> = {}): ChatActions {
  return {
    send: vi.fn().mockResolvedValue({ kind: "response", response: reply() }),
    loadConversations: vi.fn().mockResolvedValue({ ok: true, data: { conversations: [], next_cursor: null } }),
    openConversation: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn(),
    deleteAllChats: vi.fn(),
    setHistoryEnabled: vi.fn(),
    setContextEnabled: vi.fn().mockResolvedValue({ ok: true, data: { ...CONTEXT_OFF, enabled: true, consented_version: "chat-context-v1" } }),
    ...overrides,
  };
}

function workspace(a: ChatActions, props: Partial<React.ComponentProps<typeof ChatWorkspace>> = {}) {
  return render(
    <ChatWorkspace
      actions={a}
      assistant={{ id: "relationships", name: "Marriage & Healthy Relationships", description: "", icon: "heart" }}
      showTopics={false}
      suggestions={[]}
      topics={[]}
      typedInput="topics"
      modeNote="Groq receives a general version of your question, never your own words."
      modeNoteShared="Because you chose to share your situation, Groq receives your message with names removed."
      history={null}
      context={CONTEXT_OFF}
      {...props}
    />,
  );
}

async function send(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Ask a general question"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  sessionStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
});

describe("sharing context with the AI (D-59)", () => {
  it("is off until the person reads the notice and agrees", async () => {
    const a = actions();
    workspace(a);
    expect(screen.getByText(/never your own words/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Share more detail" }));
    const dialog = screen.getByRole("dialog", { name: "Share your situation with the AI?" });
    for (const point of [/names, phone numbers, e-mail addresses/, /can miss things/, /Groq \(model openai\/gpt-oss-20b\)/, /processes requests in the United States/, /30 days/, /stop sharing at any time/]) {
      expect(within(dialog).getByText(point)).toBeTruthy();
    }
    expect(a.setContextEnabled).not.toHaveBeenCalled();
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Share my situation" }));
    expect(a.setContextEnabled).toHaveBeenCalledWith(true, "chat-context-v1");
    expect(await screen.findByRole("button", { name: "Stop sharing" })).toBeTruthy();
    expect(screen.getByText(/Because you chose to share your situation/)).toBeTruthy();
  });

  it("can be declined, and turned off again", async () => {
    const a = actions();
    workspace(a, { context: { ...CONTEXT_OFF, enabled: true } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(a.setContextEnabled).toHaveBeenCalledWith(false, undefined);
  });

  it("is not offered when the server keeps the structured question only", () => {
    workspace(actions(), { context: { ...CONTEXT_OFF, mode: "structured", available: false } });
    expect(screen.queryByRole("button", { name: "Share more detail" })).toBeNull();
  });

  it("shows exactly what the AI received, and labels an uncited reply as general guidance", async () => {
    const a = actions({
      send: vi.fn().mockResolvedValue({ kind: "response", response: reply({ provider_context: "My wife [name] feels neglected." }) }),
    });
    workspace(a, { context: { ...CONTEXT_OFF, enabled: true } });
    await send("My wife Sara feels neglected.");
    expect(await screen.findByText("My wife [name] feels neglected.")).toBeTruthy();
    expect(screen.getByText("Shared with the AI (details removed):")).toBeTruthy();
    expect(screen.getByText("General guidance. No source was cited for this reply.")).toBeTruthy();
  });
});

describe("support notices", () => {
  it("are shown in Arabic by kind, with verified numbers and vetted sources", async () => {
    const a = actions({
      send: vi.fn().mockResolvedValue({
        kind: "response",
        response: { status: "support", reply: null, notice: "English server text", prototype: true, support_kind: "relationship_safety", resources: [SOURCE] },
      }),
    });
    workspace(a, { locale: "ar" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("اسأل سؤال عام"), "جوزي بيضربني");
    await user.click(screen.getByRole("button", { name: "ابعت" }));
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("15115");
    expect(note.textContent).toContain("16000");
    expect(note.textContent).not.toContain("English server text");
    expect(within(note).getByText(/womenshealth\.gov/)).toBeTruthy();
  });
});

describe("Daily Reflection to chat", () => {
  it("offers a draft only after the person chooses it, and never sends it", async () => {
    const saved: ReflectionFormState = { saved: { emotions: ["anxious", "tired"], factors: ["work"], suggestions: ["career"] } };
    render(<ReflectionForm action={vi.fn(async () => saved)} assistantNames={{ career: "Career & Work" }} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Save reflection" }));
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull(); // nothing yet
    await userEvent.setup().click(await screen.findByRole("link", { name: "Start a chat with Career & Work that mentions these feelings" }));
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}");
    expect(stored).toEqual({
      assistant: "career",
      text: "Lately I've been feeling anxious and tired. I think work might be part of it. Can you help me think it through?",
    });

    const a = actions();
    workspace(a, { assistant: { id: "career", name: "Career & Work", description: "", icon: "briefcase" } });
    expect(screen.getByText(stored.text)).toBeTruthy();
    expect(a.send).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Use this message" }));
    expect((screen.getByLabelText("Ask a general question") as HTMLTextAreaElement).value).toBe(stored.text);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(a.send).not.toHaveBeenCalled();
  });

  it("is not offered to a different assistant", () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ assistant: "career", text: "draft" }));
    workspace(actions());
    expect(screen.queryByRole("button", { name: "Use this message" })).toBeNull();
  });
});

describe("setContextEnabled", () => {
  it("is wired to the server action", async () => {
    const a = actions();
    workspace(a);
    await userEvent.setup().click(screen.getByRole("button", { name: "Share more detail" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(a.setContextEnabled).not.toHaveBeenCalled();
  });
});
