import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

/**
 * Admin editor for the WIKI CONTENT: the FAQs and handbook articles the
 * customer portal's Wiki renders (and the chat bubble reuses).
 *
 * Split out of LiveChatManager when the panel gained two separate wikis. Same
 * rows, same routes, one source of truth — but this is content publishing, not
 * a support inbox, so it has its own page, its own nav entry and its own
 * permissions (`wiki:read` / `wiki:write`).
 *
 * Everything published here appears in BOTH places: /wiki in the customer
 * portal and the FAQ/Doku tabs of the floating chat bubble. There is no second
 * copy to keep in sync.
 */

const api = apiFetch;

type Tab = "faq" | "docs";

export default function WikiContentManager() {
  const [tab, setTab] = useState<Tab>("faq");
  return (
    <div className="wiki-content-manager">
      <nav className="tds-row" role="tablist">
        <TabButton active={tab === "faq"} onClick={() => setTab("faq")}>FAQ</TabButton>
        <TabButton active={tab === "docs"} onClick={() => setTab("docs")}>Handbücher</TabButton>
      </nav>
      {tab === "faq" ? <FaqTab /> : <DocsTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? "chip chip-active" : "chip"} onClick={onClick}>
      {children}
    </button>
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
