# tds-ext-live-chat-cta-pkg

A **TDS frontend extension** for a floating bottom-right **support widget** — a CTA
bubble (with a hide/collapse control) that opens a help panel with **live chat + FAQ +
documentation + a contact form**. Activatable **per frontend AND per feature** from the
admin *Einstellungen* (e.g. FAQ+docs on the blog, full chat on the landingpage), with no
rebuild.

## Two halves

- **This extension** owns the **backend + admin management surface**:
  - the PHP `Module` (`php/src/LiveChatCtaModule.php`): the public config/chat/contact API,
    the admin chat inbox, FAQ + documentation CRUD, the dashboard summary, and the
    per-frontend/per-feature `SettingsStore` config;
  - the admin frontend manifest (`src/index.ts`): the `/live-chat` route, a dashboard
    widget, and the settings section (the activation matrix).
- **The visitor bubble UI** lives in **`tds-shared-pkg`** as the `LiveChatCta` island (like
  `CookieNotice`) — the contract has no "global overlay" slot, and the public sites + panel
  host already depend on `tds-shared`. The island talks to this extension's API; everything
  it renders (enabled?, branding, FAQ/docs) comes from `GET /live-chat-cta/config`.

## API surface (mounted in `tds-core-frontend-api`)

**Public (unauth):**
- `GET  /live-chat-cta/config?frontend={key}&lang={de|en}` — the one call the widget makes on
  mount: per-frontend enablement + resolved tabs + branding + (when enabled) FAQ/docs.
- `POST /live-chat-cta/chat` → `{ id, token }` — start a session (visitor keeps the token).
- `GET  /live-chat-cta/chat/{id}/messages?since={id}` (`X-Chat-Token`) — poll for messages.
- `POST /live-chat-cta/chat/{id}/messages` (`X-Chat-Token`) — visitor sends a message.
- `POST /live-chat-cta/contact` — contact form (honeypot + validation + salted-IP rate limit).

**Admin (`live-chat:read` / `live-chat:write`, admin bypass):**
- `GET  /live-chat-cta/summary` — open chats + new contacts (dashboard widget).
- `GET/PATCH /admin/live-chat-cta/sessions[...]`, `POST …/sessions/{id}/reply` — the inbox.
- `GET/POST/PUT/DELETE /admin/live-chat-cta/faqs[/{id}]` — FAQ CRUD.
- `GET/POST/PUT/DELETE /admin/live-chat-cta/docs[/{id}]` — documentation CRUD.

**Seeded FAQ.** Migration `20260801000006` creates six published FAQ entries (DE + EN) on
the central login — session scope ("gilt meine Anmeldung auch in den anderen Bereichen?"),
sign-out, password change — because the login page itself no longer states this. They are
normal rows: edit or delete them under `/live-chat`. The seed skips a question that already
exists and never overwrites an edited answer.

Config is stored in the core `SettingsStore` (namespace `live-chat-cta`): branding
(`cta_label`/`cta_greeting`/`cta_accent`/`agent_email`) + the matrix `{frontend}_enabled`
and `{frontend}_{chat|faq|docs|contact}` for frontends `landingpage`, `blog`, `customer`,
`admin`, `tools`.

## Enable it

1. **Backend** — in `tds-core-frontend-api`: add the Composer require + a `path` repo entry,
   and `new LiveChatCtaModule()` to `Modules::enabled()`.
2. **Admin frontend** — in `tds-admin-frontend`: add the npm dep and append the manifest to
   `frontendHost({ extensions })`.
3. **Visitor bubble** — add the `LiveChatCta` island (from `tds-shared`) to each public site's
   `Layout.astro` and to the panel host `Layout.astro`; the widget renders only where its
   frontend key is enabled.
4. **CORS** — `core-frontend-api`'s `CORS_ALLOWED_ORIGINS` must include the public + portal
   origins (the widget calls the config/chat/contact routes cross-origin with credentials).

## Develop

```bash
npm install --no-package-lock   # pulls tds-frontend-contract from GitHub Packages (needs NPM_TOKEN)
npm run build && npm run type-check
composer install                # resolves tds-frontend-contract from its public VCS repo
composer test
```

DB-backed behaviour is exercised in `tds-core-frontend-api` (composed) against real MariaDB;
this repo's phpunit boots the module on a real Slim app with a tiny container (public config
reachable, admin route 401 anon).

**Run the migrations for real after touching them** — phpunit does not, and Phinx only
reports a file-name/class-name mismatch when it scans the set (which aborts *every*
extension's migration, not just this one):

```bash
# throwaway DB + a temp phinx config pointing at php/db/migrations
docker run --rm -d --name tds-maria -e MARIADB_ROOT_PASSWORD=dev \
  -e MARIADB_DATABASE=tds_livechat -p 3306:3306 mariadb:11
php ../tds-core-frontend-api/vendor/bin/phinx migrate -c /path/to/phinx-test.php -e test
php ../tds-core-frontend-api/vendor/bin/phinx rollback -c /path/to/phinx-test.php -e test -t 20260801000005
```

The seed (`20260801000006`) is worth re-running twice with an edited row in between: it must
add nothing the second time and must not touch the edit, and the rollback must leave it.

## Versioning

Semver; bump `package.json` **and** `composer.json` in lockstep (the release workflow does
this). Extensions stay in the `0.1.x` line (host caret pin). npm → GitHub Packages; the
Composer half is consumed via the git tag the release pushes.
