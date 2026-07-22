<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Live-Chat-CTA — FAQ entries shown in the widget's FAQ tab.
 *
 * Class name is module-prefixed (`LiveChatCta*`) and the file's numeric version
 * lives in this extension's own `20260801*` band: the base API's in-process
 * auto-migrator includes every module's migrations into ONE PHP process with one
 * shared phinxlog, so a reused class name is a fatal redeclaration and a reused
 * version collides. MySQL-8-safe: unsigned PK, utf8mb4.
 */
final class LiveChatCtaCreateFaq extends AbstractMigration
{
    public function change(): void
    {
        $this->table('live_chat_faq', ['id' => true, 'engine' => 'InnoDB', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('lang', 'enum', ['values' => ['de', 'en'], 'default' => 'de'])
            ->addColumn('category', 'string', ['limit' => 120, 'null' => true])
            ->addColumn('question', 'string', ['limit' => 300])
            ->addColumn('answer', 'text')
            ->addColumn('sort_order', 'integer', ['default' => 100])
            ->addColumn('is_published', 'boolean', ['default' => true])
            ->addColumn('created_at', 'datetime', ['default' => 'CURRENT_TIMESTAMP'])
            ->addColumn('updated_at', 'datetime', ['null' => true])
            ->addIndex(['lang', 'is_published', 'sort_order'], ['name' => 'idx_faq_published'])
            ->create();
    }
}
