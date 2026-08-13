<?php
declare(strict_types=1);

namespace Tds\Ext\LiveChatCta;

use PDO;
use Psr\Container\ContainerInterface;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;
use Tds\Ext\LiveChatCta\Domain\ChatRepository;
use Tds\Ext\LiveChatCta\Domain\ContactRepository;
use Tds\Ext\LiveChatCta\Domain\DocRepository;
use Tds\Ext\LiveChatCta\Domain\FaqRepository;
use Tds\Frontend\Contract\AbstractModule;
use Tds\Frontend\Contract\ApiDocSource;
use Tds\Frontend\Contract\Email;
use Tds\Frontend\Contract\Mailer;
use Tds\Frontend\Contract\PermissionDef;
use Tds\Frontend\Contract\SettingDef;
use Tds\Frontend\Contract\SettingsStore;
use Tds\Frontend\Contract\UserContext;

/**
 * Backend Module for the Live-Chat-CTA — the floating bottom-right support widget.
 *
 * The visitor UI (bubble + panel) lives in tds-shared-pkg as the `LiveChatCta`
 * island; this Module owns everything behind it:
 *   - PUBLIC (unauth): `GET /live-chat-cta/config` (the one call the widget makes
 *     on mount — per-frontend/per-feature enablement + branding + FAQ/docs), a
 *     token-scoped polling chat (`/live-chat-cta/chat*`), and a hardened contact
 *     form (`POST /live-chat-cta/contact`).
 *   - PUBLIC help content (`/help/faqs`, `/help/articles*`): the same FAQ and
 *     handbook rows, read by the CUSTOMER PORTAL'S WIKI. Deliberately not
 *     behind the widget's per-frontend tab flags — the portal's Wiki must not
 *     go blank because the chat bubble's FAQ tab was switched off somewhere.
 *   - ADMIN (RBAC via {@see UserContext}): the chat inbox under `live-chat:*`,
 *     and the FAQ + handbook CRUD under `wiki:*` (the *Wiki-Inhalte* page).
 *
 * Config is stored in the core {@see SettingsStore} (ns `live-chat-cta`), so the
 * bubble is activated per frontend AND per feature from the admin Einstellungen
 * with no rebuild — a checkbox matrix of {frontend} × {enabled,chat,faq,docs,contact}.
 */
final class LiveChatCtaModule extends AbstractModule implements ApiDocSource
{
    private const NS = 'live-chat-cta';

    /** Known frontends the bubble can be activated on (drives the settings matrix). */
    private const FRONTENDS = ['landingpage', 'blog', 'customer', 'admin', 'tools'];

    /** Per-frontend toggleable features (the widget's tabs). */
    private const FEATURES = ['chat', 'faq', 'docs', 'contact'];

    private const CONTACT_STATUSES = ['new', 'handled', 'spam'];

    /** Public-form rate limit: at most N contact submissions per IP per window. */
    private const RATE_MAX = 5;
    private const RATE_WINDOW_SECONDS = 600;

    public function id(): string
    {
        return 'live-chat-cta';
    }

    /** @return PermissionDef[] */
    public function permissions(): array
    {
        return [
            new PermissionDef('live-chat:read', 'Live-Chat ansehen', 'live-chat-cta'),
            new PermissionDef('live-chat:write', 'Live-Chat bearbeiten', 'live-chat-cta'),
            // Separate from live-chat:* on purpose. The FAQ and handbook rows
            // are no longer just the chat bubble's content — they ARE the
            // customer portal's Wiki, so editing them is a publishing right,
            // not a support-inbox one, and it is granted to different people.
            new PermissionDef('wiki:read', 'Wiki-Inhalte ansehen', 'live-chat-cta'),
            new PermissionDef('wiki:write', 'Wiki-Inhalte bearbeiten', 'live-chat-cta'),
        ];
    }

    /** @return string[] */
    public function migrations(): array
    {
        return [__DIR__ . '/../db/migrations'];
    }

