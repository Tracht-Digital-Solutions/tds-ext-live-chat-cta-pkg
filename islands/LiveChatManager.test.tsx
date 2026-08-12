// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveChatManager from "./LiveChatManager";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The admin management surface: the visitor-chat inbox, the FAQ editor and the
 * documentation editor.
 *
 * The inbox is the live half — an agent is looking at a thread while a visitor
 * types — so what gets pinned hardest is that a message is attributed to the
 * right side of the conversation, that the open/closed toggle sends the
 * OPPOSITE of the current state, and that the thread keeps polling.
 *
 * Error-path tests deliberately answer with a POPULATED body and a non-OK
 * status. Against an empty error body `res.ok ? (await res.json()).x ?? [] : []`
 * and a bare `await res.json()` are indistinguishable, so the ok-check could be
 * deleted with no test noticing.
 */

interface Reply {
  status: number;
  body: unknown;
}
type Handler = (url: string, init?: RequestInit) => Reply | undefined;

let calls: Array<{ url: string; method: string; body: unknown }> = [];
let handlers: Handler[] = [];

/** Register a reply, newest first (later `respond` calls win). */

/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");

function respond(match: RegExp, body: unknown, status = 200, method?: string) {
  handlers.unshift((url, init) => {
    if (!match.test(pathOf(url))) return undefined;
    if (method && (init?.method ?? "GET") !== method) return undefined;
    return { status, body };
  });
}

const SESSIONS = "/admin/live-chat-cta/sessions";
const SESSION = {
  id: 3,
  visitor_name: "Lena Beispiel",
  visitor_email: "lena@example.de",
  frontend: "landingpage",
  status: "open" as const,
  created_at: "2026-07-20T09:00:00Z",
  last_activity_at: "2026-07-20T10:00:00Z",
  message_count: 2,
};
const THREAD = {
  status: "open",
  messages: [
    { id: 1, author: "visitor", body: "Hallo, ist jemand da?", created_at: "2026-07-20T09:00:00Z" },
    { id: 2, author: "agent", body: "Ja, wie können wir helfen?", created_at: "2026-07-20T09:01:00Z" },
  ],
};
const FAQ = {
  id: 11,
  lang: "de" as const,
  category: "Preise",
  question: "Was kostet das?",
  answer: "Es kommt darauf an.",
  sort_order: 10,
  is_published: 1,
};
const DOC = {
  id: 21,
  lang: "de" as const,
  slug: "erste-schritte",
  title: "Erste Schritte",
  body_markdown: "# Los geht's",
  sort_order: 10,
  is_published: 1,
};

/** Outcomes are toasts now — collected off the `tds:toast` bus. */
let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
  calls = [];
  // jsdom has no scrollIntoView at all; the thread calls it on every render.
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
  handlers = [() => ({ status: 200, body: {} })];
  respond(/^\/admin\/live-chat-cta\/sessions(\?|$)/, { sessions: [] });
  respond(/^\/admin\/live-chat-cta\/faqs$/, { faqs: [] });
  respond(/^\/admin\/live-chat-cta\/docs$/, { docs: [] });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const reply = handlers.map((h) => h(url, init)).find((r) => r !== undefined)!;
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
    }),
  );
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collectToast);
  cleanup();
  vi.useRealTimers();
});

const user = () => userEvent.setup({ delay: null });
const sent = (method: string, match: RegExp) => calls.filter((c) => c.method === method && match.test(pathOf(c.url)));

async function open(tab?: string) {
  render(<LiveChatManager />);
  const u = user();
  if (tab) await u.click(screen.getByRole("tab", { name: tab }));
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return u;
}

