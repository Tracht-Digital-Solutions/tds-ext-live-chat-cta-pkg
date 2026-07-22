<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Live-Chat-CTA — documentation articles (markdown) shown in the widget's
 * Dokumentation tab. `LiveChatCta*` class prefix, `20260801*` version band.
 */
final class LiveChatCtaCreateDoc extends AbstractMigration
{
    public function change(): void
    {
        $this->table('live_chat_doc', ['id' => true, 'engine' => 'InnoDB', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('lang', 'enum', ['values' => ['de', 'en'], 'default' => 'de'])
            ->addColumn('slug', 'string', ['limit' => 160])
            ->addColumn('title', 'string', ['limit' => 200])
            ->addColumn('body_markdown', 'text')
            ->addColumn('sort_order', 'integer', ['default' => 100])
            ->addColumn('is_published', 'boolean', ['default' => true])
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addColumn('updated_at', 'datetime', ['null' => true])
            ->addIndex(['lang', 'slug'], ['unique' => true, 'name' => 'uq_doc_lang_slug'])
            ->addIndex(['lang', 'is_published', 'sort_order'], ['name' => 'idx_doc_published'])
            ->create();
    }
}
