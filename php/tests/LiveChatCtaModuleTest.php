<?php
declare(strict_types=1);

namespace Tds\Ext\LiveChatCta\Tests;

use Closure;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ServerRequestFactory;
use Tds\Ext\LiveChatCta\LiveChatCtaModule;
use Tds\Frontend\Contract\ModuleRegistry;
use Tds\Frontend\Contract\UserContext;

/**
 * Composes the module through a real ModuleRegistry + Slim app (with a tiny
 * container binding an anonymous UserContext) and dispatches routes:
 *   - the public config endpoint is reachable unauthenticated (200);
 *   - an admin route rejects an anonymous request (401).
 */
final class LiveChatCtaModuleTest extends TestCase
{
    private function app(): \Slim\App
    {
        $app = AppFactory::create(null, self::container());
        $app->addRoutingMiddleware();
        (new ModuleRegistry([new LiveChatCtaModule()]))->registerAll($app);
        return $app;
    }

    public function testConfigRouteIsPublic(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/live-chat-cta/config')
            ->withQueryParams(['frontend' => 'landingpage', 'lang' => 'de']);
        $response = $this->app()->handle($request);

        self::assertSame(200, $response->getStatusCode());
        self::assertStringContainsString('enabled', (string) $response->getBody());
    }

    public function testAdminRouteRejectsAnonymous(): void
    {
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/admin/live-chat-cta/faqs');
        $response = $this->app()->handle($request);

        self::assertSame(401, $response->getStatusCode());
    }

    public function testDeclaresPermissions(): void
    {
        $ids = array_map(static fn ($p): string => $p->id, (new LiveChatCtaModule())->permissions());
        self::assertContains('live-chat:read', $ids);
        self::assertContains('live-chat:write', $ids);
    }

    /** A minimal PSR-11 container that also supports `set()` (as php-di does in prod). */
    private static function container(): ContainerInterface
    {
        return new class implements ContainerInterface {
            /** @var array<string,mixed> */
            private array $items = [];

            public function __construct()
            {
                $this->items[UserContext::class] = self::anonymousUser();
            }

            public function set(string $id, mixed $value): void
            {
                $this->items[$id] = $value;
            }

            public function get(string $id): mixed
            {
                $v = $this->items[$id] ?? null;
                if ($v instanceof Closure) {
                    $v = $v($this);
                    $this->items[$id] = $v;
                }
                return $v;
            }

            public function has(string $id): bool
            {
                return array_key_exists($id, $this->items);
            }

            private static function anonymousUser(): UserContext
            {
                return new class implements UserContext {
                    public function isAuthenticated(): bool
                    {
                        return false;
                    }

                    public function userId(): ?int
                    {
                        return null;
                    }

                    public function email(): ?string
                    {
                        return null;
                    }

                    public function isAdmin(): bool
                    {
                        return false;
                    }

                    /** @return string[] */
                    public function permissions(): array
                    {
                        return [];
                    }

                    public function has(string $permission): bool
                    {
                        return false;
                    }

                    public function activeCompanyId(): ?int
                    {
                        return null;
                    }
                };
            }
        };
    }
}