    /** @return SettingDef[] */
    public function settings(): array
    {
        $defs = [
            new SettingDef('cta_label', 'CTA-Text (Button)', false, self::NS, 'Fragen? Schreib uns'),
            new SettingDef('cta_greeting', 'Begrüßung im Panel', false, self::NS, 'Hallo! Wie können wir helfen?'),
            new SettingDef('cta_accent', 'Akzentfarbe (Hex)', false, self::NS, '#050f68'),
            new SettingDef('agent_email', 'Benachrichtigungs-E-Mail (Agent)', false, self::NS),
        ];
        // The frontend × feature activation matrix. `<frontend>_enabled` is the
        // master switch per frontend (off by default → nothing shows until
        // activated); each feature defaults on once the frontend is enabled.
        foreach (self::FRONTENDS as $f) {
            $defs[] = new SettingDef($f . '_enabled', "Aktiv auf {$f}", false, self::NS, '0');
            foreach (self::FEATURES as $feat) {
                $defs[] = new SettingDef("{$f}_{$feat}", "{$f}: {$feat}", false, self::NS, '1');
            }
        }
        return $defs;
    }

    public function register(App $app): void
    {
        $c = $app->getContainer();
        if ($c !== null && !$c->has(FaqRepository::class)) {
            $c->set(FaqRepository::class, static fn ($c) => new FaqRepository($c->get(PDO::class)));
            $c->set(DocRepository::class, static fn ($c) => new DocRepository($c->get(PDO::class)));
            $c->set(ChatRepository::class, static fn ($c) => new ChatRepository($c->get(PDO::class)));
            $c->set(ContactRepository::class, static fn ($c) => new ContactRepository($c->get(PDO::class)));
        }

        // === PUBLIC =========================================================

        // The one call the widget makes on mount. Per-frontend/per-feature config
        // + branding + (when enabled) the FAQ/docs content, all in one response.
        $app->get('/live-chat-cta/config', function (Request $req, Response $res) use ($c): Response {
            $q = $req->getQueryParams();
            $frontend = self::frontendKey((string) ($q['frontend'] ?? ''));
            $lang = ($q['lang'] ?? 'de') === 'en' ? 'en' : 'de';

            $enabled = $frontend !== '' && self::flag($c, "{$frontend}_enabled", '0');
            $tabs = [];
            foreach (self::FEATURES as $feat) {
                $tabs[$feat] = $enabled && self::flag($c, "{$frontend}_{$feat}", '1');
            }

            $faqs = ($tabs['faq'] && $c !== null) ? $c->get(FaqRepository::class)->published($lang) : [];
            $docs = ($tabs['docs'] && $c !== null) ? $c->get(DocRepository::class)->published($lang) : [];

            return self::json($res, [
                'enabled' => $enabled,
                'cta' => [
                    'label' => self::setting($c, 'cta_label', 'Fragen? Schreib uns'),
                    'greeting' => self::setting($c, 'cta_greeting', 'Hallo! Wie können wir helfen?'),
                    'accent' => self::setting($c, 'cta_accent', '#050f68'),
                ],
                'tabs' => $tabs,
                'faqs' => $faqs,
                'docs' => $docs,
            ]);
        });

        // Start a chat session (anonymous — the visitor keeps the returned token).
        $app->post('/live-chat-cta/chat', function (Request $req, Response $res) use ($c): Response {
            $body = (array) $req->getParsedBody();
            $name = self::optional($body['name'] ?? null, 120);
            $email = self::optional($body['email'] ?? null, 254);
            $frontend = self::frontendKey((string) ($body['frontend'] ?? ''));
            $token = bin2hex(random_bytes(24));
            $repo = $c->get(ChatRepository::class);
            $id = $repo->createSession($token, $name, $email, $frontend !== '' ? $frontend : null);
            $first = trim((string) ($body['message'] ?? ''));
            if ($first !== '') {
                $repo->addMessage($id, 'visitor', mb_substr($first, 0, 4000));
                self::notifyAgent($c, $id, $first);
            }
            return self::json($res, ['id' => $id, 'token' => $token], 201);
        });

        // Poll for messages (token-scoped, id cursor).
        $app->get('/live-chat-cta/chat/{id:[0-9]+}/messages', function (Request $req, Response $res, array $args) use ($c): Response {
            $id = (int) $args['id'];
            if (!$c->get(ChatRepository::class)->sessionOwnedBy($id, self::chatToken($req))) {
                return self::json($res, ['error' => 'Unauthorized'], 401);
            }
            $since = (int) ($req->getQueryParams()['since'] ?? 0);
            $session = $c->get(ChatRepository::class)->findSession($id);
            return self::json($res, [
                'messages' => $c->get(ChatRepository::class)->messagesSince($id, $since),
                'status' => $session['status'] ?? 'open',
            ]);
        });

        // Visitor sends a message.
        $app->post('/live-chat-cta/chat/{id:[0-9]+}/messages', function (Request $req, Response $res, array $args) use ($c): Response {
            $id = (int) $args['id'];
            $repo = $c->get(ChatRepository::class);
            if (!$repo->sessionOwnedBy($id, self::chatToken($req))) {
                return self::json($res, ['error' => 'Unauthorized'], 401);
            }
            $text = trim((string) (((array) $req->getParsedBody())['body'] ?? ''));
            if ($text === '') {
                return self::json($res, ['error' => 'body is required'], 422);
            }
            $msgId = $repo->addMessage($id, 'visitor', mb_substr($text, 0, 4000));
            self::notifyAgent($c, $id, $text);
            return self::json($res, ['id' => $msgId], 201);
        });

        // Public contact form (honeypot + validation + salted-IP rate limit).
        $app->post('/live-chat-cta/contact', function (Request $req, Response $res) use ($c): Response {
            $body = (array) $req->getParsedBody();
            if (trim((string) ($body['website'] ?? '')) !== '') { // honeypot → accept silently
                return self::json($res, ['ok' => true], 202);
            }
            $name = trim((string) ($body['name'] ?? ''));
            $email = strtolower(trim((string) ($body['email'] ?? '')));
            $message = trim((string) ($body['message'] ?? ''));
            if (mb_strlen($name) < 2 || filter_var($email, FILTER_VALIDATE_EMAIL) === false || mb_strlen($message) < 20) {
                return self::json($res, ['error' => 'Invalid contact payload'], 422);
            }
            $repo = $c->get(ContactRepository::class);
            $ipHash = self::clientIpHash($req);
            if ($ipHash !== null && $repo->recentFromIp($ipHash, self::RATE_WINDOW_SECONDS) >= self::RATE_MAX) {
                return self::json($res, ['error' => 'Too many requests'], 429);
            }
            $id = $repo->create(
                $name,
                $email,
                self::optional($body['subject'] ?? null, 200),
                mb_substr($message, 0, 10000),
                self::frontendKey((string) ($body['frontend'] ?? '')) ?: null,
                $ipHash,
            );
            self::notifyAgent($c, 0, "Neue Kontaktanfrage #{$id} von {$name} <{$email}>", $email);
            return self::json($res, ['id' => $id], 201);
        });

        // === PUBLIC: help content for the customer wiki =====================
        //
        // The same `live_chat_faq` / `live_chat_doc` rows the widget shows, but
        // NOT behind the widget's per-frontend tab flags: the customer portal's
        // Wiki must not go blank because someone switched the chat bubble's FAQ
        // tab off on a marketing site. Published rows only, read-only, and
        // unauthenticated like `/live-chat-cta/config` — help text is not
        // sensitive, and the customer product does not compose this extension's
        // frontend half, so the wiki page is a BASE page calling in here.

        $app->get('/help/faqs', function (Request $req, Response $res) use ($c): Response {
            $lang = self::lang($req->getQueryParams()['lang'] ?? null);
            try {
                return self::json($res, ['faqs' => $c->get(FaqRepository::class)->published($lang)]);
            } catch (\Throwable) {
                // Same fail-safe as the CMS read surface: an empty wiki is a
                // calm (if unhelpful) page; a 500 is a broken portal.
                return self::json($res, ['faqs' => []]);
            }
        });

        $app->get('/help/articles', function (Request $req, Response $res) use ($c): Response {
            $lang = self::lang($req->getQueryParams()['lang'] ?? null);
            try {
                return self::json($res, ['articles' => $c->get(DocRepository::class)->publishedIndex($lang)]);
            } catch (\Throwable) {
                return self::json($res, ['articles' => []]);
            }
        });

        $app->get('/help/articles/{slug:[a-z0-9-]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            $lang = self::lang($req->getQueryParams()['lang'] ?? null);
            try {
                $article = $c->get(DocRepository::class)->findPublishedBySlug((string) $args['slug'], $lang);
            } catch (\Throwable) {
                $article = null;
            }
            return $article === null
                ? self::json($res, ['error' => 'Not found'], 404)
                : self::json($res, ['article' => $article]);
        });

