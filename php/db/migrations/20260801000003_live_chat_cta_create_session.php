<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Live-Chat-CTA — a visitor chat session. Anonymous visitors are identified by a
 * random `public_token` (held client-side) — no login required. Agents answer
 * from the admin `/live-chat` inbox. `LiveChatCta*` class prefix, `20260801*` band.
 */
final class LiveChatCtaCreateSession extends AbstractMigration
{
    public function change(): void
    {
        $this->table('live_chat_session', ['id' => true, 'engine' => 'InnoDB', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('public_token', 'string', ['limit' => 64])
            ->addColumn('visitor_name', 'string', ['limit' => 120, 'null' => true])
            ->addColumn('visitor_email', 'string', ['limit' => 254, 'null' => true])
            ->addColumn('frontend', 'string', ['limit' => 40, 'null' => true])
            ->addColumn('status', 'enum', ['values' => ['open', 'closed'], 'default' => 'open'])
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addColumn('last_activity_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addIndex(['public_token'], ['unique' => true, 'name' => 'uq_session_token'])
            ->addIndex(['status', 'last_activity_at'], ['name' => 'idx_session_status'])
            ->create();
    }
}
