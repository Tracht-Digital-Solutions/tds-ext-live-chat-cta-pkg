<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

/**
 * Live-Chat-CTA — seed the central-login FAQ (DE + EN).
 *
 * Why a seed and not just docs: the central login page no longer advertises that
 * one login covers Verwaltung, Kundenportal and Tools (that copy was removed from
 * `tds-auth-frontend`), so the answer has to be reachable where a user actually
 * asks it — the widget's FAQ tab. The counterpart for logged-in staff is the
 * frontend host's `/wiki` FAQ (`tds-core-frontend-pkg`, `content/faq.ts`); keep
 * the two in rough sync when the login behaviour changes.
 *
 * The rows are ordinary content afterwards: editable and deletable under
 * `/live-chat`. That is why the seed is **idempotent by question** (skips a row
 * an operator already created or re-worded) and why `down()` only removes rows
 * that still carry the seeded question verbatim — a rollback must not delete an
 * edited answer.
 *
 * Answers are plain text: the widget's `Prose` renderer splits on blank lines and
 * newlines and renders text nodes, so there is no markup to escape.
 *
 * Class name is module-prefixed (`LiveChatCta*`) and the numeric version stays in
 * this extension's `20260801*` band — one shared phinxlog across all composed
 * extensions, so a reused class fatals and a reused version collides.
 */
final class LiveChatCtaSeedFaqLogin extends AbstractMigration
{
    /** @var list<array{lang:string,category:string,question:string,answer:string,sort:int}> */
    private const ENTRIES = [
        [
            'lang' => 'de',
            'category' => 'Konto & Anmeldung',
            'question' => 'Gilt meine Anmeldung auch in den anderen Bereichen?',
            'answer' => "Ja. Die Anmeldung läuft zentral über auth.tracht-digital.de und gilt anschließend für alle Bereiche, für die Ihr Konto freigeschaltet ist — Verwaltung, Kundenportal und die Tools-Seite. Ein zweites Login je Bereich ist nicht nötig.\n\nDahinter liegt eine gemeinsame Sitzung für alle Adressen unter tracht-digital.de; es werden keine Zugangsdaten zwischen den Bereichen übertragen. Welche Bereiche Ihnen offenstehen, hängt weiterhin an Ihren Berechtigungen: Die Sitzung öffnet keinen Bereich, für den Ihr Konto keine Freigabe hat.",
            'sort' => 10,
        ],
        [
            'lang' => 'de',
            'category' => 'Konto & Anmeldung',
            'question' => 'Was passiert beim Abmelden?',
            'answer' => "Das Abmelden beendet die gemeinsame Sitzung und wirkt in allen Bereichen gleichzeitig — Sie sind anschließend überall abgemeldet, nicht nur dort, wo Sie den Abmelden-Knopf gedrückt haben.\n\nDasselbe gilt automatisch, wenn die Sitzung abläuft oder das Passwort geändert wird: Der nächste Aufruf führt zurück zur zentralen Anmeldung.",
            'sort' => 11,
        ],
        [
            'lang' => 'de',
            'category' => 'Konto & Anmeldung',
            'question' => 'Wie ändere ich mein Passwort?',
            'answer' => "Das Passwort wird ebenfalls zentral geändert, unter auth.tracht-digital.de/passwort (mindestens 12 Zeichen). Nach der Änderung werden alle bestehenden Sitzungen beendet — Sie melden sich einmal neu an und sind danach wieder in allen Bereichen angemeldet.",
            'sort' => 12,
        ],
        [
            'lang' => 'en',
            'category' => 'Account & sign-in',
            'question' => 'Does my sign-in also apply to the other areas?',
            'answer' => "Yes. Sign-in is handled centrally at auth.tracht-digital.de and then applies to every area your account is enabled for — management, customer portal and the tools site. There is no second login per area.\n\nBehind it is one shared session across all tracht-digital.de addresses; no credentials are passed between the areas. Which areas you can open still depends on your permissions: the session never unlocks an area your account is not cleared for.",
            'sort' => 10,
        ],
        [
            'lang' => 'en',
            'category' => 'Account & sign-in',
            'question' => 'What happens when I sign out?',
            'answer' => "Signing out ends the shared session and takes effect everywhere at once — you are signed out of every area, not just the one where you clicked the button.\n\nThe same happens automatically when the session expires or the password changes: the next request goes back to the central sign-in.",
            'sort' => 11,
        ],
        [
            'lang' => 'en',
            'category' => 'Account & sign-in',
            'question' => 'How do I change my password?',
            'answer' => "The password is changed centrally too, at auth.tracht-digital.de/passwort (at least 12 characters). All existing sessions end afterwards — sign in once more and you are signed in across every area again.",
            'sort' => 12,
        ],
    ];

    public function up(): void
    {
        $exists = $this->getAdapter()->getConnection()->prepare(
            'SELECT id FROM live_chat_faq WHERE lang = :l AND question = :q LIMIT 1'
        );
        $insert = $this->getAdapter()->getConnection()->prepare(
            'INSERT INTO live_chat_faq (lang, category, question, answer, sort_order, is_published)
             VALUES (:l, :c, :q, :a, :o, 1)'
        );

        foreach (self::ENTRIES as $entry) {
            $exists->execute([':l' => $entry['lang'], ':q' => $entry['question']]);
            if ($exists->fetch() !== false) {
                continue;
            }
            $insert->execute([
                ':l' => $entry['lang'],
                ':c' => $entry['category'],
                ':q' => $entry['question'],
                ':a' => $entry['answer'],
                ':o' => $entry['sort'],
            ]);
        }
    }

    public function down(): void
    {
        $delete = $this->getAdapter()->getConnection()->prepare(
            'DELETE FROM live_chat_faq WHERE lang = :l AND question = :q AND answer = :a'
        );
        foreach (self::ENTRIES as $entry) {
            $delete->execute([
                ':l' => $entry['lang'],
                ':q' => $entry['question'],
                ':a' => $entry['answer'],
            ]);
        }
    }
}