        // === ADMIN ==========================================================

        // Dashboard widget summary.
        $app->get('/live-chat-cta/summary', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'live-chat:read', $res)) !== null) {
                return $deny;
            }
            return self::json($res, [
                'openChats' => $c->get(ChatRepository::class)->openCount(),
                'newContacts' => $c->get(ContactRepository::class)->newCount(),
            ]);
        });

        // --- Chat inbox ---
        $app->get('/admin/live-chat-cta/sessions', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'live-chat:read', $res)) !== null) {
                return $deny;
            }
            $status = $req->getQueryParams()['status'] ?? null;
            $status = in_array($status, ['open', 'closed'], true) ? (string) $status : null;
            return self::json($res, ['sessions' => $c->get(ChatRepository::class)->listSessions($status)]);
        });

        $app->get('/admin/live-chat-cta/sessions/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'live-chat:read', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(ChatRepository::class);
            $session = $repo->findSession((int) $args['id']);
            if ($session === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            unset($session['public_token']); // never expose the visitor token to the admin API
            $session['messages'] = $repo->messagesSince((int) $args['id'], 0);
            return self::json($res, $session);
        });

        $app->post('/admin/live-chat-cta/sessions/{id:[0-9]+}/reply', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'live-chat:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(ChatRepository::class);
            $id = (int) $args['id'];
            if ($repo->findSession($id) === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $text = trim((string) (((array) $req->getParsedBody())['body'] ?? ''));
            if ($text === '') {
                return self::json($res, ['error' => 'body is required'], 422);
            }
            $msgId = $repo->addMessage($id, 'agent', mb_substr($text, 0, 4000));
            return self::json($res, ['id' => $msgId], 201);
        });

        $app->patch('/admin/live-chat-cta/sessions/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'live-chat:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(ChatRepository::class);
            $id = (int) $args['id'];
            if ($repo->findSession($id) === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $status = (string) (((array) $req->getParsedBody())['status'] ?? '');
            if (!in_array($status, ['open', 'closed'], true)) {
                return self::json($res, ['error' => 'status must be open|closed'], 422);
            }
            $repo->setStatus($id, $status);
            return self::json($res, ['ok' => true]);
        });

        // --- FAQ CRUD ---
        $app->get('/admin/live-chat-cta/faqs', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:read', $res)) !== null) {
                return $deny;
            }
            return self::json($res, ['faqs' => $c->get(FaqRepository::class)->all()]);
        });

        $app->post('/admin/live-chat-cta/faqs', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:write', $res)) !== null) {
                return $deny;
            }
            $b = (array) $req->getParsedBody();
            $question = trim((string) ($b['question'] ?? ''));
            $answer = trim((string) ($b['answer'] ?? ''));
            if ($question === '' || $answer === '') {
                return self::json($res, ['error' => 'question and answer are required'], 422);
            }
            $id = $c->get(FaqRepository::class)->create(
                self::lang($b['lang'] ?? null),
                self::optional($b['category'] ?? null, 120),
                mb_substr($question, 0, 300),
                $answer,
                (int) ($b['sort_order'] ?? 100),
                self::boolish($b['is_published'] ?? true),
            );
            return self::json($res, ['id' => $id], 201);
        });

        $app->put('/admin/live-chat-cta/faqs/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:write', $res)) !== null) {
                return $deny;
            }
            $b = (array) $req->getParsedBody();
            $ok = $c->get(FaqRepository::class)->update(
                (int) $args['id'],
                self::lang($b['lang'] ?? null),
                self::optional($b['category'] ?? null, 120),
                mb_substr(trim((string) ($b['question'] ?? '')), 0, 300),
                trim((string) ($b['answer'] ?? '')),
                (int) ($b['sort_order'] ?? 100),
                self::boolish($b['is_published'] ?? true),
            );
            return $ok ? self::json($res, ['ok' => true]) : self::json($res, ['error' => 'Not found'], 404);
        });

        $app->delete('/admin/live-chat-cta/faqs/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:write', $res)) !== null) {
                return $deny;
            }
            $ok = $c->get(FaqRepository::class)->delete((int) $args['id']);
            return $ok ? self::json($res, ['ok' => true]) : self::json($res, ['error' => 'Not found'], 404);
        });

        // --- Documentation CRUD ---
        $app->get('/admin/live-chat-cta/docs', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:read', $res)) !== null) {
                return $deny;
            }
            return self::json($res, ['docs' => $c->get(DocRepository::class)->all()]);
        });

        $app->post('/admin/live-chat-cta/docs', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:write', $res)) !== null) {
                return $deny;
            }
            $b = (array) $req->getParsedBody();
            $title = trim((string) ($b['title'] ?? ''));
            if ($title === '') {
                return self::json($res, ['error' => 'title is required'], 422);
            }
            $id = $c->get(DocRepository::class)->create(
                self::lang($b['lang'] ?? null),
                self::slug((string) ($b['slug'] ?? ''), $title),
                mb_substr($title, 0, 200),
                (string) ($b['body_markdown'] ?? ''),
                (int) ($b['sort_order'] ?? 100),
                self::boolish($b['is_published'] ?? true),
            );
            return self::json($res, ['id' => $id], 201);
        });

        $app->put('/admin/live-chat-cta/docs/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:write', $res)) !== null) {
                return $deny;
            }
            $b = (array) $req->getParsedBody();
            $title = trim((string) ($b['title'] ?? ''));
            $ok = $c->get(DocRepository::class)->update(
                (int) $args['id'],
                self::lang($b['lang'] ?? null),
                self::slug((string) ($b['slug'] ?? ''), $title),
                mb_substr($title, 0, 200),
                (string) ($b['body_markdown'] ?? ''),
                (int) ($b['sort_order'] ?? 100),
                self::boolish($b['is_published'] ?? true),
            );
            return $ok ? self::json($res, ['ok' => true]) : self::json($res, ['error' => 'Not found'], 404);
        });

        $app->delete('/admin/live-chat-cta/docs/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'wiki:write', $res)) !== null) {
                return $deny;
            }
            $ok = $c->get(DocRepository::class)->delete((int) $args['id']);
            return $ok ? self::json($res, ['ok' => true]) : self::json($res, ['error' => 'Not found'], 404);
        });
    }

    // --- helpers ---------------------------------------------------------------

    private static function notifyAgent(?ContainerInterface $c, int $sessionId, string $preview, ?string $replyTo = null): void
    {
        if ($c === null || !$c->has(Mailer::class)) {
            return;
        }
        $to = self::setting($c, 'agent_email', '');
        if ($to === '') {
            $to = self::env('LIVE_CHAT_AGENT_EMAIL', self::env('TICKET_ADMIN_EMAIL', ''));
        }
        $mailer = $c->get(Mailer::class);
        if ($to === '' || !$mailer->isConfigured()) {
            return;
        }
        $subject = $sessionId > 0 ? "Neue Live-Chat-Nachricht (Session #{$sessionId})" : 'Neue Kontaktanfrage';
        $mailer->send(new Email(
            $to,
            '',
            $subject,
            '<p>' . nl2br(htmlspecialchars(mb_substr($preview, 0, 500))) . '</p>',
            mb_substr($preview, 0, 500),
            $replyTo,
        ));
    }

    /** DB-first (SettingsStore ns), coded-default fallback. Tolerates a null container. */
    private static function setting(?ContainerInterface $c, string $key, string $default): string
    {
        $store = self::store($c);
        if ($store !== null) {
            $v = $store->get(self::NS, $key);
            if ($v !== null && $v !== '') {
                return $v;
            }
        }
        return $default;
    }

    private static function flag(?ContainerInterface $c, string $key, string $default): bool
    {
        return self::setting($c, $key, $default) === '1';
    }

    private static function store(?ContainerInterface $c): ?SettingsStore
    {
        return ($c !== null && $c->has(SettingsStore::class)) ? $c->get(SettingsStore::class) : null;
    }

    /** Env read with an explicit default — avoids the `?? getenv() ?: $d` precedence trap. */
    private static function env(string $key, string $default): string
    {
        $v = getenv($key);
        return $v === false ? $default : $v;
    }

    private static function chatToken(Request $req): string
    {
        $h = $req->getHeaderLine('X-Chat-Token');
        return $h !== '' ? trim($h) : trim((string) ($req->getQueryParams()['token'] ?? ''));
    }

    private static function frontendKey(string $raw): string
    {
        $v = strtolower(trim($raw));
        $v = (string) preg_replace('/[^a-z0-9_-]/', '', $v);
        return mb_substr($v, 0, 40);
    }

    private static function lang(mixed $v): string
    {
        return ((string) $v) === 'en' ? 'en' : 'de';
    }

    private static function boolish(mixed $v): bool
    {
        return $v === true || $v === 1 || $v === '1' || $v === 'true';
    }

    private static function slug(string $raw, string $fallbackTitle): string
    {
        $base = $raw !== '' ? $raw : $fallbackTitle;
        $s = strtolower(trim($base));
        $s = (string) preg_replace(['/[^a-z0-9]+/', '/^-+|-+$/'], ['-', ''], $s);
        return mb_substr($s !== '' ? $s : 'doc-' . substr(md5($base), 0, 6), 0, 160);
    }

    private static function optional(mixed $value, int $limit): ?string
    {
        $v = trim((string) ($value ?? ''));
        return $v === '' ? null : mb_substr($v, 0, $limit);
    }

    /**
     * A salted hash of the client IP for rate-limiting — never the raw IP.
     * Prefers a proxy-forwarded address (Plesk/nginx front the PHP app).
     */
    private static function clientIpHash(Request $req): ?string
    {
        $server = $req->getServerParams();
        $ip = '';
        $fwd = (string) ($server['HTTP_X_FORWARDED_FOR'] ?? '');
        if ($fwd !== '') {
            $ip = trim(explode(',', $fwd)[0]);
        }
        if ($ip === '') {
            $ip = (string) ($server['REMOTE_ADDR'] ?? '');
        }
        if ($ip === '') {
            return null;
        }
        $salt = (string) (getenv('LIVE_CHAT_RATE_SALT') ?: getenv('SETTINGS_ENCRYPTION_KEY') ?: 'tds-live-chat');
        return hash('sha256', $salt . '|' . $ip);
    }

    private static function require(UserContext $user, string $permission, Response $res): ?Response
    {
        if (!$user->isAuthenticated()) {
            return self::json($res, ['error' => 'Unauthorized'], 401);
        }
        if (!$user->has($permission)) {
            return self::json($res, ['error' => 'Forbidden'], 403);
        }
        return null;
    }

    private static function json(Response $res, mixed $data, int $status = 200): Response
    {
        $res->getBody()->write(json_encode($data, JSON_THROW_ON_ERROR));
        return $res->withStatus($status)->withHeader('Content-Type', 'application/json');
    }

    /**
     * Route documentation for the admin frontend's API reference. Kept in its
     * own file so the prose does not sit in the middle of the wiring.
     *
     * @return list<array<string, mixed>>
     */
    public function apiDocs(): array
    {
        return require __DIR__ . '/../docs/api.php';
    }
}
