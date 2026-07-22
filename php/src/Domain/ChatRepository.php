<?php
declare(strict_types=1);

namespace Tds\Ext\LiveChatCta\Domain;

use PDO;

/**
 * Chat data access. A visitor session is keyed by a random `public_token` the
 * visitor holds client-side (no login); agents answer from the admin inbox.
 * Polling reads use {@see messagesSince()} with a monotonic `id` cursor.
 */
final class ChatRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function createSession(string $token, ?string $name, ?string $email, ?string $frontend): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO live_chat_session (public_token, visitor_name, visitor_email, frontend)
             VALUES (:t, :n, :e, :f)'
        );
        $stmt->execute([':t' => $token, ':n' => $name, ':e' => $email, ':f' => $frontend]);
        return (int) $this->pdo->lastInsertId();
    }

    /** @return array<string,mixed>|null */
    public function findSession(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM live_chat_session WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** Verify a visitor owns the session (constant-time token compare). */
    public function sessionOwnedBy(int $id, string $token): bool
    {
        $row = $this->findSession($id);
        return $row !== null && hash_equals((string) $row['public_token'], $token);
    }

    public function addMessage(int $sessionId, string $author, string $body): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO live_chat_message (session_id, author, body) VALUES (:s, :a, :b)'
        );
        $stmt->execute([':s' => $sessionId, ':a' => $author, ':b' => $body]);
        $this->touch($sessionId);
        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Messages in a session after the given id cursor (0 = from the start).
     *
     * @return list<array<string,mixed>>
     */
    public function messagesSince(int $sessionId, int $sinceId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, author, body, created_at FROM live_chat_message
             WHERE session_id = :s AND id > :since ORDER BY id ASC LIMIT 500'
        );
        $stmt->execute([':s' => $sessionId, ':since' => $sinceId]);
        return $stmt->fetchAll();
    }

    public function touch(int $sessionId): void
    {
        $stmt = $this->pdo->prepare('UPDATE live_chat_session SET last_activity_at = NOW() WHERE id = :id');
        $stmt->execute([':id' => $sessionId]);
    }

    public function setStatus(int $sessionId, string $status): void
    {
        $stmt = $this->pdo->prepare('UPDATE live_chat_session SET status = :st WHERE id = :id');
        $stmt->execute([':st' => $status, ':id' => $sessionId]);
    }

    /** Admin inbox list with a per-session message count + last message preview. */
    public function listSessions(?string $status): array
    {
        $sql = "SELECT s.id, s.visitor_name, s.visitor_email, s.frontend, s.status,
                       s.created_at, s.last_activity_at,
                       (SELECT COUNT(*) FROM live_chat_message m WHERE m.session_id = s.id) AS message_count
                FROM live_chat_session s";
        $params = [];
        if ($status !== null) {
            $sql .= ' WHERE s.status = :st';
            $params[':st'] = $status;
        }
        $sql .= ' ORDER BY s.last_activity_at DESC LIMIT 200';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function openCount(): int
    {
        return (int) $this->pdo->query("SELECT COUNT(*) FROM live_chat_session WHERE status = 'open'")->fetchColumn();
    }
}
