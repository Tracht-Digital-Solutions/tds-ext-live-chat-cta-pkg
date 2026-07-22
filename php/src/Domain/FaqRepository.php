<?php
declare(strict_types=1);

namespace Tds\Ext\LiveChatCta\Domain;

use PDO;

/** FAQ data access — public read (published only) + admin CRUD. */
final class FaqRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Published FAQ for the widget, filtered by language.
     *
     * @return list<array<string,mixed>>
     */
    public function published(string $lang): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, category, question, answer FROM live_chat_faq
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
            'SELECT id, lang, category, question, answer, sort_order, is_published, created_at, updated_at
             FROM live_chat_faq ORDER BY lang ASC, sort_order ASC, id ASC'
        )->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM live_chat_faq WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function create(string $lang, ?string $category, string $question, string $answer, int $sortOrder, bool $published): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO live_chat_faq (lang, category, question, answer, sort_order, is_published)
             VALUES (:l, :c, :q, :a, :o, :p)'
        );
        $stmt->execute([
            ':l' => $lang, ':c' => $category, ':q' => $question,
            ':a' => $answer, ':o' => $sortOrder, ':p' => $published ? 1 : 0,
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    public function update(int $id, string $lang, ?string $category, string $question, string $answer, int $sortOrder, bool $published): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE live_chat_faq
             SET lang = :l, category = :c, question = :q, answer = :a,
                 sort_order = :o, is_published = :p, updated_at = NOW()
             WHERE id = :id'
        );
        $stmt->execute([
            ':l' => $lang, ':c' => $category, ':q' => $question, ':a' => $answer,
            ':o' => $sortOrder, ':p' => $published ? 1 : 0, ':id' => $id,
        ]);
        return $stmt->rowCount() > 0;
    }

    public function delete(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM live_chat_faq WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->rowCount() > 0;
    }
}
