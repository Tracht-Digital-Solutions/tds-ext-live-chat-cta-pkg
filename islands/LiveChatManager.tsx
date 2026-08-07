import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, toast } from "@tracht-digital-solutions/tds-shared/components";

/**
 * Admin management surface for the Live-Chat-CTA. Three tabs:
 *   - Chats: the visitor-session inbox (list + thread + reply, polls the open
 *     thread every ~4s so an agent sees new visitor messages live);
 *   - FAQ: the FAQ knowledge base (create/edit/delete);
 *   - Dokumentation: markdown articles (create/edit/delete).
 * All calls are relative (the gateway proxies to core-frontend-api) with cookies.
 */

const api = (path: string, init?: RequestInit) => fetch(path, { credentials: "include", ...init });
const POLL_MS = 4000;

type Tab = "chats" | "faq" | "docs";

export default function LiveChatManager() {
  const [tab, setTab] = useState<Tab>("chats");
  return (
    <div className="live-chat-manager">
      <nav className="tds-row" role="tablist">
        <TabButton active={tab === "chats"} onClick={() => setTab("chats")}>Chats</TabButton>
        <TabButton active={tab === "faq"} onClick={() => setTab("faq")}>FAQ</TabButton>
        <TabButton active={tab === "docs"} onClick={() => setTab("docs")}>Dokumentation</TabButton>
      </nav>
      {tab === "chats" ? <ChatsTab /> : tab === "faq" ? <FaqTab /> : <DocsTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? "chip chip-active" : "chip"} onClick={onClick}>
      {children}
    </button>
  );
}

// === Chats ==================================================================

interface SessionRow {
  id: number;
  visitor_name: string | null;
  visitor_email: string | null;
  frontend: string | null;
  status: "open" | "closed";
  created_at: string;
  last_activity_at: string;
  message_count: number;
}
interface ChatMessage {
  id: number;
  author: "visitor" | "agent";
  body: string;
  created_at: string;
}

