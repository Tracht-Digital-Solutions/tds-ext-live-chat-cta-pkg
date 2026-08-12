
/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WidgetBody from "./WidgetBody";

/**
 * The dashboard widget: open chats + new contact requests.
 *
 * NOTE — this widget deliberately renders `0` on a failed request, where the
 * lexware and time-tracker widgets render `—`. Pinned as-is rather than
 * "fixed" here, but it is worth knowing: a 500 makes the tile read "0 offene
 * Chats", which is exactly the state an agent stops looking at.
 */

let reply: { status: number; body: unknown } | "reject" = { status: 200, body: { openChats: 0, newContacts: 0 } };

beforeEach(() => {
  reply = { status: 200, body: { openChats: 0, newContacts: 0 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (reply === "reject") throw new TypeError("offline");
      return {
        ok: reply.status < 300,
        status: reply.status,
        json: async () => (reply === "reject" ? {} : reply.body),
      } as Response;
    }),
  );
});

afterEach(() => cleanup());

describe("the widget", () => {
  it("fetches its summary endpoint with credentials", () => {
    render(<WidgetBody />);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(pathOf(fetchMock.mock.calls[0]![0] as string)).toBe("/live-chat-cta/summary");
    // Absolute, on the API host. Every other assertion here matches the PATH,
    // which a relative fetch satisfies too — so this is the one that fails if
    // the call ever goes back to the product's own origin (whose SPA fallback
    // answers 200 + HTML and turns into a silent empty state).
    expect(String(fetchMock.mock.calls[0]![0]).startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a placeholder before the request resolves", () => {
    render(<WidgetBody />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("renders the number of chats waiting for an agent", async () => {
    reply = { status: 200, body: { openChats: 7, newContacts: 0 } };
    render(<WidgetBody />);
    expect(await screen.findByText("7")).toBeTruthy();
  });

  it("pluralises the contact requests", async () => {
    reply = { status: 200, body: { openChats: 0, newContacts: 3 } };
    render(<WidgetBody />);
    expect(await screen.findByText("3 neue Kontaktanfragen")).toBeTruthy();
  });

  it("uses the singular for exactly one", async () => {
    reply = { status: 200, body: { openChats: 0, newContacts: 1 } };
    render(<WidgetBody />);
    expect(await screen.findByText("1 neue Kontaktanfrage")).toBeTruthy();
  });

  it("uses the plural for zero", async () => {
    render(<WidgetBody />);
    expect(await screen.findByText("0 neue Kontaktanfragen")).toBeTruthy();
  });

  it("coerces string counts from the API to numbers", async () => {
    // PDO hands back strings for integer columns often enough that the plural
    // rule would break on a `"1" === 1` comparison.
    reply = { status: 200, body: { openChats: "4", newContacts: "1" } };
    render(<WidgetBody />);
    expect(await screen.findByText("4")).toBeTruthy();
    expect(screen.getByText("1 neue Kontaktanfrage")).toBeTruthy();
  });

  it("treats missing counts as zero rather than rendering NaN", async () => {
    reply = { status: 200, body: {} };
    render(<WidgetBody />);
    expect(await screen.findByText("0 neue Kontaktanfragen")).toBeTruthy();
    expect(screen.queryByText("NaN")).toBeNull();
  });

  it("does not render counts carried by a NON-OK response", async () => {
    reply = { status: 403, body: { openChats: 99, newContacts: 99 } };
    render(<WidgetBody />);
    expect(await screen.findByText("0 neue Kontaktanfragen")).toBeTruthy();
    expect(screen.queryByText("99")).toBeNull();
  });

  it("still resolves to a rendered tile when the request rejects", async () => {
    reply = "reject";
    render(<WidgetBody />);
    expect(await screen.findByText("0 neue Kontaktanfragen")).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
