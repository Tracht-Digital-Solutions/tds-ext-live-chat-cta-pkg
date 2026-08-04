# AGENTS.md — tds-ext-live-chat-cta-pkg

A TDS frontend extension: the floating **Live-Chat-CTA** support widget (live chat + FAQ +
docs + contact form). Read `tds-frontend-contract-pkg`'s AGENTS.md first — extensions
implement that contract. Scaffolded from `tds-ext-template-pkg`; `tds-ext-tools-pkg` (public
config + `SettingsStore`) and `tds-ext-contact-tickets-pkg` (public-form hardening) are the
worked references.

## Shape

- `src/index.ts` — the `defineExtension({...})` manifest (admin route `/live-chat`, dashboard
  widget, settings section, `live-chat:read`/`live-chat:write` permissions, i18n).
- `pages/Index.astro` + `islands/LiveChatManager.tsx` — the admin management surface (tabs:
  Chats inbox / FAQ / Dokumentation). Content-only page (host Layout wraps it).
- `islands/Settings.astro` + `islands/LiveChatSettings.tsx` — the settings section: the
  frontend × feature **activation matrix** + branding, read/written via `/admin/settings/live-chat-cta`.
- `widgets/Widget.astro` + `islands/WidgetBody.tsx` — the "Offene Chats" dashboard widget.
- `php/src/LiveChatCtaModule.php` + `php/src/Domain/*Repository.php` — the backend Module.
- `php/db/migrations/20260801*` — Phinx, classes prefixed `LiveChatCta*`.

## Conventions baked in (don't regress)

- **Config is DB-first via the core `SettingsStore` (ns `live-chat-cta`)**, env-fallback,
  coded default. The bubble activates **per frontend AND per feature** — `{frontend}_enabled`
  is the master switch (off by default), `{frontend}_{chat|faq|docs|contact}` gate the tabs.
  Adding a frontend/feature means adding its `SettingDef`s (backend) AND a row/column in
  `LiveChatSettings.tsx` (frontend) — keep the `FRONTENDS`/`FEATURES` lists in sync across
  `LiveChatCtaModule::FRONTENDS/FEATURES` and the island.
- **The visitor bubble UI is NOT in this repo** — it's the `LiveChatCta` island in
  `tds-shared-pkg`. This repo only serves it (`GET /live-chat-cta/config` is the one call it
  makes). Keep the config response shape (`enabled`, `cta`, `tabs`, `faqs`, `docs`) in sync
  with that island.
- **Public routes are hardened**: contact form = honeypot (`website` → 202) + validation
  (422) + salted-IP rate limit (429, hash only — never the raw IP). Chat is token-scoped
  (`X-Chat-Token`, `hash_equals`); the admin API never exposes `public_token`.
- **Migrations**: `LiveChatCta*` class prefix + the `20260801*` version band are globally
  unique across all composed extensions (one shared phinxlog, one PHP process — a reused
  class fatals, a reused version collides).
- **The FILE name must map to the class name** — `<version>_live_chat_cta_create_faq.php`
  ⇒ `LiveChatCtaCreateFaq`. Phinx derives the expected class from the file name
  (`Util::mapFileNameToClassName`: strip version, `ucwords` on `_`) and throws
  `InvalidArgumentException: Could not find class …` when it doesn't match. That throw
  happens while *scanning* the migration set, so it takes down the whole composed run:
  **no extension migrates**, and the frontend API answers 500 after every deploy. All five
  files were originally named `create_live_chat_cta_*` (⇒ `CreateLiveChatCta*`) against
  `LiveChatCtaCreate*` classes, i.e. this extension's schema had never once applied; the
  files were renamed with the module prefix first (0.1.9). Verify with a real Phinx run,
  not by reading — see the recipe in the README.
- **The FAQ ships a seed, and the seed must stay non-destructive.** `20260801000006`
  inserts the central-login entries (DE + EN: session scope, sign-out, password change) —
  the answer to "gilt meine Anmeldung überall?", which `tds-auth-frontend` deliberately no
  longer prints on the login page. They are ordinary rows afterwards, editable under
  `/live-chat`, so the seed **skips a question that already exists** and `down()` deletes
  only rows still carrying the seeded answer verbatim: a re-run or rollback must never
  overwrite or drop an operator's edit. The staff-facing counterpart is the frontend host's
  `/wiki` FAQ (`tds-core-frontend-pkg`, `src/content/faq.ts`) — keep the two in rough sync
  when the login behaviour changes. Answers are plain text (the widget's `Prose` renderer
  splits on newlines and renders text nodes; there is no markup layer).
