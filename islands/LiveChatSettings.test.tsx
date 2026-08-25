
/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primeRuntimeConfig } from "@tracht-digital-solutions/tds-shared/api";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveChatSettings from "./LiveChatSettings";
import { TOAST_EVENT } from "@tracht-digital-solutions/tds-shared/toast";

/**
 * The activation matrix (5 frontends × {master, chat, faq, docs, contact}) plus
 * the widget branding, persisted to the core runtime settings store.
 *
 * This panel decides whether a chat bubble appears on the PUBLIC sites, so the
 * two things pinned hardest are:
 *
 *  1. a frontend is **off until switched on** — `<frontend>_enabled` gets no
 *     coded default, unlike the per-feature flags, so a fresh install never
 *     silently ships a live-chat bubble on tracht-digital.de;
 *  2. a save writes the WHOLE key set, because the panel is the only writer and
 *     a partial PUT would leave the store half-migrated.
 */

let calls: Array<{ url: string; method: string; body: unknown }> = [];
let getReply: { status: number; body: unknown } = { status: 200, body: { settings: [] } };
let putReply: { status: number; body: unknown } = { status: 200, body: {} };

const NS = "/admin/settings/live-chat-cta";
const FRONTENDS = ["landingpage", "blog", "customer", "admin", "tools"];
const FEATURES = ["chat", "faq", "docs", "contact"];
/** 4 branding keys + 5 frontends × (1 master + 4 features). */
const ALL_KEYS = [
  "cta_label",
  "cta_greeting",
  "cta_accent",
  "agent_email",
  ...FRONTENDS.flatMap((f) => [`${f}_enabled`, ...FEATURES.map((feat) => `${f}_${feat}`)]),
];

/** Outcomes are toasts now — collected off the `tds:toast` bus. */
let toasts: Array<{ variant: string; message: string }> = [];
const collectToast = (e: Event) => {
  toasts.push((e as CustomEvent<{ variant: string; message: string }>).detail);
};

beforeEach(() => {
  toasts = [];
  window.addEventListener(TOAST_EVENT, collectToast);
  calls = [];
  getReply = { status: 200, body: { settings: [] } };
  putReply = { status: 200, body: {} };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const reply = method === "PUT" ? putReply : getReply;
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
    }),
  );
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, collectToast);
  cleanup();
});

const user = () => userEvent.setup({ delay: null });
const stored = (pairs: Record<string, string>) => ({
  status: 200,
  body: { settings: Object.entries(pairs).map(([key, value]) => ({ key, secret: false, value })) },
});

async function open() {
  render(<LiveChatSettings />);
  const u = user();
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  await screen.findByRole("button", { name: "Speichern" });
  return u;
}

const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const put = () => calls.find((c) => c.method === "PUT");
const saved = () => (put()!.body as { settings: Array<{ key: string; secret: boolean; value: string }> }).settings;
const savedValue = (key: string) => saved().find((s) => s.key === key)!.value;

// apiFetch consults the host-side runtime config (/tds-runtime.json) before it
// resolves a URL, so without this the first entry in fetch.mock.calls is that
// probe rather than the endpoint under test. The panel products never ship the
// file — they render <meta name="tds-api-base"> instead — so "absent" is also
// what actually happens in production.
beforeEach(() => primeRuntimeConfig(null));