function ChatsTab() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [filter, setFilter] = useState<"open" | "closed" | "">("open");
  const [selected, setSelected] = useState<number | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await api(`/admin/live-chat-cta/sessions${filter ? `?status=${filter}` : ""}`);
    if (res.ok) setSessions((await res.json()).sessions ?? []);
  }, [filter]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    // `.chats` is a bespoke name with no rule behind it (extensions ship no
    // CSS), so this was `display: block` and the session list sat ON TOP of
    // the conversation at every width — mobile was correct by accident and
    // the desktop was the broken one. A third for the list, two thirds for
    // the thread, from `md` up; the `md:` prefix is what keeps the phone
    // layout stacked.
    //
    // Plain track utilities rather than an arbitrary `grid-cols-[…]` value:
    // that form was verified NOT to be generated from a package inside
    // node_modules, so it would have shipped as no layout at all.
    <div className="chats grid gap-4 md:grid-cols-3">
      <div className="tds-stack min-w-0">
        <div className="tds-row">
          {(["open", "closed", ""] as const).map((f) => (
            <button key={f || "all"} type="button" className={filter === f ? "chip chip-active" : "chip"} onClick={() => setFilter(f)}>
              {f === "open" ? "Offen" : f === "closed" ? "Geschlossen" : "Alle"}
            </button>
          ))}
        </div>
        {sessions.length === 0 ? (
          <p className="marginalia">Keine Chats.</p>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <button type="button" className={selected === s.id ? "btn btn-ghost tds-row is-active" : "btn btn-ghost tds-row"} onClick={() => setSelected(s.id)}>
                  <strong>{s.visitor_name || s.visitor_email || `Besucher #${s.id}`}</strong>
                  <span className="marginalia">
                    {s.frontend ?? "–"} · {s.message_count} · {new Date(s.last_activity_at).toLocaleString("de-DE")}
                  </span>
                  {s.status === "open" ? <span className="chip chip--info">offen</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="tds-stack min-w-0 md:col-span-2">
        {selected === null ? (
          <p className="marginalia">Chat auswählen …</p>
        ) : (
          <ChatThread sessionId={selected} onChanged={loadSessions} />
        )}
      </div>
    </div>
  );
}

function ChatThread({ sessionId, onChanged }: { sessionId: number; onChanged: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/admin/live-chat-cta/sessions/${sessionId}`);
    if (res.ok) {
      const d = await res.json();
      setMessages(d.messages ?? []);
      setStatus(d.status ?? "open");
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    const res = await api(`/admin/live-chat-cta/sessions/${sessionId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (res.ok) {
      setReply("");
      await load();
    } else {
      // Used to be a bare `if (res.ok)`: a rejected reply left the draft in
      // the box with no hint that the customer never received it.
      toast.danger(`Antwort konnte nicht gesendet werden (HTTP ${res.status}).`);
    }
  };

  const toggleStatus = async () => {
    const next = status === "open" ? "closed" : "open";
    const res = await api(`/admin/live-chat-cta/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) {
      setStatus(next);
      onChanged();
    } else {
      // The badge simply did not move on failure, which reads as a dead click.
      toast.danger(`Status konnte nicht geändert werden (HTTP ${res.status}).`);
    }
  };

  return (
    <div className="thread">
      <div className="tds-row tds-row--between">
        <span className={`chip ${status === "open" ? "chip--info" : "chip--neutral"}`}>
          {status === "open" ? "offen" : "geschlossen"}
        </span>
        <button className="btn btn-ghost" type="button" onClick={toggleStatus}>{status === "open" ? "Schließen" : "Wieder öffnen"}</button>
      </div>
      {/* Shared thread primitive. Sides mapped EXPLICITLY — `msg msg--${author}`
          matched no rule anywhere, so the bubbles rendered unstyled. This is the
          AGENT-side view (the admin panel), so the agent is `--own`. */}
      <div className="tds-thread">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`tds-thread__item ${
              m.author === "agent" ? "tds-thread__item--own" : "tds-thread__item--other"
            }`}
          >
            <p>{m.body}</p>
            <time>{new Date(m.created_at).toLocaleTimeString("de-DE")}</time>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="tds-compose">
        <textarea className="field-boxed"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Antwort schreiben …"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <button className="btn btn-primary" type="button" onClick={send} disabled={busy || !reply.trim()}>Senden</button>
      </div>
    </div>
  );
}

// === FAQ ====================================================================

interface FaqRow {
  id: number;
  lang: "de" | "en";
  category: string | null;
  question: string;
  answer: string;
  sort_order: number;
  is_published: boolean | number;
}
const emptyFaq: Omit<FaqRow, "id"> = { lang: "de", category: "", question: "", answer: "", sort_order: 100, is_published: 1 };

function FaqTab() {
  const [rows, setRows] = useState<FaqRow[]>([]);
  const [draft, setDraft] = useState<Omit<FaqRow, "id"> & { id?: number }>({ ...emptyFaq });
  const [pendingDelete, setPendingDelete] = useState<FaqRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api("/admin/live-chat-cta/faqs");
    if (res.ok) setRows((await res.json()).faqs ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft.question.trim() || !draft.answer.trim()) {
      setStatus("Frage und Antwort sind erforderlich.");
      return;
    }
    const isEdit = typeof draft.id === "number";
    const res = await api(`/admin/live-chat-cta/faqs${isEdit ? `/${draft.id}` : ""}`, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      setDraft({ ...emptyFaq });
      setStatus(null);
      toast.success(isEdit ? "FAQ-Eintrag gespeichert." : "FAQ-Eintrag angelegt.");
      await load();
    } else {
      toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  const confirmRemove = async () => {
    const r = pendingDelete;
    if (!r) return;
    setDeleting(true);
    try {
      const res = await api(`/admin/live-chat-cta/faqs/${r.id}`, { method: "DELETE" });
      setPendingDelete(null);
      if (res.ok) await load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="kb">
      <form className="tds-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h3>{typeof draft.id === "number" ? "FAQ bearbeiten" : "Neue FAQ"}</h3>
        <div className="grid">
          <label>
            <span>Sprache</span>
            <select className="field-boxed" value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as "de" | "en" })}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span>Kategorie</span>
            <input className="field-boxed" type="text" value={draft.category ?? ""} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </label>
        </div>
        <label>
          <span>Frage</span>
          <input className="field-boxed" type="text" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
        </label>
        <label>
          <span>Antwort</span>
          <textarea className="field-boxed" rows={4} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
        </label>
        <div className="grid">
          <label>
            <span>Reihenfolge</span>
            <input className="field-boxed" type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={!!draft.is_published} onChange={(e) => setDraft({ ...draft, is_published: e.target.checked ? 1 : 0 })} />
            <span>Veröffentlicht</span>
          </label>
        </div>
        {/* Only form validation reaches this now — outcomes are toasts. */}
        {status ? <p className="tds-alert tds-alert--danger" role="alert">{status}</p> : null}
        <div className="tds-toolbar">
          <button className="btn btn-primary" type="submit">Speichern</button>
          {typeof draft.id === "number" ? <button className="btn btn-ghost" type="button" onClick={() => setDraft({ ...emptyFaq })}>Abbrechen</button> : null}
        </div>
      </form>
      <ul className="tds-list">
        {rows.map((r) => (
          <li key={r.id} className="tds-list__row">
            <div>
              <strong>{r.question}</strong>
              <span className="marginalia">{r.lang}{r.category ? ` · ${r.category}` : ""}{r.is_published ? "" : " · Entwurf"}</span>
            </div>
            <div className="tds-toolbar">
              <button className="btn btn-ghost" type="button" onClick={() => setDraft({ ...r, category: r.category ?? "" })}>Bearbeiten</button>
              <button type="button" className="btn btn-danger" onClick={() => setPendingDelete(r)}>Löschen</button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="FAQ-Eintrag löschen?"
        message={pendingDelete?.question ?? undefined}
        busy={deleting}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

// === Dokumentation ==========================================================

interface DocRow {
  id: number;
  lang: "de" | "en";
  slug: string;
  title: string;
  body_markdown: string;
  sort_order: number;
  is_published: boolean | number;
}
const emptyDoc: Omit<DocRow, "id"> = { lang: "de", slug: "", title: "", body_markdown: "", sort_order: 100, is_published: 1 };

function DocsTab() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [draft, setDraft] = useState<Omit<DocRow, "id"> & { id?: number }>({ ...emptyDoc });
  const [pendingDelete, setPendingDelete] = useState<DocRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api("/admin/live-chat-cta/docs");
    if (res.ok) setRows((await res.json()).docs ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft.title.trim()) {
      setStatus("Titel ist erforderlich.");
      return;
    }
    const isEdit = typeof draft.id === "number";
    const res = await api(`/admin/live-chat-cta/docs${isEdit ? `/${draft.id}` : ""}`, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      setDraft({ ...emptyDoc });
      setStatus(null);
      await load();
    } else {
      toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  const confirmRemove = async () => {
    const r = pendingDelete;
    if (!r) return;
    setDeleting(true);
    try {
      const res = await api(`/admin/live-chat-cta/docs/${r.id}`, { method: "DELETE" });
      setPendingDelete(null);
      if (res.ok) await load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="kb">
      <form className="tds-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h3>{typeof draft.id === "number" ? "Artikel bearbeiten" : "Neuer Artikel"}</h3>
        <div className="grid">
          <label>
            <span>Sprache</span>
            <select className="field-boxed" value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as "de" | "en" })}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span>Slug (optional)</span>
            <input className="field-boxed" type="text" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="wird aus dem Titel erzeugt" />
          </label>
        </div>
        <label>
          <span>Titel</span>
          <input className="field-boxed" type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label>
          <span>Inhalt (Markdown)</span>
          <textarea className="field-boxed" rows={8} value={draft.body_markdown} onChange={(e) => setDraft({ ...draft, body_markdown: e.target.value })} />
        </label>
        <div className="grid">
          <label>
            <span>Reihenfolge</span>
            <input className="field-boxed" type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={!!draft.is_published} onChange={(e) => setDraft({ ...draft, is_published: e.target.checked ? 1 : 0 })} />
            <span>Veröffentlicht</span>
          </label>
        </div>
        {/* Only form validation reaches this now — outcomes are toasts. */}
        {status ? <p className="tds-alert tds-alert--danger" role="alert">{status}</p> : null}
        <div className="tds-toolbar">
          <button className="btn btn-primary" type="submit">Speichern</button>
          {typeof draft.id === "number" ? <button className="btn btn-ghost" type="button" onClick={() => setDraft({ ...emptyDoc })}>Abbrechen</button> : null}
        </div>
      </form>
      <ul className="tds-list">
        {rows.map((r) => (
          <li key={r.id} className="tds-list__row">
            <div>
              <strong>{r.title}</strong>
              <span className="marginalia">{r.lang} · {r.slug}{r.is_published ? "" : " · Entwurf"}</span>
            </div>
            <div className="tds-toolbar">
              <button className="btn btn-ghost" type="button" onClick={() => setDraft({ ...r })}>Bearbeiten</button>
              <button type="button" className="btn btn-danger" onClick={() => setPendingDelete(r)}>Löschen</button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Dokument „${pendingDelete?.title ?? ""}“ löschen?`}
        message="Die Sprachfassung wird dauerhaft entfernt."
        busy={deleting}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
