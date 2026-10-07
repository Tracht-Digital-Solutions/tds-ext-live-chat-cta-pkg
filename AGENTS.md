# AGENTS.md — tds-ext-live-chat-cta-pkg

Frontend extension behind the floating **Live-Chat-CTA** support widget (live chat, FAQ,
docs, contact form) and the customer portal's **wiki content**. It contributes a PHP
`Module` to `tds-core-frontend-api` and, to the admin product, the chat inbox
(`/live-chat`), the wiki editor (`/wiki-inhalte`), a settings section and a widget.

The visitor bubble UI is **not** here: it is the `LiveChatCta` island in `tds-shared-pkg`.
This repo serves its config and data.

Read `tds-frontend-contract-pkg/AGENTS.md` first. References: `tds-ext-tools-pkg` (public
config + `SettingsStore`), `tds-ext-contact-tickets-pkg` (public-form hardening).

## Commands

```bash
npm install --no-package-lock   # never npm ci
npm run type-check
npm run lint:primitives
npm run test:run                # vitest
npm run build                   # tsup
composer install && composer test   # phpunit: routes/RBAC + doc parity
```

## Hard rules

- Keep the `/live-chat-cta/config` response shape in sync with the `LiveChatCta` island in `tds-shared-pkg`.
- A frontend's bubble is **off until switched on**; there is no coded default for `{frontend}_enabled`.
- `/help/*` stays public and independent of the widget's tab flags.
- Public routes stay hardened (honeypot, validation, salted-IP rate limit, chat token). Never expose `public_token` or raw IPs.
- `live_chat_faq` is the single FAQ source. Never reintroduce a code-side FAQ list.
- Seeds are non-destructive: skip existing rows, roll back only untouched ones.
- Migration file names map to `LiveChatCta*` classes; versions stay in the `20260801*` band.
- Edits PUT, never POST. Outcomes are toasts. Call the API with `apiFetch`. Never mount a `ToastHost`.
- Stay in the `0.1.x` line. Versions move via the release workflow only.

## Topic files

| File | Read before |
|---|---|
| [docs/agents/architecture.md](docs/agents/architecture.md) | Changing routes, the activation matrix, wiki content, seeds or the data model |
| [docs/agents/backend.md](docs/agents/backend.md) | Touching PHP, migrations or `php/docs/api.php` |
| [docs/agents/frontend-conventions.md](docs/agents/frontend-conventions.md) | Touching any island, page or widget markup |
| [docs/agents/testing.md](docs/agents/testing.md) | Writing or changing tests, especially with fake timers |
| [docs/agents/release.md](docs/agents/release.md) | Releasing or changing CI |

Workspace rules: `../CLAUDE.md`. Cross-repo state: `../MIGRATION-STATUS.md`.
