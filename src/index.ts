import { defineExtension } from "@tracht-digital-solutions/tds-frontend-contract";

/**
 * Live-Chat-CTA extension manifest.
 *
 * Owns the ADMIN management surface (the `/live-chat` route: chat inbox + FAQ +
 * documentation editors, a dashboard widget, and the per-frontend/per-feature
 * settings section). The visitor-facing floating bubble is NOT here — it ships
 * as the `LiveChatCta` island in tds-shared-pkg (there is no "global overlay"
 * slot in the contract, and the public sites + panel host already depend on
 * tds-shared), and it talks to this extension's public API.
 */
export default defineExtension({
  id: "live-chat-cta",
  name: "Live-Chat",
  version: "0.1.0",
  permissions: [
    { id: "live-chat:read", label: "Live-Chat ansehen", group: "live-chat-cta" },
    { id: "live-chat:write", label: "Live-Chat bearbeiten", group: "live-chat-cta" },
    // Must mirror the PHP Module's permissions() exactly. Separate from
    // live-chat:* because these rows are the customer portal's Wiki — editing
    // them is content publishing, not support work.
    { id: "wiki:read", label: "Wiki-Inhalte ansehen", group: "live-chat-cta" },
    { id: "wiki:write", label: "Wiki-Inhalte bearbeiten", group: "live-chat-cta" },
  ],
  nav: [
    {
      id: "live-chat",
      label: "Live-Chat",
      href: "/live-chat",
      icon: "message-circle",
      group: "support",
      order: 15,
      permission: "live-chat:read",
    },
    {
      id: "wiki-content",
      label: "Wiki-Inhalte",
      href: "/wiki-inhalte",
      icon: "book-open",
      group: "support",
      order: 16,
      permission: "wiki:read",
    },
  ],
  widgets: [
    {
      id: "live-chat-open",
      title: "Offene Chats",
      island: "@tracht-digital-solutions/tds-ext-live-chat-cta/widgets/Widget.astro",
      size: "sm",
      permission: "live-chat:read",
      dataEndpoint: "/live-chat-cta/summary",
      order: 15,
    },
  ],
  settings: [
    {
      id: "live-chat-cta",
      label: "Live-Chat",
      island: "@tracht-digital-solutions/tds-ext-live-chat-cta/islands/Settings.astro",
      order: 40,
    },
  ],
  routes: [
    {
      pattern: "/live-chat",
      entrypoint: "@tracht-digital-solutions/tds-ext-live-chat-cta/pages/Index.astro",
      permission: "live-chat:read",
    },
    {
      pattern: "/wiki-inhalte",
      entrypoint: "@tracht-digital-solutions/tds-ext-live-chat-cta/pages/WikiContent.astro",
      permission: "wiki:read",
    },
  ],
  i18n: {
    de: {
      "live-chat.title": "Live-Chat",
      "live-chat.chats": "Chats",
      "live-chat.faq": "FAQ",
      "live-chat.docs": "Handbücher",
      "wiki-content.title": "Wiki-Inhalte",
    },
    en: {
      "live-chat.title": "Live chat",
      "live-chat.chats": "Chats",
      "live-chat.faq": "FAQ",
      "live-chat.docs": "Handbooks",
      "wiki-content.title": "Wiki content",
    },
  },
});
