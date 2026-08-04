<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Live-Chat-CTA — a message inside a chat session (visitor or agent). FK to the
 * same-DB session table (unsigned to match the PK), CASCADE on session delete.
 * `LiveChatCta*` class prefix, `20260801*` band.
 */
final class LiveChatCtaCreateMessage extends AbstractMigration
{
    public function change(): void
    {
        $this->table('live_chat_message', ['id' => true, 'engine' => 'InnoDB', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('session_id', 'integer', ['signed' => false])
            ->addColumn('author', 'enum', ['values' => ['visitor', 'agent']])
            ->addColumn('body', 'text')
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addIndex(['session_id', 'id'], ['name' => 'idx_message_session'])
            ->addForeignKey('session_id', 'live_chat_session', 'id', ['delete' => 'CASCADE'])
            ->create();
    }
}
