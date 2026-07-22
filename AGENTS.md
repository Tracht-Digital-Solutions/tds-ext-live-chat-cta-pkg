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
- **Env precedence trap**: read env with the explicit `getenv() === false ? default` pattern
  (`self::env()`), never `?? getenv() ?: $default` (clobbers `"0"`/`""`).
- Depends on the **published** `tds-frontend-contract` (`^1.0.0`) — npm from GitHub Packages,
  Composer from the public VCS repo. No local path repo (Composer fatals in CI). CI installs
  with `npm install --no-package-lock`, never `npm ci`.
- Version bumps `package.json` + `composer.json` in lockstep; the pushed annotated tag is the
  Composer release ref. Stay in the `0.1.x` line (host caret pin).
- `PACKAGE_TOKEN` (public-Packages PAT, `read`+`write`+`delete:packages` + `repo`,
  SSO-authorized) installs the contract and publishes; `NPM_TOKEN` is set from it in CI.

## Wiring points (Stage B — outside this repo)

`tds-core-frontend-api` (`composer.json` path repo + require, `Modules::enabled()`),
`tds-admin-frontend` (`package.json` + `astro.config.mjs` extensions), `tds-shared-pkg` (the
`LiveChatCta` island), the panel host + public sites' `Layout.astro` (mount the island), and
`core-frontend-api` CORS (public + portal origins).