describe("the tab bar", () => {
  it("offers the inbox and both knowledge bases", async () => {
    await open();
    for (const name of ["Chats", "FAQ", "Dokumentation"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }
  });

  it("starts on the chat inbox", async () => {
    await open();
    expect(screen.getByRole("tab", { name: "Chats" }).getAttribute("aria-selected")).toBe("true");
  });

  it("marks only the open tab as selected", async () => {
    const u = await open();
    await u.click(screen.getByRole("tab", { name: "FAQ" }));
    const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toBe("FAQ");
  });

  it("shows one editor at a time", async () => {
    const u = await open();
    await u.click(screen.getByRole("tab", { name: "Dokumentation" }));
    expect(await screen.findByRole("heading", { name: "Neuer Artikel" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Neue FAQ" })).toBeNull();
  });
});

describe("the chat inbox", () => {
  it("asks for OPEN chats first — the ones waiting on a reply", async () => {
    await open();
    expect(pathOf(calls[0]!.url)).toBe(`${SESSIONS}?status=open`);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("filters to closed chats", async () => {
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Geschlossen" }));
    await waitFor(() => expect(calls.some((c) => pathOf(c.url) === `${SESSIONS}?status=closed`)).toBe(true));
  });

  it("drops the filter entirely for Alle", async () => {
    // `?status=` would be a filter for the empty status, not "no filter".
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Alle" }));
    await waitFor(() => expect(calls.some((c) => pathOf(c.url) === SESSIONS)).toBe(true));
  });

  it("says so when nothing is waiting", async () => {
    await open();
    expect(await screen.findByText("Keine Chats.")).toBeTruthy();
  });

  it("names the visitor", async () => {
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    await open();
    expect(await screen.findByText("Lena Beispiel")).toBeTruthy();
  });

  it("falls back to the email when there is no name", async () => {
    respond(/sessions(\?|$)/, { sessions: [{ ...SESSION, visitor_name: null }] });
    await open();
    expect(await screen.findByText("lena@example.de")).toBeTruthy();
  });

  it("falls back to the session number when the visitor is anonymous", async () => {
    respond(/sessions(\?|$)/, { sessions: [{ ...SESSION, visitor_name: null, visitor_email: null }] });
    await open();
    expect(await screen.findByText("Besucher #3")).toBeTruthy();
  });

  it("prefers the name over the email", async () => {
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    await open();
    await screen.findByText("Lena Beispiel");
    expect(screen.queryByText("lena@example.de")).toBeNull();
  });

  it("shows where the chat came from and how long it is", async () => {
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    await open();
    const row = await screen.findByRole("button", { name: /Lena Beispiel/ });
    expect(row.textContent).toContain("landingpage");
    expect(row.textContent).toContain("2");
  });

  it("shows a dash for a chat with no known frontend", async () => {
    respond(/sessions(\?|$)/, { sessions: [{ ...SESSION, frontend: null }] });
    await open();
    const row = await screen.findByRole("button", { name: /Lena Beispiel/ });
    expect(row.textContent).toContain("–");
  });

  it("badges an open chat, not a closed one", async () => {
    respond(/sessions(\?|$)/, {
      sessions: [SESSION, { ...SESSION, id: 4, visitor_name: "Max Zu", status: "closed" }],
    });
    await open();
    const open_ = await screen.findByRole("button", { name: /Lena Beispiel/ });
    const closed = screen.getByRole("button", { name: /Max Zu/ });
    expect(within(open_).getByText("offen")).toBeTruthy();
    expect(within(closed).queryByText("offen")).toBeNull();
  });

  it("does NOT list sessions carried by a non-OK response", async () => {
    respond(/sessions(\?|$)/, { sessions: [SESSION] }, 403);
    await open();
    expect(await screen.findByText("Keine Chats.")).toBeTruthy();
  });

  it("tolerates a response with no sessions field", async () => {
    respond(/sessions(\?|$)/, {});
    await open();
    expect(await screen.findByText("Keine Chats.")).toBeTruthy();
  });

  it("prompts for a chat until one is opened", async () => {
    await open();
    expect(screen.getByText("Chat auswählen …")).toBeTruthy();
  });
});

describe("a chat thread", () => {
  async function openThread(thread: unknown = THREAD) {
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    // GET-scoped: an unscoped handler would also answer the PATCH and turn the
    // failed-status-change test green.
    respond(/^\/admin\/live-chat-cta\/sessions\/3$/, thread, 200, "GET");
    const u = await open();
    await u.click(await screen.findByRole("button", { name: /Lena Beispiel/ }));
    await screen.findByText("Hallo, ist jemand da?");
    return u;
  }
  /** The thread's own status bar (the list has an "offen" badge as well). */
  // The bespoke `.thread__head` was replaced by the shared `.tds-row--between`
  // head when the design library absorbed the chat chrome; this helper kept
  // querying the old class, returned null, and took four tests down with it.
  const head = () => document.querySelector(".thread .tds-row--between") as HTMLElement;

  it("loads the messages of the clicked chat", async () => {
    await openThread();
    expect(sent("GET", /sessions\/3$/)).toHaveLength(1);
    expect(screen.getByText("Ja, wie können wir helfen?")).toBeTruthy();
  });

  it("attributes each message to the RIGHT side of the conversation", async () => {
    // Asserting only that both messages render passes even when the visitor
    // and the agent are swapped — which would read as the agent asking for help.
    await openThread();
    // The sides are the shared thread primitive's now (this is the AGENT view,
    // so the agent is `--own`). The old `.msg--visitor`/`--agent` classes
    // matched no rule anywhere, which is why they were replaced — and why this
    // assertion had been passing over a null element ever since.
    expect(
      screen.getByText("Hallo, ist jemand da?").closest(".tds-thread__item")!.className,
    ).toContain("tds-thread__item--other");
    expect(
      screen.getByText("Ja, wie können wir helfen?").closest(".tds-thread__item")!.className,
    ).toContain("tds-thread__item--own");
  });

  it("shows the thread as open and offers to close it", async () => {
    // Scoped to the thread head — the session list carries an "offen" badge too.
    await openThread();
    expect(within(head()).getByText("offen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
  });

  it("shows a closed thread as closed and offers to reopen it", async () => {
    await openThread({ ...THREAD, status: "closed" });
    expect(within(head()).getByText("geschlossen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wieder öffnen" })).toBeTruthy();
  });

  it("assumes open when the API omits the status", async () => {
    await openThread({ messages: THREAD.messages });
    expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
  });

  it("sends the OPPOSITE status when toggling", async () => {
    const u = await openThread();
    await u.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(sent("PATCH", /sessions\/3$/)).toHaveLength(1));
    expect(sent("PATCH", /sessions\/3$/)[0]!.body).toEqual({ status: "closed" });
  });

  it("sends open when reopening", async () => {
    const u = await openThread({ ...THREAD, status: "closed" });
    await u.click(screen.getByRole("button", { name: "Wieder öffnen" }));
    await waitFor(() => expect(sent("PATCH", /sessions\/3$/)).toHaveLength(1));
    expect(sent("PATCH", /sessions\/3$/)[0]!.body).toEqual({ status: "open" });
  });

  it("refreshes the session list after a status change", async () => {
    // The list is filtered by status, so a closed chat must leave the open view.
    const u = await openThread();
    const before = sent("GET", /sessions(\?|$)/).length;
    await u.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(sent("GET", /sessions(\?|$)/).length).toBeGreaterThan(before));
  });

  it("does NOT flip the badge when the status change fails", async () => {
    // Showing "geschlossen" for a chat the backend still has open would make
    // an agent stop watching it.
    respond(/^\/admin\/live-chat-cta\/sessions\/3$/, { error: "nope" }, 500, "PATCH");
    const u = await openThread();
    await u.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(sent("PATCH", /sessions\/3$/)).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
    expect(within(head()).getByText("offen")).toBeTruthy();
  });

  it("does not render messages carried by a non-OK response", async () => {
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    respond(/^\/admin\/live-chat-cta\/sessions\/3$/, THREAD, 403);
    const u = await open();
    await u.click(await screen.findByRole("button", { name: /Lena Beispiel/ }));
    await waitFor(() => expect(sent("GET", /sessions\/3$/)).toHaveLength(1));
    expect(screen.queryByText("Hallo, ist jemand da?")).toBeNull();
  });
});

describe("replying to a visitor", () => {
  async function openThread() {
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    respond(/^\/admin\/live-chat-cta\/sessions\/3$/, THREAD);
    const u = await open();
    await u.click(await screen.findByRole("button", { name: /Lena Beispiel/ }));
    await screen.findByText("Hallo, ist jemand da?");
    return u;
  }
  const box = () => screen.getByPlaceholderText("Antwort schreiben …");
  const replies = () => sent("POST", /sessions\/3\/reply$/);

  it("keeps Senden disabled until something is typed", async () => {
    await openThread();
    expect((screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Senden disabled for whitespace only", async () => {
    const u = await openThread();
    await u.type(box(), "   ");
    expect((screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("posts the trimmed reply", async () => {
    const u = await openThread();
    await u.type(box(), "  Wir melden uns gleich.  ");
    await u.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(replies()).toHaveLength(1));
    expect(replies()[0]!.body).toEqual({ body: "Wir melden uns gleich." });
  });

  it("sends on Ctrl+Enter without reaching for the mouse", async () => {
    const u = await openThread();
    await u.type(box(), "Kurz und schnell");
    await u.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(replies()).toHaveLength(1));
  });

  it("does not send on a bare Enter — that is a new line", async () => {
    const u = await openThread();
    await u.type(box(), "Erste Zeile");
    await u.keyboard("{Enter}");
    expect(replies()).toHaveLength(0);
  });

  it("clears the box and re-reads the thread after sending", async () => {
    const u = await openThread();
    await u.type(box(), "Wir melden uns gleich.");
    await u.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect((box() as HTMLTextAreaElement).value).toBe(""));
    const postAt = calls.findIndex((c) => c.method === "POST" && /reply$/.test(c.url));
    const reloadAt = calls.findIndex((c, i) => i > postAt && c.method === "GET" && /sessions\/3$/.test(c.url));
    expect(reloadAt, "the thread must be re-read after a reply").toBeGreaterThan(postAt);
  });

  it("KEEPS the typed reply when sending fails", async () => {
    // Clearing it would lose the agent's text with no way to recover it.
    respond(/reply$/, { error: "nope" }, 500, "POST");
    const u = await openThread();
    await u.type(box(), "Wir melden uns gleich.");
    await u.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(replies()).toHaveLength(1));
    expect((box() as HTMLTextAreaElement).value).toBe("Wir melden uns gleich.");
  });

  it("does not re-read the thread after a failed send", async () => {
    respond(/reply$/, { error: "nope" }, 500, "POST");
    const u = await openThread();
    const before = sent("GET", /sessions\/3$/).length;
    await u.type(box(), "Wir melden uns gleich.");
    await u.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(replies()).toHaveLength(1));
    expect(sent("GET", /sessions\/3$/)).toHaveLength(before);
  });
});

describe("the live poll", () => {
  /** Flush the fetch promise chain AND the React updates it triggers. */
  const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("re-reads the open thread so a new visitor message appears", async () => {
    // An agent stares at a thread while the visitor types; without the poll
    // the new message only shows up on a manual reselect.
    vi.useFakeTimers();
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    respond(/^\/admin\/live-chat-cta\/sessions\/3$/, THREAD);
    render(<LiveChatManager />);
    await tick();

    fireEvent.click(screen.getByRole("button", { name: /Lena Beispiel/ }));
    await tick();
    expect(screen.getByText("Hallo, ist jemand da?")).toBeTruthy();

    respond(/^\/admin\/live-chat-cta\/sessions\/3$/, {
      ...THREAD,
      messages: [...THREAD.messages, { id: 3, author: "visitor", body: "Seid ihr noch da?", created_at: "2026-07-20T09:05:00Z" }],
    });
    await tick(4000);
    expect(screen.getByText("Seid ihr noch da?")).toBeTruthy();
  });

  it("stops polling once the thread is gone", async () => {
    // A leaked interval keeps hitting the API for every chat ever opened.
    vi.useFakeTimers();
    respond(/sessions(\?|$)/, { sessions: [SESSION] });
    respond(/^\/admin\/live-chat-cta\/sessions\/3$/, THREAD);
    const { unmount } = render(<LiveChatManager />);
    await tick();
    fireEvent.click(screen.getByRole("button", { name: /Lena Beispiel/ }));
    await tick(4000);
    const before = sent("GET", /sessions\/3$/).length;
    expect(before).toBeGreaterThan(1);
    unmount();
    await tick(20000);
    expect(sent("GET", /sessions\/3$/)).toHaveLength(before);
  });
});

describe("the FAQ editor", () => {
  async function openFaq(rows: unknown[] = []) {
    // GET-scoped: an unscoped handler would also answer the POST/PUT/DELETE
    // and quietly turn every failed-save test green.
    respond(/^\/admin\/live-chat-cta\/faqs$/, { faqs: rows }, 200, "GET");
    const u = await open("FAQ");
    await screen.findByRole("heading", { name: "Neue FAQ" });
    return u;
  }
  const field = (name: string) => screen.getByLabelText(name);

  it("loads the FAQ list", async () => {
    await openFaq([FAQ]);
    expect(await screen.findByText("Was kostet das?")).toBeTruthy();
  });

  it("does not list FAQs carried by a non-OK response", async () => {
    respond(/^\/admin\/live-chat-cta\/faqs$/, { faqs: [FAQ] }, 403);
    await open("FAQ");
    await screen.findByRole("heading", { name: "Neue FAQ" });
    expect(screen.queryByText("Was kostet das?")).toBeNull();
  });

  it("refuses to save without a question", async () => {
    const u = await openFaq();
    await u.type(field("Antwort"), "Nur eine Antwort");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Frage und Antwort sind erforderlich.")).toBeTruthy();
    expect(sent("POST", /faqs/)).toHaveLength(0);
  });

  it("refuses to save without an answer", async () => {
    const u = await openFaq();
    await u.type(field("Frage"), "Nur eine Frage?");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Frage und Antwort sind erforderlich.")).toBeTruthy();
    expect(sent("POST", /faqs/)).toHaveLength(0);
  });

  it("treats a whitespace-only question as empty", async () => {
    const u = await openFaq();
    await u.type(field("Frage"), "   ");
    await u.type(field("Antwort"), "Antwort");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Frage und Antwort sind erforderlich.")).toBeTruthy();
  });

  it("CREATES with POST to the collection", async () => {
    const u = await openFaq();
    await u.type(field("Frage"), "Was kostet das?");
    await u.type(field("Antwort"), "Es kommt darauf an.");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /faqs$/)).toHaveLength(1));
    expect(pathOf(sent("POST", /faqs$/)[0]!.url)).toBe("/admin/live-chat-cta/faqs");
    expect(sent("POST", /faqs$/)[0]!.body).toMatchObject({
      lang: "de",
      question: "Was kostet das?",
      answer: "Es kommt darauf an.",
      is_published: 1,
    });
  });

  it("UPDATES with PUT to the row — never creating a duplicate", async () => {
    const u = await openFaq([FAQ]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("PUT", /faqs\/11$/)).toHaveLength(1));
    expect(sent("POST", /faqs/)).toHaveLength(0);
  });

  it("loads the row into the form when editing", async () => {
    const u = await openFaq([FAQ]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByRole("heading", { name: "FAQ bearbeiten" })).toBeTruthy();
    expect((field("Frage") as HTMLInputElement).value).toBe("Was kostet das?");
    expect((field("Antwort") as HTMLTextAreaElement).value).toBe("Es kommt darauf an.");
    expect((field("Kategorie") as HTMLInputElement).value).toBe("Preise");
  });

  it("turns a null category into an empty string when editing", async () => {
    // The input's own `?? ""` hides this on screen — the difference only shows
    // in what gets SAVED. A create sends `""` (from `emptyFaq`), so an edit of
    // an uncategorised row must send `""` too, not `null`.
    const u = await openFaq([{ ...FAQ, category: null }]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    expect((field("Kategorie") as HTMLInputElement).value).toBe("");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("PUT", /faqs\/11$/)).toHaveLength(1));
    expect((sent("PUT", /faqs\/11$/)[0]!.body as { category: unknown }).category).toBe("");
  });

  it("sends the edited values, not the loaded ones", async () => {
    const u = await openFaq([FAQ]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    await u.clear(field("Frage"));
    await u.type(field("Frage"), "Was kostet es wirklich?");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("PUT", /faqs\/11$/)).toHaveLength(1));
    expect(sent("PUT", /faqs\/11$/)[0]!.body).toMatchObject({ id: 11, question: "Was kostet es wirklich?" });
  });

  it("returns to a blank form after saving", async () => {
    const u = await openFaq([FAQ]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("heading", { name: "Neue FAQ" })).toBeTruthy();
    expect((field("Frage") as HTMLInputElement).value).toBe("");
  });

  it("reloads the list after saving so the new row appears", async () => {
    const u = await openFaq();
    await u.type(field("Frage"), "Was kostet das?");
    await u.type(field("Antwort"), "Es kommt darauf an.");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("GET", /faqs$/)).toHaveLength(2));
  });

  it("KEEPS the form filled when the save fails", async () => {
    respond(/faqs/, { error: "nope" }, 500, "POST");
    const u = await openFaq();
    await u.type(field("Frage"), "Was kostet das?");
    await u.type(field("Antwort"), "Es kommt darauf an.");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect((field("Frage") as HTMLInputElement).value).toBe("Was kostet das?");
  });

  it("does not reload the list after a failed save", async () => {
    respond(/faqs/, { error: "nope" }, 500, "POST");
    const u = await openFaq();
    await u.type(field("Frage"), "Was kostet das?");
    await u.type(field("Antwort"), "Es kommt darauf an.");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(sent("GET", /faqs$/)).toHaveLength(1);
  });

  it("abandons an edit without saving it", async () => {
    const u = await openFaq([FAQ]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    await u.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("heading", { name: "Neue FAQ" })).toBeTruthy();
    expect(sent("PUT", /faqs/)).toHaveLength(0);
  });

  it("offers Abbrechen only while editing", async () => {
    await openFaq();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
  });

  it("deletes the row it was asked to delete", async () => {
    const u = await openFaq([FAQ, { ...FAQ, id: 12, question: "Und sonst?" }]);
    await screen.findByText("Und sonst?");
    const row = screen.getAllByRole("listitem").find((li) => li.textContent!.includes("Und sonst?"))!;
    await u.click(within(row).getByRole("button", { name: "Löschen" }));
    await u.click(screen.getAllByRole("button", { name: /Löschen/ }).at(-1)!);
    await waitFor(() => expect(sent("DELETE", /faqs\/12$/)).toHaveLength(1));
    expect(sent("DELETE", /faqs\/11$/)).toHaveLength(0);
  });

  it("reloads the list after a delete", async () => {
    const u = await openFaq([FAQ]);
    await u.click(await screen.findByRole("button", { name: "Löschen" }));
    await u.click(screen.getAllByRole("button", { name: /Löschen/ }).at(-1)!);
    await waitFor(() => expect(sent("GET", /faqs$/)).toHaveLength(2));
  });

  it("does not reload after a failed delete", async () => {
    respond(/faqs\/11$/, { error: "nope" }, 500, "DELETE");
    const u = await openFaq([FAQ]);
    await u.click(await screen.findByRole("button", { name: "Löschen" }));
    await u.click(screen.getAllByRole("button", { name: /Löschen/ }).at(-1)!);
    await waitFor(() => expect(sent("DELETE", /faqs\/11$/)).toHaveLength(1));
    expect(sent("GET", /faqs$/)).toHaveLength(1);
  });

  it("marks an unpublished FAQ as a draft", async () => {
    respond(/^\/admin\/live-chat-cta\/faqs$/, { faqs: [{ ...FAQ, is_published: 0 }] });
    await open("FAQ");
    expect(await screen.findByText(/Entwurf/)).toBeTruthy();
  });

  it("does not mark a published FAQ as a draft", async () => {
    await openFaq([FAQ]);
    await screen.findByText("Was kostet das?");
    expect(screen.queryByText(/Entwurf/)).toBeNull();
  });

  it("sends the publication state the checkbox shows", async () => {
    const u = await openFaq();
    await u.type(field("Frage"), "Frage?");
    await u.type(field("Antwort"), "Antwort.");
    await u.click(screen.getByRole("checkbox", { name: "Veröffentlicht" }));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /faqs$/)).toHaveLength(1));
    expect((sent("POST", /faqs$/)[0]!.body as { is_published: number }).is_published).toBe(0);
  });

  it("sends the sort order as a number, not a string", async () => {
    // The backend orders by this column; a string sorts lexically.
    const u = await openFaq();
    await u.type(field("Frage"), "Frage?");
    await u.type(field("Antwort"), "Antwort.");
    await u.clear(field("Reihenfolge"));
    await u.type(field("Reihenfolge"), "20");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /faqs$/)).toHaveLength(1));
    expect((sent("POST", /faqs$/)[0]!.body as { sort_order: unknown }).sort_order).toBe(20);
  });

  it("sends the chosen language", async () => {
    const u = await openFaq();
    await u.type(field("Frage"), "How much?");
    await u.type(field("Antwort"), "It depends.");
    await u.selectOptions(field("Sprache"), "en");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /faqs$/)).toHaveLength(1));
    expect((sent("POST", /faqs$/)[0]!.body as { lang: string }).lang).toBe("en");
  });
});

