<?php
declare(strict_types=1);

namespace Tds\Ext\LiveChatCta\Domain;

use PDO;

/** Public contact-form inbox data access (widget's Kontakt tab). */
final class ContactRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function newCount(): int
    {
        return (int) $this->pdo->query("SELECT COUNT(*) FROM live_chat_contact WHERE status = 'new'")->fetchColumn();
    }

    /** @return list<array<string,mixed>> */
    public function list(?string $status): array
    {
        $sql = 'SELECT id, name, email, subject, frontend, status, created_at FROM live_chat_contact';
        $params = [];
        if ($status !== null) {
            $sql .= ' WHERE status = :s';
            $params[':s'] = $status;
        }
        $sql .= ' ORDER BY created_at DESC LIMIT 200';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM live_chat_contact WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** Submissions from one IP hash within the trailing window (rate-limit probe). */
    public function recentFromIp(string $ipHash, int $windowSeconds): int
    {
        // Cutoff computed in PHP — `INTERVAL ? SECOND` with a placeholder is
        // driver-fragile; a plain datetime comparison is portable.
        $cutoff = date('Y-m-d H:i:s', time() - $windowSeconds);
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) FROM live_chat_contact WHERE ip_hash = :h AND created_at >= :cut'
        );
        $stmt->execute([':h' => $ipHash, ':cut' => $cutoff]);
        return (int) $stmt->fetchColumn();
    }

    public function create(string $name, string $email, ?string $subject, string $message, ?string $frontend, ?string $ipHash): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO live_chat_contact (name, email, subject, message, frontend, ip_hash)
             VALUES (:n, :e, :s, :m, :f, :ip)'
        );
        $stmt->execute([
            ':n' => $name, ':e' => $email, ':s' => $subject,
            ':m' => $message, ':f' => $frontend, ':ip' => $ipHash,
        ]);
        return (int) $this->pdo->lastInsertId();
    }

    public function setStatus(int $id, string $status): void
    {
        $handled = $status === 'new' ? null : date('Y-m-d H:i:s');
        $stmt = $this->pdo->prepare('UPDATE live_chat_contact SET status = :s, handled_at = :h WHERE id = :id');
        $stmt->execute([':s' => $status, ':h' => $handled, ':id' => $id]);
    }
}
