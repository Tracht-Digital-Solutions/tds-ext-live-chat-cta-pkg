# Testing

```bash
npm run test:run   # vitest; islands opt into jsdom per file via a @vitest-environment docblock
composer test      # phpunit
```

CI (`_build.yml`) runs both suites, plus type-check, `lint:primitives` and build, on
every run.

## Test environment against the current tds-shared

tds-shared is a **peer** dependency, so a fresh standalone install may resolve an old
version while every product build composes the current one. Keep these in mind:

- `apiFetch` first consults the host runtime config (`/tds-runtime.json`), so
  `fetch.mock.calls[0]` is that probe. Call **`primeRuntimeConfig(null)`** in
  `beforeEach`; panel products never ship that file, so "absent" matches production.
- `apiFetch` is **async**. `await waitFor(() => expect(fetch).toHaveBeenCalled())`
  before reading `mock.calls`.
- A multipart upload carries an **empty** `headers` object. Assert "no content-type
  header", never "headers is undefined".
- Error-path tests answer with a **populated** body and a non-OK status. Against an
  empty error body the ok-check is unobservable.
- At least one assertion per suite pins the **absolute API host** (see
  [frontend-conventions.md](frontend-conventions.md#api-calls-apifetch-never-a-relative-fetch)).

## Suites

| Suite | Sharpest assertions |
|---|---|
| `islands/LiveChatManager.test.tsx` | The inbox; no tab bar; attribution side; toggle sends the opposite and keeps the badge on failure; 4 s poll runs and is cleared on unmount |
| `islands/WikiContentManager.test.tsx` | FAQ and handbook editors PUT edits |
| `islands/LiveChatSettings.test.tsx` | Frontends off until switched on; a save writes the whole key set |
| `islands/WidgetBody.test.tsx` | States, incl. `Number()` coercion of PDO string columns for the plural rule |
| `src/index.test.ts` + `tests/packaging.test.ts` | Manifest as a product build sees it; specifiers exported and in `files` |
| `php/tests/LiveChatCtaModuleTest.php`, `LiveChatCtaApiDocsTest.php` | Routes/RBAC and doc parity |

### Fake timers and motion

- Fake-timer tests need **`MotionGlobalConfig.skipAnimations = true`**. Otherwise `Presence`
  in `wait` mode hangs, because Motion measures with `performance.now()`, which fake timers
  don't advance.
- After a click, give one `tick()` so the new area mounts before advancing the clock.

### Assert defaults in the payload

The FAQ category input and the accent-colour input carry their own `?? ""` / `|| default`,
so dropping the coded default upstream is invisible on screen. Both are asserted against the
PUT body, not the DOM.

Mutation check: 69 breakages, 69 caught.
