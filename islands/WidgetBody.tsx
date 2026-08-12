import { useEffect, useState } from "react";
import { Skeleton } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

/** Dashboard widget body — open chats + new contact requests. */
export default function WidgetBody() {
  const [state, setState] = useState<{ openChats: number; newContacts: number } | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/live-chat-cta/summary")
      .then((r) => (r.ok ? r.json() : { openChats: 0, newContacts: 0 }))
      .then((d) => alive && setState({ openChats: Number(d.openChats ?? 0), newContacts: Number(d.newContacts ?? 0) }))
      .catch(() => alive && setState({ openChats: 0, newContacts: 0 }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="tds-stack">
      <p className="tds-widget__metric" aria-busy={state === null}>
      {state === null ? <Skeleton width="3ch" height="1.75rem" /> : state.openChats}
    </p>
      <p className="marginalia">
        {state === null ? "" : `${state.newContacts} neue Kontaktanfrage${state.newContacts === 1 ? "" : "n"}`}
      </p>
    </div>
  );
}
