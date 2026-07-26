import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
      <nav className="live-chat-manager__tabs" role="tablist">
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
    <button type="button" role="tab" aria-selected={active} className={active ? "is-active" : ""} onClick={onClick}>
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
    <div className="chats">
      <div className="chats__list">
        <div className="chats__filters">
          {(["open", "closed", ""] as const).map((f) => (
            <button key={f || "all"} type="button" className={filter === f ? "is-active" : ""} onClick={() => setFilter(f)}>
              {f === "open" ? "Offen" : f === "closed" ? "Geschlossen" : "Alle"}
            </button>
          ))}
        </div>
        {sessions.length === 0 ? (
          <p className="muted">Keine Chats.</p>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <button type="button" className={selected === s.id ? "is-active" : ""} onClick={() => setSelected(s.id)}>
                  <strong>{s.visitor_name || s.visitor_email || `Besucher #${s.id}`}</strong>
                  <span className="chats__meta">
                    {s.frontend ?? "–"} · {s.message_count} · {new Date(s.last_activity_at).toLocaleString("de-DE")}
                  </span>
                  {s.status === "open" ? <span className="badge badge--open">offen</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="chats__detail">
        {selected === null ? (
          <p className="muted">Chat auswählen …</p>
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
    }
  };

  return (
    <div className="thread">
      <div className="thread__head">
        <span className={`badge badge--${status}`}>{status === "open" ? "offen" : "geschlossen"}</span>
        <button type="button" onClick={toggleStatus}>{status === "open" ? "Schließen" : "Wieder öffnen"}</button>
      </div>
      <div className="thread__messages">
        {messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.author}`}>
            <p>{m.body}</p>
            <time>{new Date(m.created_at).toLocaleTimeString("de-DE")}</time>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="thread__compose">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Antwort schreiben …"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <button type="button" onClick={send} disabled={busy || !reply.trim()}>Senden</button>
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
      await load();
    } else {
      setStatus(`Fehler (HTTP ${res.status}).`);
    }
  };

  const remove = async (id: number) => {
    const res = await api(`/admin/live-chat-cta/faqs/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  return (
    <div className="kb">
      <form className="kb__form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h3>{typeof draft.id === "number" ? "FAQ bearbeiten" : "Neue FAQ"}</h3>
        <div className="grid">
          <label>
            <span>Sprache</span>
            <select value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as "de" | "en" })}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span>Kategorie</span>
            <input type="text" value={draft.category ?? ""} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </label>
        </div>
        <label>
          <span>Frage</span>
          <input type="text" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
        </label>
        <label>
          <span>Antwort</span>
          <textarea rows={4} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
        </label>
        <div className="grid">
          <label>
            <span>Reihenfolge</span>
            <input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={!!draft.is_published} onChange={(e) => setDraft({ ...draft, is_published: e.target.checked ? 1 : 0 })} />
            <span>Veröffentlicht</span>
          </label>
        </div>
        {status ? <p className="tds-alert" role="status">{status}</p> : null}
        <div className="kb__actions">
          <button type="submit">Speichern</button>
          {typeof draft.id === "number" ? <button type="button" onClick={() => setDraft({ ...emptyFaq })}>Abbrechen</button> : null}
        </div>
      </form>
      <ul className="kb__list">
        {rows.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.question}</strong>
              <span className="kb__meta">{r.lang}{r.category ? ` · ${r.category}` : ""}{r.is_published ? "" : " · Entwurf"}</span>
            </div>
            <div className="kb__row-actions">
              <button type="button" onClick={() => setDraft({ ...r, category: r.category ?? "" })}>Bearbeiten</button>
              <button type="button" className="btn btn-danger" onClick={() => remove(r.id)}>Löschen</button>
            </div>
          </li>
        ))}
      </ul>
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
      setStatus(`Fehler (HTTP ${res.status}).`);
    }
  };

  const remove = async (id: number) => {
    const res = await api(`/admin/live-chat-cta/docs/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  return (
    <div className="kb">
      <form className="kb__form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h3>{typeof draft.id === "number" ? "Artikel bearbeiten" : "Neuer Artikel"}</h3>
        <div className="grid">
          <label>
            <span>Sprache</span>
            <select value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as "de" | "en" })}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span>Slug (optional)</span>
            <input type="text" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="wird aus dem Titel erzeugt" />
          </label>
        </div>
        <label>
          <span>Titel</span>
          <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label>
          <span>Inhalt (Markdown)</span>
          <textarea rows={8} value={draft.body_markdown} onChange={(e) => setDraft({ ...draft, body_markdown: e.target.value })} />
        </label>
        <div className="grid">
          <label>
            <span>Reihenfolge</span>
            <input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={!!draft.is_published} onChange={(e) => setDraft({ ...draft, is_published: e.target.checked ? 1 : 0 })} />
            <span>Veröffentlicht</span>
          </label>
        </div>
        {status ? <p className="tds-alert" role="status">{status}</p> : null}
        <div className="kb__actions">
          <button type="submit">Speichern</button>
          {typeof draft.id === "number" ? <button type="button" onClick={() => setDraft({ ...emptyDoc })}>Abbrechen</button> : null}
        </div>
      </form>
      <ul className="kb__list">
        {rows.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.title}</strong>
              <span className="kb__meta">{r.lang} · {r.slug}{r.is_published ? "" : " · Entwurf"}</span>
            </div>
            <div className="kb__row-actions">
              <button type="button" onClick={() => setDraft({ ...r })}>Bearbeiten</button>
              <button type="button" className="btn btn-danger" onClick={() => remove(r.id)}>Löschen</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
