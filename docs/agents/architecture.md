# Architecture

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Manifest: routes `/live-chat` and `/wiki-inhalte`, widget, settings section, `live-chat:*` + `wiki:*` permissions, i18n |
| `pages/Index.astro` + `islands/LiveChatManager.tsx` | Chat inbox (content-only page; the host layout wraps it) |
| `pages/WikiContent.astro` + `islands/WikiContentManager.tsx` | Wiki editor, tabs FAQ / Handbücher |
| `islands/Settings.astro` + `islands/LiveChatSettings.tsx` | Activation matrix + branding via `/admin/settings/live-chat-cta` |
| `widgets/Widget.astro` + `islands/WidgetBody.tsx` | "Offene Chats" dashboard widget |
| `php/src/LiveChatCtaModule.php` + `php/src/Domain/*Repository.php` | Backend module (`Chat`, `Contact`, `Doc`, `Faq`) |

## Routes

| Route | Access | Purpose |
|---|---|---|
| `GET /live-chat-cta/config` | public | The one call the bubble makes |
| `POST /live-chat-cta/chat` | public | Open a chat |
| `GET` / `POST /live-chat-cta/chat/{id:[0-9]+}/messages` | chat token | Visitor thread |
| `POST /live-chat-cta/contact` | public | Contact form |
| `GET /help/faqs`, `GET /help/articles`, `GET /help/articles/{slug:[a-z0-9-]+}` | public | Wiki content |
| `GET /live-chat-cta/summary` | `live-chat:read` | Widget |
| `/admin/live-chat-cta/sessions…` | `live-chat:*` | Inbox, reply, open/closed |
| `/admin/live-chat-cta/faqs…`, `/admin/live-chat-cta/docs…` | `wiki:*` | FAQ and handbook CRUD (edit = PUT) |

## Activation matrix (core `SettingsStore`, namespace `live-chat-cta`)

DB first, env fallback, coded default. The bubble activates **per frontend and per feature**:

- `{frontend}_enabled` is the master switch. It has **no coded default**, so a fresh install
  never ships a bubble onto a public site unattended.
- `{frontend}_{chat|faq|docs|contact}` gate the tabs.
- Adding a frontend or feature means adding its `SettingDef`s (backend) **and** a row/column
  in `LiveChatSettings.tsx`. Keep `LiveChatCtaModule::FRONTENDS` / `FEATURES` and the
  island's lists in sync.
- A save writes the **whole** key set; this panel is the store's only writer.
- Env reads use the explicit `getenv() === false ? default` pattern (`self::env()`), never
  `?? getenv() ?: $default`, which clobbers `"0"` and `""`.

The config response shape (`enabled`, `cta`, `tabs`, `faqs`, `docs`) must match the
`LiveChatCta` island in `tds-shared-pkg`.

## Public route hardening

- Contact form: honeypot (`website` → 202), validation (422), salted-IP rate limit (429).
  Only the hash is stored, never the raw IP.
- Chat is token-scoped (`X-Chat-Token`, `hash_equals`). The admin API never exposes
  `public_token`.

## Wiki content

This extension owns the customer portal's wiki content, not just the bubble.
`live_chat_faq` and `live_chat_doc` feed two surfaces: the bubble's FAQ/Doku tabs and
`/wiki` in the customer portal.

- **`/help/*` is public and not behind the bubble's tab flags.** The portal wiki must not go
  blank because someone switched the FAQ tab off on a marketing site. The customer product
  doesn't compose this extension's frontend; its `/wiki` is host code calling this API.
- **The article index ships without bodies.** `/help/articles` returns titles and slugs; a
  body arrives from `/help/articles/{slug}` when opened.
- **Editing is `wiki:*`, the inbox is `live-chat:*`.** Publishing help content and answering
  chats are different jobs. A `live-chat:write` holder does not inherit wiki editing
  (admins bypass, as always).
- `live_chat_faq` is the **single** FAQ source. Don't reintroduce a code-side FAQ list.

## FAQ seed

Migration `20260801000006` (`LiveChatCtaSeedFaqLogin`) inserts the central-login entries
(DE + EN: session scope, sign-out, password change). `tds-auth-frontend` deliberately no
longer prints them on the login page.

- The seed **skips a question that already exists**.
- `down()` deletes only rows still carrying the seeded answer verbatim.
- A re-run or rollback must never overwrite or drop an operator's edit.
- Answers are plain text; the bubble's `Prose` renderer splits on newlines.

## Data model

Tables `live_chat_faq`, `live_chat_doc`, `live_chat_session`, `live_chat_message`,
`live_chat_contact`. Migrations `LiveChatCta*` in the `20260801*` band.

## Inbox and editor rules

- A message is attributed to the **right side** of the conversation.
- The open/closed toggle sends the **opposite** of the current state and doesn't flip the
  badge when the PATCH fails.
- The inbox polls every 4 s and clears the poll on unmount.
- Both editors **PUT an edit**; a POST would create a duplicate row on every save.
- The inbox page has no tab bar; the editors live on `/wiki-inhalte`.
- Outcomes (reply, toggle, editor saves) are toasts. Form validation and load failure stay
  in-flow as `.tds-alert--danger`.
- Known divergence: `WidgetBody` renders `0` on failure (lexware and time-tracker render
  `—`), so a 500 reads "0 offene Chats".

## Motion (tds-shared ≥ 0.38.7)

Chat list and wiki lists are `AnimatedList`s, the thread area cross-fades per chat
(`Presence`), the wiki tabs carry a `TabIndicator`.

## Wiring outside this repo

- `tds-core-frontend-api`: Composer require and `Modules::enabled()`; CORS for public and
  portal origins.
- `tds-admin-frontend`: `package.json` and the extensions list.
- `tds-shared-pkg`: the `LiveChatCta` island.
- Panel host and public sites: mount the island in `Layout.astro`.