- **Outcomes are toasts (tds-shared `>=0.16.0`), validation stays in-flow.** The
  agent's reply and the open/closed toggle were bare `if (res.ok)` branches — a
  rejected reply left the draft in the box with no hint that the visitor never
  got it, and the badge simply didn't move, which reads as a dead click. Those
  and both editors' save paths now `toast`; what remains in the in-flow banner is
  form validation and the load failure, so it moved to `.tds-alert--danger`.
  Never mount a `ToastHost` here — the frontend host owns the only one.
- **Env precedence trap**: read env with the explicit `getenv() === false ? default` pattern
  (`self::env()`), never `?? getenv() ?: $default` (clobbers `"0"`/`""`).
- Depends on the **published** `tds-frontend-contract` (`^1.0.0`) — npm from GitHub Packages,
  Composer from the public VCS repo. No local path repo (Composer fatals in CI). CI installs
  with `npm install --no-package-lock`, never `npm ci`.
- Version bumps `package.json` + `composer.json` in lockstep; the pushed annotated tag is the
  Composer release ref. Stay in the `0.1.x` line (host caret pin).
- `PACKAGE_TOKEN` (public-Packages PAT, `read`+`write`+`delete:packages` + `repo`,
  SSO-authorized) installs the contract and publishes; `NPM_TOKEN` is set from it in CI.

## Tests

```bash
npm run test:run    # vitest, 151 tests (jsdom per-file via a @vitest-environment docblock)
```

- `islands/LiveChatManager.test.tsx` — the inbox, the FAQ editor and the docs
  editor. The inbox is the live half (an agent watching a thread while a
  visitor types), so what is pinned hardest is that a message is attributed to
  the **right side** of the conversation, that the open/closed toggle sends the
  **opposite** of the current state and does not flip the badge when the PATCH
  fails, and that the 4 s poll runs *and is cleared on unmount*. Both editors
  are pinned to **PUT an edit** rather than POST — a POST would silently create
  a duplicate row on every save.
- `islands/LiveChatSettings.test.tsx` — the activation matrix. Two invariants:
  a frontend is **off until switched on** (there is deliberately no coded
  default for `<frontend>_enabled`, so a fresh install never ships a live-chat
  bubble onto a public site unattended), and a save writes the **whole** key
  set, since this panel is the store's only writer.
- `islands/WidgetBody.test.tsx` — the widget's states, incl. the `Number()`
  coercion PDO string columns need for the plural rule.
- `src/index.test.ts` + `tests/packaging.test.ts` — the manifest as a product
  build sees it, and that every specifier resolves to a file that is both
  exported and inside the published `files` allow-list.

Error-path tests deliberately answer with a POPULATED body and a non-OK status.
Against an EMPTY error body `res.ok ? (await res.json()).x ?? [] : []` and a bare
`await res.json()` are indistinguishable, so the ok-check could be deleted with
no test noticing.

Two of the tests exist because the mutation pass proved the obvious version was
blind: the FAQ category input and the accent-colour input both carry their own
`?? ""` / `|| default`, so dropping the coded default upstream is **invisible on
screen** and only shows in the saved payload. Both are now asserted against the
PUT body, not the DOM.

> **Divergence worth knowing:** `WidgetBody` renders `0` on a failed request,
> where the lexware and time-tracker widgets render `—`. Pinned as-is rather
> than changed here, but a 500 makes the tile read "0 offene Chats" — exactly
> the state an agent stops looking at.

Verified by mutation: 69 deliberate breakages introduced, 69 caught.

## Wiring points (Stage B — outside this repo)

`tds-core-frontend-api` (`composer.json` path repo + require, `Modules::enabled()`),
`tds-admin-frontend` (`package.json` + `astro.config.mjs` extensions), `tds-shared-pkg` (the
`LiveChatCta` island), the panel host + public sites' `Layout.astro` (mount the island), and
`core-frontend-api` CORS (public + portal origins).
