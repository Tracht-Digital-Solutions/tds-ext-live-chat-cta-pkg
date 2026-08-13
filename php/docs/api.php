<?php
/**
 * API documentation for this module's routes — consumed through `ApiDocSource`
 * and rendered in the admin frontend's API reference (`GET /wiki.json`).
 *
 * `pattern` must match the Slim pattern in `register()` VERBATIM, inline regex
 * included: it is the join key for the route introspection.
 * `php/tests/LiveChatCtaApiDocsTest.php` fails the build if the documented set
 * and the registered set drift apart in either direction.
 */

declare(strict_types=1);

$sessionId = ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id der Chat-Sitzung.'];
$langQuery = ['in' => 'query', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprache; Vorgabe `de`.'];

$faqFields = [
    ['in' => 'body', 'name' => 'question', 'type' => 'string', 'required' => true, 'description' => 'Die Frage, auf 300 Zeichen gekürzt.'],
    ['in' => 'body', 'name' => 'answer', 'type' => 'string', 'required' => true, 'description' => 'Die Antwort als **Klartext** — Absätze durch Zeilenumbrüche, kein Markup.'],
    ['in' => 'body', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprache; Vorgabe `de`.'],
    ['in' => 'body', 'name' => 'category', 'type' => 'string', 'description' => 'Überschrift der Gruppe, auf 120 Zeichen gekürzt. Leer ⇒ NULL.'],
    ['in' => 'body', 'name' => 'sort_order', 'type' => 'int', 'description' => 'Position; Vorgabe 100.'],
    ['in' => 'body', 'name' => 'is_published', 'type' => 'bool', 'description' => 'Nur veröffentlichte Einträge erscheinen im Wiki und im Widget.'],
];

$docFields = [
    ['in' => 'body', 'name' => 'title', 'type' => 'string', 'required' => true, 'description' => 'Titel des Handbuchartikels.'],
    ['in' => 'body', 'name' => 'body_markdown', 'type' => 'markdown', 'description' => 'Der Artikeltext als Markdown.'],
    ['in' => 'body', 'name' => 'slug', 'type' => 'slug', 'description' => 'Wird aus dem Titel abgeleitet, wenn leer. Eindeutig je Sprache.'],
    ['in' => 'body', 'name' => 'lang', 'type' => 'de|en', 'description' => 'Sprache; Vorgabe `de`.'],
    ['in' => 'body', 'name' => 'sort_order', 'type' => 'int', 'description' => 'Position; Vorgabe 100.'],
    ['in' => 'body', 'name' => 'is_published', 'type' => 'bool', 'description' => 'Nur veröffentlichte Artikel erscheinen im Wiki und im Widget.'],
];

return [
    [
        'method' => 'GET',
        'pattern' => '/live-chat-cta/config',
        'tag' => 'Widget',
        'summary' => 'Die eine Anfrage, die das Chat-Widget beim Laden stellt',
        'description' => 'Aktivierung, Beschriftung, Farbe und — je nach freigeschalteten '
            . 'Tabs — die FAQ- und Handbuchinhalte, alles in einer Antwort. Die '
            . 'Schaltmatrix ist {Frontend} × {chat, faq, docs, contact}; ein '
            . 'abgeschalteter Tab liefert eine leere Liste statt Inhalte, die niemand '
            . 'sehen soll. Unauthentifiziert, weil die Blase auch auf den öffentlichen '
            . 'Seiten läuft.',
        'auth' => 'public',
        'params' => [
            ['in' => 'query', 'name' => 'frontend', 'type' => 'landingpage|blog|customer|admin|tools', 'description' => 'Wo die Blase läuft. Unbekannt ⇒ abgeschaltet.'],
            $langQuery,
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{enabled, cta: {label, greeting, accent}, tabs: {...}, faqs: [...], docs: [...]}`'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/live-chat-cta/chat',
        'tag' => 'Widget',
        'summary' => 'Chat-Sitzung eröffnen',
        'description' => 'Der Besucher ist anonym. Er bekommt ein Zufallstoken zurück, das '
            . 'sein einziger Nachweis für diese Sitzung ist — es gibt keine Anmeldung '
            . 'und keine Wiederherstellung. Eine mitgesendete erste Nachricht wird '
            . 'gleich angehängt und benachrichtigt den Agenten.',
        'auth' => 'public',
        'params' => [
            ['in' => 'body', 'name' => 'message', 'type' => 'string', 'description' => 'Erste Nachricht, auf 4.000 Zeichen gekürzt.'],
            ['in' => 'body', 'name' => 'name', 'type' => 'string', 'description' => 'Optional, auf 120 Zeichen gekürzt.'],
            ['in' => 'body', 'name' => 'email', 'type' => 'string', 'description' => 'Optional, auf 254 Zeichen gekürzt.'],
            ['in' => 'body', 'name' => 'frontend', 'type' => 'string', 'description' => 'Wo die Sitzung eröffnet wurde.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id, token}` — das Token muss der Client behalten.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/live-chat-cta/chat/{id:[0-9]+}/messages',
        'tag' => 'Widget',
        'summary' => 'Neue Nachrichten einer Sitzung abholen (Polling)',
        'description' => 'Gepollt, nicht gestreamt: der Produktionshost läuft unter PHP-FPM '
            . 'ohne langlebige Prozesse, SSE oder WebSockets sind dort keine Option. '
            . 'Der Cursor `since` ist die zuletzt gesehene Nachrichten-Id.',
        'auth' => 'token',
        'params' => [
            $sessionId,
            ['in' => 'query', 'name' => 'since', 'type' => 'int', 'description' => 'Zuletzt gesehene Nachrichten-Id; Vorgabe 0.'],
            ['in' => 'header', 'name' => 'X-Chat-Token', 'type' => 'string', 'required' => true, 'description' => 'Das Sitzungstoken aus dem Eröffnen.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{messages: [...], status: open|closed}`'],
            ['status' => 401, 'description' => 'Token passt nicht zur Sitzung.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/live-chat-cta/chat/{id:[0-9]+}/messages',
        'tag' => 'Widget',
        'summary' => 'Nachricht als Besucher senden',
        'auth' => 'token',
        'params' => [
            $sessionId,
            ['in' => 'body', 'name' => 'body', 'type' => 'string', 'required' => true, 'description' => 'Text, auf 4.000 Zeichen gekürzt.'],
            ['in' => 'header', 'name' => 'X-Chat-Token', 'type' => 'string', 'required' => true, 'description' => 'Das Sitzungstoken.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => 'Die angelegte Nachricht.'],
            ['status' => 401, 'description' => 'Token passt nicht zur Sitzung.'],
            ['status' => 422, 'description' => 'Leerer Text.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/live-chat-cta/contact',
        'tag' => 'Widget',
        'summary' => 'Kontaktformular der Blase absenden',
        'description' => 'Der Rückfallweg, wenn niemand im Chat ist. Rate-Limit: 5 '
            . 'Einsendungen je IP in 10 Minuten; die IP wird nur gesalzen gehasht '
            . 'gespeichert, nie im Klartext.',
        'auth' => 'public',
        'params' => [
            ['in' => 'body', 'name' => 'name', 'type' => 'string', 'required' => true, 'description' => 'Name des Absenders.'],
            ['in' => 'body', 'name' => 'email', 'type' => 'string', 'required' => true, 'description' => 'Gültige Adresse.'],
            ['in' => 'body', 'name' => 'message', 'type' => 'string', 'required' => true, 'description' => 'Nachricht, auf 10.000 Zeichen gekürzt.'],
            ['in' => 'body', 'name' => 'subject', 'type' => 'string', 'description' => 'Optional, auf 200 Zeichen gekürzt.'],
            ['in' => 'body', 'name' => 'frontend', 'type' => 'string', 'description' => 'Wo das Formular ausgefüllt wurde.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id}` der Anfrage.'],
            ['status' => 422, 'description' => 'Pflichtfeld fehlt oder E-Mail ist ungültig.'],
            ['status' => 429, 'description' => 'Rate-Limit überschritten.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/help/faqs',
        'tag' => 'Wiki (öffentlich)',
        'summary' => 'Veröffentlichte FAQs für das Kunden-Wiki',
        'description' => 'Dieselben Zeilen wie im Widget, aber **ohne** die '
            . 'Frontend-Tab-Schalter: das Wiki im Kundenportal darf nicht leer werden, '
            . 'weil jemand den FAQ-Tab der Chat-Blase auf einer Marketingseite '
            . 'ausgeschaltet hat. Unauthentifiziert wie `/live-chat-cta/config` — '
            . 'Hilfetexte sind nicht schützenswert, und die Wiki-Seite ist eine '
            . 'Basis-Seite: das Kundenprodukt komponiert die Frontend-Hälfte dieser '
            . 'Extension gar nicht. **Ein Datenbankproblem gibt eine leere Liste '
            . 'zurück, keinen 500** — ein leeres Wiki ist eine ruhige Seite, ein '
            . 'Fehler wäre ein kaputtes Portal.',
        'auth' => 'public',
        'params' => [$langQuery],
        'responses' => [
            ['status' => 200, 'description' => '`{faqs: [{id, category, question, answer}]}`, nach `sort_order` sortiert, höchstens 200.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/help/articles',
        'tag' => 'Wiki (öffentlich)',
        'summary' => 'Handbuchartikel auflisten (ohne Text)',
        'description' => 'Nur Titel und Slug. Der Text kommt erst beim Aufklappen über '
            . '`/help/articles/{slug}` — zweihundert Markdown-Texte auszuliefern, um '
            . 'eine Überschriftenliste zu zeichnen, ist der Unterschied zwischen einer '
            . 'Seite, die aufgeht, und einer, die hängt.',
        'auth' => 'public',
        'params' => [$langQuery],
        'responses' => [
            ['status' => 200, 'description' => '`{articles: [{id, slug, title, sort_order, updated_at}]}`'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/help/articles/{slug:[a-z0-9-]+}',
        'tag' => 'Wiki (öffentlich)',
        'summary' => 'Einen Handbuchartikel samt Text lesen',
        'description' => 'Nur veröffentlichte Artikel — der Slug ist erratbar, deshalb '
            . 'steht die Prüfung in der Abfrage und nicht beim Aufrufer.',
        'auth' => 'public',
        'params' => [
            ['in' => 'path', 'name' => 'slug', 'type' => 'slug', 'required' => true, 'description' => 'Slug des Artikels.'],
            $langQuery,
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{article: {id, slug, title, body_markdown, updated_at}}`'],
            ['status' => 404, 'description' => 'Kein veröffentlichter Artikel mit diesem Slug in dieser Sprache.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/live-chat-cta/summary',
        'tag' => 'Chat-Postfach',
        'summary' => 'Offene Chats und neue Kontaktanfragen',
        'description' => 'Die `dataEndpoint`-Route des Dashboard-Widgets.',
        'permission' => 'live-chat:read',
        'responses' => [
            ['status' => 200, 'description' => '`{openChats, newContacts}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `live-chat:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/admin/live-chat-cta/sessions',
        'tag' => 'Chat-Postfach',
        'summary' => 'Chat-Sitzungen auflisten',
        'permission' => 'live-chat:read',
        'responses' => [
            ['status' => 200, 'description' => '`{sessions: [...]}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `live-chat:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/admin/live-chat-cta/sessions/{id:[0-9]+}',
        'tag' => 'Chat-Postfach',
        'summary' => 'Eine Chat-Sitzung samt Verlauf lesen',
        'permission' => 'live-chat:read',
        'params' => [$sessionId],
        'responses' => [
            ['status' => 200, 'description' => 'Die Sitzung mit allen Nachrichten.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `live-chat:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/admin/live-chat-cta/sessions/{id:[0-9]+}/reply',
        'tag' => 'Chat-Postfach',
        'summary' => 'Als Agent in einer Sitzung antworten',
        'description' => 'Der Besucher sieht die Antwort beim nächsten Polling-Durchlauf — '
            . 'es gibt keinen Push.',
        'permission' => 'live-chat:write',
        'params' => [
            $sessionId,
            ['in' => 'body', 'name' => 'body', 'type' => 'string', 'required' => true, 'description' => 'Text der Antwort.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => 'Die angelegte Nachricht.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `live-chat:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
            ['status' => 422, 'description' => 'Leerer Text.'],
        ],
    ],
    [
        'method' => 'PATCH',
        'pattern' => '/admin/live-chat-cta/sessions/{id:[0-9]+}',
        'tag' => 'Chat-Postfach',
        'summary' => 'Sitzung schließen oder wieder öffnen',
        'permission' => 'live-chat:write',
        'params' => [
            $sessionId,
            ['in' => 'body', 'name' => 'status', 'type' => 'open|closed', 'required' => true, 'description' => 'Neuer Zustand.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `live-chat:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
            ['status' => 422, 'description' => '`status` ist nicht `open` oder `closed`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/admin/live-chat-cta/faqs',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'Alle FAQs beider Sprachen, auch unveröffentlichte',
        'description' => 'Die Redaktionssicht der Seite *Wiki-Inhalte*.',
        'permission' => 'wiki:read',
        'responses' => [
            ['status' => 200, 'description' => '`{faqs: [...]}`, nach Sprache und Position sortiert.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:read`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/admin/live-chat-cta/faqs',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'FAQ-Eintrag anlegen',
        'description' => 'Erscheint nach dem Veröffentlichen sofort im Kunden-Wiki und in '
            . 'der Chat-Blase — es gibt **eine** Quelle, keinen Abgleich zwischen zwei.',
        'permission' => 'wiki:write',
        'params' => $faqFields,
        'responses' => [
            ['status' => 201, 'description' => '`{id}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:write`.'],
            ['status' => 422, 'description' => '`question` oder `answer` fehlt.'],
        ],
    ],
    [
        'method' => 'PUT',
        'pattern' => '/admin/live-chat-cta/faqs/{id:[0-9]+}',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'FAQ-Eintrag ändern',
        'description' => 'Vollständiges Überschreiben — nicht gesendete Felder werden auf '
            . 'ihre Vorgabe zurückgesetzt, nicht beibehalten.',
        'permission' => 'wiki:write',
        'params' => array_merge(
            [['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Eintrags.']],
            $faqFields,
        ),
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
            ['status' => 422, 'description' => '`question` oder `answer` fehlt.'],
        ],
    ],
    [
        'method' => 'DELETE',
        'pattern' => '/admin/live-chat-cta/faqs/{id:[0-9]+}',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'FAQ-Eintrag löschen',
        'permission' => 'wiki:write',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Eintrags.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/admin/live-chat-cta/docs',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'Alle Handbuchartikel beider Sprachen, auch unveröffentlichte',
        'permission' => 'wiki:read',
        'responses' => [
            ['status' => 200, 'description' => '`{docs: [...]}`, nach Sprache und Position sortiert.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:read`.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/admin/live-chat-cta/docs',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'Handbuchartikel anlegen',
        'description' => 'Ohne `slug` wird einer aus dem Titel abgeleitet (kleingeschrieben, '
            . 'alles außer Buchstaben und Ziffern zu `-`). Der Slug ist je Sprache '
            . 'eindeutig und steht in der Wiki-Sprungmarke.',
        'permission' => 'wiki:write',
        'params' => $docFields,
        'responses' => [
            ['status' => 201, 'description' => '`{id}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:write`.'],
            ['status' => 422, 'description' => '`title` fehlt.'],
        ],
    ],
    [
        'method' => 'PUT',
        'pattern' => '/admin/live-chat-cta/docs/{id:[0-9]+}',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'Handbuchartikel ändern',
        'description' => 'Vollständiges Überschreiben. **Eine Slug-Änderung bricht '
            . 'bestehende Links** auf den Artikel (`/wiki#artikel-<slug>`).',
        'permission' => 'wiki:write',
        'params' => array_merge(
            [['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Artikels.']],
            $docFields,
        ),
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
            ['status' => 422, 'description' => '`title` fehlt.'],
        ],
    ],
    [
        'method' => 'DELETE',
        'pattern' => '/admin/live-chat-cta/docs/{id:[0-9]+}',
        'tag' => 'Wiki-Inhalte',
        'summary' => 'Handbuchartikel löschen',
        'permission' => 'wiki:write',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id des Artikels.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `wiki:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
        ],
    ],
];
