import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AssistantDirectory, type DirectoryItem } from "@/components/assistants/directory";
import { Sidebar } from "@/components/chat/sidebar";
import { AssistantPreview } from "@/components/landing/assistant-preview";
import { ReflectionForm } from "@/components/mood/reflection-form";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import type { ConversationSummary, HistorySettings } from "@/lib/api/backend";
import { CATALOG } from "@/lib/assistants/catalog";
import { messages } from "@/lib/i18n/messages";

// Design system v2 (2026-10-25): the new interactive pieces behave, not just look right.

vi.mock("next/link", () => ({
  default: ({ href, children, className, onFocus, onMouseEnter }: Record<string, never>) => (
    <a href={href} className={className} onFocus={onFocus} onMouseEnter={onMouseEnter}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/preferences/actions", () => ({ setTheme: vi.fn(), setLocale: vi.fn() }));

const en = messages.en;

function item(id: string, name: string, group: DirectoryItem["group"], starters: string[]): DirectoryItem {
  return { id, icon: "sparkles", name, description: `${name} description`, starters, uses: ["Use"], hue: 200, group, ready: true };
}

const COPY = {
  filterLabel: en.v2.directory.filterLabel,
  searchLabel: en.v2.directory.searchLabel,
  searchPlaceholder: en.v2.directory.searchPlaceholder,
  noMatch: en.v2.directory.noMatch,
  goodFor: en.v2.directory.goodFor,
  tryAsking: en.v2.directory.tryAsking,
  startChat: en.v2.common.startChat,
  comingSoon: en.assistants.comingSoon,
  comingSoonBody: en.assistants.comingSoonBody,
  groups: en.v2.landing.groups,
};

describe("assistant directory", () => {
  const items = [
    item("career", "Career & Work", "work", ["I feel stuck in my career."]),
    item("family", "Family & Parenting", "people", ["How do I talk to my teenager?"]),
    item("finance", "Financial Wellbeing", "work", ["How do I save?"]),
  ];

  it("filters by group and by text, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<AssistantDirectory items={items} copy={COPY} />);
    const list = () => screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/chat?assistant=") && a.closest("li"));
    expect(list()).toHaveLength(3);

    await user.click(screen.getByRole("radio", { name: "People" }));
    expect(list().map((a) => a.getAttribute("href"))).toEqual(["/chat?assistant=family"]);
    expect(screen.getByRole("radio", { name: "People" }).getAttribute("aria-checked")).toBe("true");

    await user.click(screen.getByRole("radio", { name: "All" }));
    await user.type(screen.getByRole("searchbox", { name: en.v2.directory.searchLabel }), "teenager");
    expect(list().map((a) => a.getAttribute("href"))).toEqual(["/chat?assistant=family"]);

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "astronomy");
    expect(screen.getByRole("status").textContent).toBe(COPY.noMatch);
  });

  it("previews the assistant that has keyboard focus", () => {
    render(<AssistantDirectory items={items} copy={COPY} />);
    const finance = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/chat?assistant=finance" && a.closest("li"))!;
    fireEvent.focus(finance);
    expect(screen.getByText("“How do I save?”", { selector: "p:not(.truncate)" })).toBeTruthy();
  });
});

describe("hero assistant preview", () => {
  it("is a tablist operable with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    render(
      <AssistantPreview
        assistants={CATALOG}
        locale="en"
        copy={{ label: "Preview", ask: "You might ask", answer: "answer", sources: "Sources", illustrative: en.v2.common.illustrative }}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(10);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    tabs[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("tabpanel")).getByText(CATALOG[1]!.starter.en)).toBeTruthy();
    await user.keyboard("{End}");
    expect(tabs[9]!.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    // Honest preview: labelled illustrative, no generated answer text.
    expect(screen.getByText(en.v2.common.illustrative)).toBeTruthy();
  });
});

describe("theme switch", () => {
  it("offers the opposite of the saved theme, as a plain form", () => {
    document.documentElement.dataset.theme = "dark";
    const { container, unmount } = render(<ThemeSwitch t={en} />);
    expect(screen.getByRole("button", { name: en.v2.common.themeToLight })).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>('input[name="theme"]')!.value).toBe("light");
    unmount();
    document.documentElement.dataset.theme = "light";
    render(<ThemeSwitch t={en} />);
    expect(screen.getByRole("button", { name: en.v2.common.themeToDark })).toBeTruthy();
  });
});

describe("chat sidebar", () => {
  const history: HistorySettings = {
    available: true,
    enabled: true,
    consent_version: "v1",
    consented_version: "v1",
    retention_days: 90,
    max_conversations: 100,
  } as HistorySettings;
  const chat = (id: string, title: string, daysAgo: number): ConversationSummary => ({
    conversation_id: id,
    title,
    message_count: 2,
    created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    last_activity_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  });

  it("groups saved chats by date and marks the open one", () => {
    const noop = vi.fn();
    render(
      <Sidebar
        t={en.chat}
        locale="en"
        history={history}
        conversations={[chat("a", "Today chat", 0), chat("b", "Old chat", 30)]}
        activeId="a"
        query=""
        onQuery={noop}
        searching={false}
        hasMore={false}
        loadingMore={false}
        onLoadMore={noop}
        onNewChat={noop}
        onOpen={noop}
        onRename={vi.fn(async () => true)}
        onDelete={vi.fn(async () => undefined)}
        onTurnOn={noop}
        onTurnOff={noop}
        onDeleteAll={vi.fn(async () => undefined)}
        busy={false}
      />,
    );
    expect(screen.getByText(en.v2.chat.groupToday)).toBeTruthy();
    expect(screen.getByText(en.v2.chat.groupOlder)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Today chat/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /^Old chat/ }).getAttribute("aria-current")).toBeNull();
  });
});

describe("Daily Reflection selection", () => {
  it("announces how many feelings are selected", async () => {
    const user = userEvent.setup();
    render(<ReflectionForm action={vi.fn(async () => ({}))} assistantNames={{}} />);
    expect(screen.getByRole("group", { name: en.reflection.question })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: /Calm/ }));
    await user.click(screen.getByRole("checkbox", { name: /Tired/ }));
    expect(screen.getByText("2 selected")).toBeTruthy();
  });
});
