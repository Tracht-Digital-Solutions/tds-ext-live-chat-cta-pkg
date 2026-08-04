<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Live-Chat-CTA — a public contact-form submission from the widget's Kontakt tab.
 * Rate-limited by a salted `ip_hash` (never the raw IP). `LiveChatCta*` class
 * prefix, `20260801*` band.
 */
final class LiveChatCtaCreateContact extends AbstractMigration
{
    public function change(): void
    {
        $this->table('live_chat_contact', ['id' => true, 'engine' => 'InnoDB', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('name', 'string', ['limit' => 200])
            ->addColumn('email', 'string', ['limit' => 254])
            ->addColumn('subject', 'string', ['limit' => 200, 'null' => true])
            ->addColumn('message', 'text')
            ->addColumn('frontend', 'string', ['limit' => 40, 'null' => true])
            ->addColumn('status', 'enum', ['values' => ['new', 'handled', 'spam'], 'default' => 'new'])
            ->addColumn('ip_hash', 'string', ['limit' => 64, 'null' => true])
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addColumn('handled_at', 'datetime', ['null' => true])
            ->addIndex(['status', 'created_at'], ['name' => 'idx_contact_status'])
            ->create();
    }
}
