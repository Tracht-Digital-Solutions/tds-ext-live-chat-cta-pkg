// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WikiContentManager from "./WikiContentManager";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The wiki-content editor: the FAQ half and the handbook half.
 *
 * What these rows feed is the reason to pin them hard — everything published
 * here shows up in the CUSTOMER PORTAL WIKI and in the support widget, from one
 * source. So a save that silently fails, or a dialog that closes on a 403 as if
 * it had worked, is a wrong answer given to a customer.
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
  render(<WikiContentManager />);
  const u = user();
  if (tab) await u.click(screen.getByRole("tab", { name: tab }));
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return u;
}

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
    const u = await open("Handbücher");
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
    await open("Handbücher");
    await screen.findByRole("heading", { name: "Neuer Artikel" });
    expect(screen.queryByText("Erste Schritte")).toBeNull();
  });
});
