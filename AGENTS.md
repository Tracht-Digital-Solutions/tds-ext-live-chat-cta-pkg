# AGENTS.md — tds-ext-live-chat-cta-pkg

A TDS frontend extension: the floating **Live-Chat-CTA** support widget (live chat + FAQ +
docs + contact form). Read `tds-frontend-contract-pkg`'s AGENTS.md first — extensions
implement that contract. Scaffolded from `tds-ext-template-pkg`; `tds-ext-tools-pkg` (public
config + `SettingsStore`) and `tds-ext-contact-tickets-pkg` (public-form hardening) are the
worked references.

## Shape

- `src/index.ts` — the `defineExtension({...})` manifest (admin routes `/live-chat` and
  `/wiki-inhalte`, dashboard widget, settings section, `live-chat:*` + `wiki:*` permissions, i18n).
- `pages/Index.astro` + `islands/LiveChatManager.tsx` — the chat inbox. Content-only page
  (host Layout wraps it).
- `pages/WikiContent.astro` + `islands/WikiContentManager.tsx` — the **Wiki-Inhalte** editor
  (tabs: FAQ / Handbücher), split out of the inbox when the panel gained two wikis.
- `php/docs/api.php` — the route documentation the admin API reference renders.
- `islands/Settings.astro` + `islands/LiveChatSettings.tsx` — the settings section: the
  frontend × feature **activation matrix** + branding, read/written via `/admin/settings/live-chat-cta`.
- `widgets/Widget.astro` + `islands/WidgetBody.tsx` — the "Offene Chats" dashboard widget.
- `php/src/LiveChatCtaModule.php` + `php/src/Domain/*Repository.php` — the backend Module.
- `php/db/migrations/20260801*` — Phinx, classes prefixed `LiveChatCta*`.

## Conventions baked in (don't regress)

- **Call the API with `apiFetch` from `@tracht-digital-solutions/tds-shared/api`,
  never a relative `fetch`.** Every island used to define its own
  `const api = (path, init) => fetch(path, { credentials: "include", ...init })`
  with a RELATIVE path. In a product that resolves against the product's own
  static host (`management.`/`app.tracht-digital.de`), not the API — and the
  static host answers unknown paths with its SPA fallback, i.e. **200 + HTML**.
  So `res.ok` is `true`, `res.json()` throws, and the usual
  `.catch(() => setRows([]))` renders a calm, permanent empty state with no
  error and no console warning. `apiFetch` resolves the base from
  `<meta name="tds-api-base">` (written by the frontend host) and routes 401s
  through the host's confirm-against-`/me` backstop, which extension calls
  previously skipped entirely.
  The island tests match on the request PATH (`pathOf()`), which a relative
  fetch satisfies just as well — so one assertion per suite pins the **absolute
  host**. That is the line that fails if this ever regresses.


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
  overwrite or drop an operator's edit. Answers are plain text (the widget's `Prose`
  renderer splits on newlines and renders text nodes; there is no markup layer).
  > There used to be a second, hard-coded copy of these three entries in the frontend
  > host (`src/content/faq.ts`) that had to be kept "in rough sync" by hand. It is
  > **gone**: `live_chat_faq` is now the single source, read by the customer wiki through
  > `/help/faqs`. Do not reintroduce a code-side FAQ list.

- **This extension owns the customer portal's WIKI CONTENT, not just the chat bubble.**
  `live_chat_faq` and `live_chat_doc` feed two surfaces from one set of rows: the widget's
  FAQ/Doku tabs *and* `/wiki` in the customer portal. Three consequences:
  - **`/help/faqs`, `/help/articles`, `/help/articles/{slug}` are public and NOT behind the
    widget's per-frontend tab flags.** The portal's Wiki must not go blank because someone
    switched the chat bubble's FAQ tab off on a marketing site. They are also the reason a
    *base* page can render the wiki at all: the customer product does not compose this
    extension's frontend half, so `/wiki` there is host code calling this API — the same
    arrangement the shell already uses for `/live-chat-cta/config`.
  - **The article index ships without bodies.** `/help/articles` returns titles and slugs;
    the body arrives from `/help/articles/{slug}` when one is opened. The widget wants
    everything at once because it renders inline — the wiki does not, and shipping two
    hundred markdown bodies to draw a list of headings is the difference between a page
    that opens and one that stalls.
  - **Editing is `wiki:*`, the inbox is `live-chat:*`.** Publishing help content and
    answering support chats are different jobs granted to different people. An existing
    `live-chat:write` holder does **not** inherit wiki editing (admins bypass, as always).
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
npm run test:run    # vitest, 149 tests (jsdom per-file via a @vitest-environment docblock)
composer test       # phpunit: the Module's routes/RBAC + route↔documentation parity
```

- `islands/LiveChatManager.test.tsx` — the inbox, and that the page has **no tab
  bar** any more (a leftover one would mean two ways to reach one editor).
- `islands/WikiContentManager.test.tsx` — the FAQ editor and the handbook
  editor, split off with the island. The inbox is the live half (an agent
  watching a thread while a
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

## Mobile layout

This package ships **no CSS**, so every layout decision is a shared class or a
Tailwind utility, and neither is checked by anything at runtime. Two rules:

- **A row of more than two things — or any row holding a full-width field —
  goes on `.tds-row`, `.tds-list__row` or `.tds-toolbar`.** All three wrap.
  A hand-rolled `flex` does not, and on a 375px screen the overflow is not
  even visible: `body { overflow-x: hidden }` clips it, so the content simply
  is not there.
- **A `<table>` needs `tds-table` and nothing else.** The primitive turns
  itself into a horizontal scroller below 40rem; an extra `overflow-x`
  wrapper or an inline style is redundant. A table with no focusable cell
  also needs `tabindex="0"` + `role="region"` + a label, or its scrollport
  cannot be reached by keyboard.

`npm run lint:primitives` enforces the class part of this (including a
`<table>` without `tds-table` and a flex/grid table cell, which silently
drops the cell out of the column algorithm). It is a **regex scan**, so a tag
name written inside a comment counts as markup — name elements in prose.

## API-Referenz (`php/docs/api.php`)

This module implements the contract's optional `ApiDocSource`: `php/docs/api.php`
returns one entry per route (summary, params, responses, required permission),
and the admin frontend's API reference joins it onto the introspected Slim routes
by `"<METHOD> <pattern>"`. Two things to know before editing a route:

- **`pattern` must be the Slim pattern verbatim**, inline regex included
  (`/admin/live-chat-cta/faqs/{id:[0-9]+}`). A prettified path silently produces an orphan doc *and* an
  undocumented route rather than an error.
- **`php/tests/LiveChatCtaApiDocsTest.php` asserts both directions** — the documented
  set and the registered set must be the same set, every path placeholder must
  be described, and a named permission must exist in `permissions()`. Adding or
  renaming a route without touching `docs/api.php` fails there. That is the
  point: prose next to code rots, and a reference full of confident, wrong
  detail is worse than the bare route list it replaced.