describe("loading", () => {
  it("reads its own namespace of the settings store", async () => {
    await open();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(pathOf(fetchMock.mock.calls[0]![0] as string)).toBe(NS);
    // Absolute, on the API host. Every other assertion here matches the PATH,
    // which a relative fetch satisfies too — so this is the one that fails if
    // the call ever goes back to the product's own origin (whose SPA fallback
    // answers 200 + HTML and turns into a silent empty state).
    expect(String(fetchMock.mock.calls[0]![0]).startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a loading line until the settings arrive", () => {
    render(<LiveChatSettings />);
    expect(screen.getByLabelText("Wird geladen")).toBeTruthy();
  });

  it("renders one row per frontend", async () => {
    await open();
    for (const label of ["Landingpage", "Blog", "Kundenportal", "Admin", "Tools"]) {
      expect(screen.getByLabelText(`${label} aktiv`), `no master switch for ${label}`).toBeTruthy();
    }
  });

  it("renders every feature switch of every frontend", async () => {
    await open();
    for (const fe of ["Landingpage", "Blog", "Kundenportal", "Admin", "Tools"]) {
      for (const feat of ["Chat", "FAQ", "Doku", "Kontakt"]) {
        expect(screen.getByLabelText(`${fe} ${feat}`), `no ${feat} switch for ${fe}`).toBeTruthy();
      }
    }
  });

  it("leaves every frontend OFF on a fresh install", async () => {
    // The bubble appears on PUBLIC sites. There is deliberately no coded
    // default for `<frontend>_enabled`, so nothing goes live unattended.
    await open();
    for (const label of ["Landingpage", "Blog", "Kundenportal", "Admin", "Tools"]) {
      expect(box(`${label} aktiv`).checked, `${label} must default to off`).toBe(false);
    }
  });

  it("defaults the per-feature flags to ON so an enabled frontend is complete", async () => {
    await open();
    for (const feat of ["Chat", "FAQ", "Doku", "Kontakt"]) {
      expect(box(`Landingpage ${feat}`).checked, `${feat} should default on`).toBe(true);
    }
  });

  it("disables the feature switches while the frontend is off", async () => {
    await open();
    expect(box("Landingpage Chat").disabled).toBe(true);
  });

  it("enables them as soon as the frontend is switched on", async () => {
    const u = await open();
    await u.click(box("Landingpage aktiv"));
    expect(box("Landingpage Chat").disabled).toBe(false);
  });

  it("reflects a stored frontend as enabled", async () => {
    getReply = stored({ landingpage_enabled: "1" });
    await open();
    expect(box("Landingpage aktiv").checked).toBe(true);
    expect(box("Blog aktiv").checked).toBe(false);
  });

  it("treats a stored 0 as off, not as 'set'", async () => {
    getReply = stored({ landingpage_chat: "0" });
    await open();
    expect(box("Landingpage Chat").checked).toBe(false);
  });

  it("fills the branding fields from the store", async () => {
    getReply = stored({ cta_label: "Chat mit uns", cta_greeting: "Moin!", agent_email: "support@example.de" });
    await open();
    expect(box("CTA-Text (Button)").value).toBe("Chat mit uns");
    expect(box("Begrüßung im Panel").value).toBe("Moin!");
    expect(box("Benachrichtigungs-E-Mail").value).toBe("support@example.de");
  });

  it("falls back to the coded copy the backend also defaults to", async () => {
    // The two sides must agree, or the bubble shows different text before and
    // after the first save.
    await open();
    expect(box("CTA-Text (Button)").value).toBe("Fragen? Schreib uns");
    expect(box("Begrüßung im Panel").value).toBe("Hallo! Wie können wir helfen?");
    expect(box("Akzentfarbe").value).toBe("#050f68");
  });

  it("keeps a stored accent colour", async () => {
    getReply = stored({ cta_accent: "#ff0000" });
    await open();
    expect(box("Akzentfarbe").value).toBe("#ff0000");
  });

  it("leaves the notification address empty rather than inventing one", async () => {
    await open();
    expect(box("Benachrichtigungs-E-Mail").value).toBe("");
  });

  it("names the reason when the user is not an admin", async () => {
    getReply = { status: 403, body: {} };
    render(<LiveChatSettings />);
    expect(await screen.findByText("Nur für Administratoren.")).toBeTruthy();
  });

  it("treats an expired session the same way", async () => {
    getReply = { status: 401, body: {} };
    render(<LiveChatSettings />);
    expect(await screen.findByText("Nur für Administratoren.")).toBeTruthy();
  });

  it("reports any other failure with its status", async () => {
    getReply = { status: 500, body: {} };
    render(<LiveChatSettings />);
    expect(await screen.findByText("Fehler (HTTP 500).")).toBeTruthy();
  });

  it("leaves the loading state even when the request fails", async () => {
    getReply = { status: 500, body: {} };
    render(<LiveChatSettings />);
    await screen.findByText("Fehler (HTTP 500).");
    expect(screen.queryByLabelText("Wird geladen")).toBeNull();
  });

  it("does NOT apply values carried by a non-OK response", async () => {
    // A 403 body must not switch a public frontend on.
    getReply = { status: 403, body: { settings: [{ key: "landingpage_enabled", secret: false, value: "1" }] } };
    render(<LiveChatSettings />);
    await screen.findByText("Nur für Administratoren.");
    // The matrix still renders (the panel leaves the loading state), but the
    // denied body must not have switched the public site on.
    expect(box("Landingpage aktiv").checked).toBe(false);
  });

  it("tolerates a response with no settings array", async () => {
    getReply = { status: 200, body: {} };
    await open();
    expect(box("Landingpage aktiv")).toBeTruthy();
  });
});

describe("saving", () => {
  it("writes back to the same namespace as JSON", async () => {
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(pathOf(put()!.url)).toBe(NS);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
    expect((call[1] as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("sends the WHOLE key set, not just what changed", async () => {
    // This panel is the only writer; a partial PUT leaves the store half-set.
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(saved().map((s) => s.key).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("stores nothing here as a secret", async () => {
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    for (const s of saved()) expect(s.secret, `${s.key} must not be secret`).toBe(false);
  });

  it("writes a flag as the string 1 or 0 the store round-trips", async () => {
    const u = await open();
    await u.click(box("Landingpage aktiv"));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(savedValue("landingpage_enabled")).toBe("1");
    expect(savedValue("blog_enabled")).toBe("");
  });

  it("switches a feature back off", async () => {
    const u = await open();
    await u.click(box("Landingpage aktiv"));
    await u.click(box("Landingpage FAQ"));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(savedValue("landingpage_faq")).toBe("0");
    expect(savedValue("landingpage_chat")).toBe("1");
  });

  it("touches only the frontend that was toggled", async () => {
    const u = await open();
    await u.click(box("Blog aktiv"));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(savedValue("blog_enabled")).toBe("1");
    for (const other of ["landingpage", "customer", "admin", "tools"]) {
      expect(savedValue(`${other}_enabled`), `${other} must stay off`).toBe("");
    }
  });

  it("SAVES the coded defaults it displayed, not empty strings", async () => {
    // The inputs carry their own `|| default`, so a missing coded default is
    // invisible on screen and only shows up in the payload — the store would
    // end up holding an empty accent colour while the panel showed #050f68.
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(savedValue("cta_accent")).toBe("#050f68");
    expect(savedValue("cta_label")).toBe("Fragen? Schreib uns");
    expect(savedValue("cta_greeting")).toBe("Hallo! Wie können wir helfen?");
  });

  it("sends the edited branding", async () => {
    const u = await open();
    await u.clear(box("CTA-Text (Button)"));
    await u.type(box("CTA-Text (Button)"), "Chat mit uns");
    await u.type(box("Benachrichtigungs-E-Mail"), "support@example.de");
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(put()).toBeDefined());
    expect(savedValue("cta_label")).toBe("Chat mit uns");
    expect(savedValue("agent_email")).toBe("support@example.de");
  });

  it("confirms and re-reads after a save", async () => {
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Gespeichert"))).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET")).toHaveLength(2));
  });

  it("reports a failed save instead of confirming it", async () => {
    putReply = { status: 500, body: {} };
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(toasts.some((t) => t.message.includes("Gespeichert"))).toBe(false);
  });

  it("does not re-read after a failed save", async () => {
    putReply = { status: 403, body: {} };
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("403"))).toBe(true));
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("keeps the toggles the user set when the save fails", async () => {
    putReply = { status: 500, body: {} };
    const u = await open();
    await u.click(box("Landingpage aktiv"));
    await u.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(toasts.some((t) => t.variant === "danger" && t.message.includes("500"))).toBe(true));
    expect(box("Landingpage aktiv").checked).toBe(true);
  });

  it("re-enables the save button afterwards", async () => {
    const u = await open();
    const button = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
    await u.click(button);
    await waitFor(() => expect(toasts.some((t) => t.variant === "success" && t.message.includes("Gespeichert"))).toBe(true));
    expect(button.disabled).toBe(false);
  });
});
