import { useEffect, useMemo, useState } from "react";
import { Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

/**
 * Live-Chat settings — the activation matrix (each frontend × {master, chat, faq,
 * docs, contact}) plus the widget branding. Persisted to the core runtime
 * settings store (/admin/settings/live-chat-cta); all keys are non-secret. The
 * public config endpoint reads the same store, so toggles take effect with no
 * rebuild — the widget just re-reads config on its next mount.
 */

interface Masked {
  key: string;
  secret: boolean;
  configured?: boolean;
  last4?: string | null;
  value?: string;
}

const api = apiFetch;
const NS = "/admin/settings/live-chat-cta";

const FRONTENDS: { key: string; label: string }[] = [
  { key: "landingpage", label: "Landingpage" },
  { key: "blog", label: "Blog" },
  { key: "customer", label: "Kundenportal" },
  { key: "admin", label: "Admin" },
  { key: "tools", label: "Tools" },
];
const FEATURES: { key: string; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "faq", label: "FAQ" },
  { key: "docs", label: "Doku" },
  { key: "contact", label: "Kontakt" },
];

export default function LiveChatSettings() {
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const allKeys = useMemo(() => {
    const keys = ["cta_label", "cta_greeting", "cta_accent", "agent_email"];
    for (const f of FRONTENDS) {
      keys.push(`${f.key}_enabled`);
      for (const feat of FEATURES) keys.push(`${f.key}_${feat.key}`);
    }
    return keys;
  }, []);

  const load = async () => {
    const res = await api(NS);
    if (!res.ok) {
      setStatus(res.status === 401 || res.status === 403 ? "Nur für Administratoren." : `Fehler (HTTP ${res.status}).`);
      setLoaded(true);
      return;
    }
    const d = await res.json();
    const map = new Map<string, Masked>((d.settings ?? []).map((s: Masked) => [s.key, s]));
    const next: Record<string, string> = {};
    for (const k of allKeys) next[k] = map.get(k)?.value ?? "";
    // Coded defaults so first load matches the backend's SettingDef defaults.
    if (!map.has("cta_label")) next.cta_label = "Fragen? Schreib uns";
    if (!map.has("cta_greeting")) next.cta_greeting = "Hallo! Wie können wir helfen?";
    if (!map.has("cta_accent")) next.cta_accent = "#050f68";
    for (const f of FRONTENDS) {
      for (const feat of FEATURES) {
        if (!map.has(`${f.key}_${feat.key}`)) next[`${f.key}_${feat.key}`] = "1";
      }
    }
    setValues(next);
    setLoaded(true);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const flag = (key: string) => values[key] === "1";
  const toggle = (key: string) => set(key, flag(key) ? "0" : "1");

  const save = async () => {
    setBusy(true);
    setStatus(null);
    const settings: Masked[] = allKeys.map((key) => ({ key, secret: false, value: values[key] ?? "" }));
    const res = await api(NS, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Gespeichert.");
      void load();
    } else {
      toast.danger(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
    }
  };

  if (!loaded) return <p><Spinner /></p>;

  return (
    <div className="live-chat-settings space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Widget</legend>
        <label className="block">
          <span className="text-sm">CTA-Text (Button)</span>
          <input className="field-boxed" type="text" value={values.cta_label ?? ""} onChange={(e) => set("cta_label", e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm">Begrüßung im Panel</span>
          <input className="field-boxed" type="text" value={values.cta_greeting ?? ""} onChange={(e) => set("cta_greeting", e.target.value)} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm">Akzentfarbe</span>
            <input className="field-boxed" type="color" value={values.cta_accent || "#050f68"} onChange={(e) => set("cta_accent", e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm">Benachrichtigungs-E-Mail</span>
            <input className="field-boxed" type="email" value={values.agent_email ?? ""} onChange={(e) => set("agent_email", e.target.value)} placeholder="support@…" />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Aktivierung je Frontend</legend>
        <p className="text-sm opacity-70">
          Widget pro Frontend an/aus — und je Frontend einzeln festlegen, welche Funktionen erscheinen.
        </p>
        {/* This matrix used to carry no shared class and an inline `overflowX`
            instead. Extensions ship no CSS, so `.live-chat-settings__matrix`
            styled nothing and it rendered on browser defaults — no cell
            padding, no header treatment. `.tds-table` supplies all of that AND
            scrolls itself below 40rem, so the hand-rolled scroll container is
            redundant. (Don't write the tag name in this comment:
            lint-primitives is a regex scan and reads it as markup.) */}
        <div className="live-chat-settings__matrix">
          <table className="tds-table">
            <thead>
              <tr>
                <th>Frontend</th>
                <th>Aktiv</th>
                {FEATURES.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FRONTENDS.map((fe) => {
                const on = flag(`${fe.key}_enabled`);
                return (
                  <tr key={fe.key} className={on ? "" : "is-off"}>
                    <td>{fe.label}</td>
                    <td>
                      <input type="checkbox" checked={on} onChange={() => toggle(`${fe.key}_enabled`)} aria-label={`${fe.label} aktiv`} />
                    </td>
                    {FEATURES.map((feat) => (
                      <td key={feat.key}>
                        <input
                          type="checkbox"
                          checked={flag(`${fe.key}_${feat.key}`)}
                          disabled={!on}
                          onChange={() => toggle(`${fe.key}_${feat.key}`)}
                          aria-label={`${fe.label} ${feat.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </fieldset>

      {/* The load failure is persistent state and stays in-flow; the save
          outcome is a toast now. Failures only, hence the danger hue. */}
      {status ? <p className="tds-alert tds-alert--danger" role="alert">{status}</p> : null}
      <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>Speichern</button>
    </div>
  );
}
