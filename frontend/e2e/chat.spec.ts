import { expect, type Page, test } from "@playwright/test";

import { onboardedUser, signIn } from "./helpers";

// Local stack only (see README): curated topic mode, history keys set, scripted fake
// provider, real WHO/NIMH/NCCIH/CDC source files. Not a verification of production.

const SCREENS = "test-results/screens";

function composer(page: Page) {
  return page.getByRole("textbox", { name: /Ask a general question|اسأل سؤال عام/ });
}

function log(page: Page) {
  return page.getByRole("list", { name: /^(Conversation|المحادثة)$/ });
}

async function ask(page: Page, text: string) {
  const before = await log(page).locator(":scope > li").count().catch(() => 0);
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(log(page).locator(":scope > li")).toHaveCount(before + 2, { timeout: 20_000 });
}

/** Let the short message fade-in finish so screenshots show the settled state. */
async function settle(page: Page) {
  await page.waitForTimeout(400);
}

function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Chats" });
}

test.describe("chat workspace", () => {
  test("typed questions, refusals, saved history, reopen, continue, rename, delete, sign out and back in", async ({ browser }) => {
    const { user, context, page } = await onboardedUser(browser, "chatws");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/chat");
    await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible();
    await expect(page.getByText("Topics I can answer right now")).toBeVisible();
    await expect(composer(page)).toBeEnabled();
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/chat-desktop-empty.png` });

    // Unsaved by default: a typed question is answered from its reviewed topic.
    await ask(page, "How can I sleep better at night?");
    await expect(log(page).getByText(/Answered as:/)).toContainText("What habits help with better sleep?");
    await expect(log(page).getByText(/^Sources \(\d\)$/).first()).toBeVisible();
    await expect(page.getByText("Not saved", { exact: true })).toBeVisible();

    // Unsupported and personal text is refused with an explanation.
    await ask(page, "My boss shouts at me every day, what should I do?");
    await expect(log(page).getByRole("note").last()).toContainText("couldn't match that to one of the topics");

    // Opt in, with the storage notice.
    await sidebar(page).getByRole("button", { name: "Turn on saved chats" }).click();
    const dialog = page.getByRole("dialog", { name: "Save your chats?" });
    await expect(dialog).toContainText("isn't end-to-end encryption");
    await dialog.getByRole("button", { name: "Save my chats" }).click();
    await expect(sidebar(page).getByText("Saving chats is on")).toBeVisible();

    // New chat → saved conversation in the sidebar.
    await sidebar(page).getByRole("button", { name: "New chat", exact: true }).click();
    await ask(page, "What is mindfulness?");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: /^What is mindfulness\?/ })).toHaveAttribute("aria-current", "page");
    await ask(page, "tell me more");
    await expect(log(page).locator(":scope > li")).toHaveCount(4);

    // Another conversation, then reopen and continue the first.
    await sidebar(page).getByRole("button", { name: "New chat", exact: true }).click();
    await ask(page, "ازاي انام كويس؟");
    await expect(sidebar(page).getByRole("button", { name: /^إيه العادات اللي تساعد على نوم أحسن/ })).toBeVisible();
    await sidebar(page).getByRole("button", { name: /^What is mindfulness\?/ }).click();
    await expect(log(page).locator(":scope > li")).toHaveCount(4);
    await ask(page, "summarize please");
    await expect(log(page).locator(":scope > li")).toHaveCount(6);
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/chat-desktop-conversation.png` });

    // Refresh keeps saved history.
    await page.reload();
    await expect(sidebar(page).getByRole("button", { name: /^What is mindfulness\?/ })).toBeVisible();
    await sidebar(page).getByRole("button", { name: /^What is mindfulness\?/ }).click();
    await expect(log(page).locator(":scope > li")).toHaveCount(6);

    // Rename and search.
    await sidebar(page).getByRole("button", { name: /Actions for What is mindfulness/ }).click();
    await sidebar(page).getByRole("menuitem", { name: "Rename" }).click();
    await sidebar(page).getByLabel("Chat title").fill("Mindfulness notes");
    await sidebar(page).getByLabel("Chat title").press("Enter");
    await expect(sidebar(page).getByRole("button", { name: /^Mindfulness notes/ })).toBeVisible();
    await sidebar(page).getByLabel("Search saved chats").fill("notes");
    await expect(sidebar(page).getByRole("button", { name: /^إيه العادات/ })).toHaveCount(0);
    await sidebar(page).getByLabel("Search saved chats").fill("");

    // Sign out and back in: the history is still there.
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL("**/sign-in?status=signed-out");
    await signIn(page, user);
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
    await page.goto("/chat");
    await expect(sidebar(page).getByRole("button", { name: /^Mindfulness notes/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible(); // nothing opened uninvited

    // Delete one, then stop saving and delete everything.
    await sidebar(page).getByRole("button", { name: /Actions for Mindfulness notes/ }).click();
    await sidebar(page).getByRole("menuitem", { name: "Delete" }).click();
    await sidebar(page).getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(sidebar(page).getByRole("button", { name: /^Mindfulness notes/ })).toHaveCount(0);
    await page.reload();
    await expect(sidebar(page).getByRole("button", { name: /^Mindfulness notes/ })).toHaveCount(0);
    await sidebar(page).getByRole("button", { name: "Stop saving new chats" }).click();
    await expect(sidebar(page).getByText("Chats aren't saved", { exact: true })).toBeVisible();
    await sidebar(page).getByRole("button", { name: "Delete all saved chats" }).click();
    await sidebar(page).getByRole("button", { name: "Delete all" }).click();
    await expect(sidebar(page).getByRole("button", { name: /^إيه العادات/ })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await context.close();
  });

  test("natural wording works; clinical, personal and crisis messages are not answered", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "chatnatural");
    await page.goto("/chat");
    await ask(page, "I'm stressed about exams. What general coping techniques might help?");
    await expect(log(page).getByText(/Answered as:/).last()).toContainText("(Context: exams)");
    await expect(log(page).getByText(/^Sources \(\d\)$/).last()).toBeVisible();
    await ask(page, "What can I do to relax after a difficult day?");
    await ask(page, "Can you explain mindfulness simply?");
    await expect(log(page).getByRole("note")).toHaveCount(0); // all three answered
    await ask(page, "What medication helps with sleep?");
    await expect(log(page).getByRole("note").last()).toContainText("can't help with diagnoses, medication");
    await ask(page, "my number is 01012345678, any sleep tips?");
    await expect(log(page).getByRole("note").last()).toContainText("remove personal details");
    await ask(page, "I feel hopeless");
    await expect(log(page).getByRole("note").last()).toHaveAttribute("data-status", "support");
    await context.close();
  });

  test("another account never sees someone else's saved chats", async ({ browser }) => {
    const owner = await onboardedUser(browser, "chatowner");
    await owner.page.goto("/chat");
    await owner.page.getByRole("button", { name: "Turn on saved chats" }).first().click();
    await owner.page.getByRole("button", { name: "Save my chats" }).click();
    await ask(owner.page, "What is mindfulness?");
    await expect(sidebar(owner.page).getByRole("button", { name: /^What is mindfulness\?/ })).toBeVisible();

    const other = await onboardedUser(browser, "chatother");
    await other.page.goto("/chat");
    await other.page.getByRole("button", { name: "Turn on saved chats" }).first().click();
    await other.page.getByRole("button", { name: "Save my chats" }).click();
    await expect(sidebar(other.page).getByText(/No saved chats yet/)).toBeVisible();
    await owner.context.close();
    await other.context.close();
  });

  test("desktop layout: only the message list scrolls, and reading is never interrupted", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "chatscroll");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/chat");
    for (const q of ["What is mindfulness?", "tell me more", "summarize please", "How can I sleep better?", "tell me more"]) {
      await ask(page, q);
    }
    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector("section[aria-label='Conversation'] .overflow-y-auto") as HTMLElement;
      const box = document.querySelector("#chat-message")!.getBoundingClientRect();
      return {
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        listScrolls: scroller.scrollHeight > scroller.clientHeight,
        atBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80,
        composerVisible: box.bottom <= window.innerHeight && box.top > 0,
      };
    });
    expect(metrics).toEqual({ pageScrolls: false, listScrolls: true, atBottom: true, composerVisible: true });

    // Reading an older answer while a reply is on its way: the reply doesn't yank the
    // view; a jump control appears instead. (The send is slowed down to leave time to scroll.)
    await page.route("**/chat", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const before = await log(page).locator(":scope > li").count();
    await composer(page).fill("What is mindfulness?");
    await composer(page).press("Enter");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      (document.querySelector("section[aria-label='Conversation'] .overflow-y-auto") as HTMLElement).scrollTop = 0;
    });
    await expect(log(page).locator(":scope > li")).toHaveCount(before + 2, { timeout: 20_000 });
    const top = await page.evaluate(() => (document.querySelector("section[aria-label='Conversation'] .overflow-y-auto") as HTMLElement).scrollTop);
    expect(top).toBeLessThan(50);
    await page.unroute("**/chat");
    await page.getByRole("button", { name: "Jump to latest" }).click();
    await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
    await context.close();
  });

  for (const [name, width, height] of [
    ["mobile", 390, 844],
    ["small", 320, 640],
  ] as const) {
    test(`${name} layout (${width}px): full width, drawer, no horizontal overflow, composer above the tab bar`, async ({ browser }) => {
      const { context, page } = await onboardedUser(browser, `chat${name}`);
      await page.setViewportSize({ width, height });
      await page.goto("/chat");
      await ask(page, "What is mindfulness?");
      await composer(page).blur();
      const layout = await page.evaluate(() => {
        const box = document.querySelector("#chat-message")!.getBoundingClientRect();
        const tabs = document.querySelector("[data-bottom-tabs]")!.getBoundingClientRect();
        return {
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          composerAboveTabs: box.bottom <= tabs.top + 1,
          composerWidth: box.width,
        };
      });
      expect(layout.horizontalOverflow).toBe(false);
      expect(layout.composerAboveTabs).toBe(true);
      expect(layout.composerWidth).toBeGreaterThan(width * 0.6);
      await settle(page);
    await page.screenshot({ path: `${SCREENS}/chat-${name}-conversation.png` });

      await page.getByRole("button", { name: "Open chat list" }).click();
      await expect(page.getByRole("dialog", { name: "Chats" })).toBeVisible();
      await settle(page);
    await page.screenshot({ path: `${SCREENS}/chat-${name}-drawer.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Chats" })).toHaveCount(0);

      // Composing hides the tab bar so the box sits right above the keyboard.
      await composer(page).focus();
      await expect(page.locator("[data-bottom-tabs]")).toBeHidden();
      await context.close();
    });
  }

  test("Arabic, right to left", async ({ browser }) => {
    const { context, page } = await onboardedUser(browser, "chatar");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chat");
    await page.getByRole("button", { name: /العربية/ }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("المواضيع اللي أقدر أرد عليها دلوقتي")).toBeVisible();
    await ask(page, "ازاي انام كويس؟");
    await expect(log(page).getByText(/^المصادر \(\d\)$/).first()).toBeVisible();
    await ask(page, "نصايح للنوم والتوتر");
    await expect(log(page).getByRole("note").last()).toContainText("موضوع واحد");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/chat-mobile-arabic.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/chat-desktop-arabic.png` });
    await page.emulateMedia({ colorScheme: "dark" });
    await settle(page);
    await page.screenshot({ path: `${SCREENS}/chat-desktop-arabic-dark.png` });
    await context.close();
  });
});
