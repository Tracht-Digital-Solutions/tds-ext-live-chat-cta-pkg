import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

/**
 * Admin surface for the Live-Chat-CTA: the visitor-session inbox (list + thread
 * + reply), polling the open thread every ~4s so an agent sees new visitor
 * messages live. Polling rather than SSE/WebSockets because the production host
 * is PHP-FPM behind Plesk with no long-lived workers.
 *
 * The FAQ and handbook editors used to be two more tabs here. They now live on
 * their own page (`WikiContentManager`, route `/wiki-inhalte`): those rows are
 * the customer portal's Wiki, so editing them is content publishing rather than
 * support work, and it is granted separately (`wiki:*` vs `live-chat:*`).
 */

const api = apiFetch;
const POLL_MS = 4000;

export default function LiveChatManager() {
  return (
    <div className="live-chat-manager">
      <ChatsTab />
    </div>
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