describe("the documentation editor", () => {
  async function openDocs(rows: unknown[] = []) {
    respond(/^\/admin\/live-chat-cta\/docs$/, { docs: rows }, 200, "GET");
    const u = await open("Dokumentation");
    await screen.findByRole("heading", { name: "Neuer Artikel" });
    return u;
  }
  const field = (name: string) => screen.getByLabelText(name);

  it("loads the article list", async () => {
    await openDocs([DOC]);
    expect(await screen.findByText("Erste Schritte")).toBeTruthy();
  });

  it("refuses to save without a title", async () => {
    const u = await openDocs();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Titel ist erforderlich.")).toBeTruthy();
    expect(sent("POST", /docs/)).toHaveLength(0);
  });

  it("accepts an article with a title but no body yet", async () => {
    // Unlike a FAQ, a doc may start as a stub — only the title is required.
    const u = await openDocs();
    await u.type(field("Titel"), "Erste Schritte");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /docs$/)).toHaveLength(1));
  });

  it("leaves the slug empty so the backend derives it", async () => {
    const u = await openDocs();
    await u.type(field("Titel"), "Erste Schritte");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /docs$/)).toHaveLength(1));
    expect((sent("POST", /docs$/)[0]!.body as { slug: string }).slug).toBe("");
  });

  it("sends an explicit slug when one is typed", async () => {
    const u = await openDocs();
    await u.type(field("Titel"), "Erste Schritte");
    await u.type(field("Slug (optional)"), "start");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /docs$/)).toHaveLength(1));
    expect((sent("POST", /docs$/)[0]!.body as { slug: string }).slug).toBe("start");
  });

  it("sends the markdown body", async () => {
    const u = await openDocs();
    await u.type(field("Titel"), "Erste Schritte");
    await u.type(field("Inhalt (Markdown)"), "# Los");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("POST", /docs$/)).toHaveLength(1));
    expect((sent("POST", /docs$/)[0]!.body as { body_markdown: string }).body_markdown).toBe("# Los");
  });

  it("UPDATES with PUT to the row", async () => {
    const u = await openDocs([DOC]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(sent("PUT", /docs\/21$/)).toHaveLength(1));
    expect(sent("POST", /docs/)).toHaveLength(0);
  });

  it("loads the article into the form when editing", async () => {
    const u = await openDocs([DOC]);
    await u.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByRole("heading", { name: "Artikel bearbeiten" })).toBeTruthy();
    expect((field("Titel") as HTMLInputElement).value).toBe("Erste Schritte");
    expect((field("Inhalt (Markdown)") as HTMLTextAreaElement).value).toBe("# Los geht's");
    expect((field("Slug (optional)") as HTMLInputElement).value).toBe("erste-schritte");
  });

  it("deletes the row it was asked to delete", async () => {
    const u = await openDocs([DOC, { ...DOC, id: 22, title: "Weiterführend" }]);
    await screen.findByText("Weiterführend");
    const row = screen.getAllByRole("listitem").find((li) => li.textContent!.includes("Weiterführend"))!;
    await u.click(within(row).getByRole("button", { name: "Löschen" }));
    await u.click(screen.getAllByRole("button", { name: /Löschen/ }).at(-1)!);
    await waitFor(() => expect(sent("DELETE", /docs\/22$/)).toHaveLength(1));
    expect(sent("DELETE", /docs\/21$/)).toHaveLength(0);
  });

  it("marks an unpublished article as a draft", async () => {
    await openDocs([{ ...DOC, is_published: 0 }]);
    expect(await screen.findByText(/Entwurf/)).toBeTruthy();
  });

  it("reports a failed save with its status", async () => {
    respond(/docs/, { error: "nope" }, 409, "POST");
    const u = await openDocs();
    await u.type(field("Titel"), "Erste Schritte");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("409"))).toBe(true));
  });

  it("does not list articles carried by a non-OK response", async () => {
    respond(/^\/admin\/live-chat-cta\/docs$/, { docs: [DOC] }, 403);
    await open("Dokumentation");
    await screen.findByRole("heading", { name: "Neuer Artikel" });
    expect(screen.queryByText("Erste Schritte")).toBeNull();
  });
});
