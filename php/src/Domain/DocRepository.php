<?php
declare(strict_types=1);

namespace Tds\Ext\LiveChatCta\Domain;

use PDO;

/** Documentation-article data access — public read (published only) + admin CRUD. */
final class DocRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Published docs for the widget, filtered by language (body included — the
     * widget renders the article inline).
     *
     * @return list<array<string,mixed>>
     */
    public function published(string $lang): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, slug, title, body_markdown FROM live_chat_doc
             WHERE lang = :l AND is_published = 1
             ORDER BY sort_order ASC, id ASC LIMIT 200'
        );
        $stmt->execute([':l' => $lang]);
        return $stmt->fetchAll();
    }

    /** @return list<array<string,mixed>> */
    public function all(): array
    {
        return $this->pdo->query(
            'SELECT id, lang, slug, title, body_markdown, sort_order, is_published, created_at, updated_at
             FROM live_chat_doc ORDER BY lang ASC, sort_order ASC, id ASC'
        )->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM live_chat_doc WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function create(string $lang, string $slug, string $title, string $body, int $sortOrder, bool $published): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO live_chat_doc (lang, slug, title, body_markdown, sort_order, is_published)
             VALUES (:l, :s, :t, :b, :o, :p)'
        );
        $stmt->execute([
            ':l' => $lang, ':s' => $slug, ':t' => $title,
            ':b' => $body, ':o' => $sortOrder, ':p' => $published ? 1 : 0,
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    public function update(int $id, string $lang, string $slug, string $title, string $body, int $sortOrder, bool $published): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE live_chat_doc
             SET lang = :l, slug = :s, title = :t, body_markdown = :b,
                 sort_order = :o, is_published = :p, updated_at = NOW()
             WHERE id = :id'
        );
        $stmt->execute([
            ':l' => $lang, ':s' => $slug, ':t' => $title, ':b' => $body,
            ':o' => $sortOrder, ':p' => $published ? 1 : 0, ':id' => $id,
        ]);
        return $stmt->rowCount() > 0;
    }

    public function delete(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM live_chat_doc WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->rowCount() > 0;
    }
}
