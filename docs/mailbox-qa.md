# Mailbox regression checks

## Local setup

Use a disposable local account and local mail fixtures. Never repoint production
webhooks or send to real recipients for these checks.

```sh
bun install
bun run db:migrate:local
QUICKMAIL_LOCAL_BINDINGS=1 bun run dev
```

Apply all pending migrations to the deployment database before deploying these
changes: `0019_attachment_content_ids.sql`, `0020_mailbox_folders.sql`,
`0021_mail_labels.sql`, and `0022_sender_names.sql`. Use `bun run db:migrate:remote` with Cloudflare
authentication and network access available. Local migration success does not
establish that these were applied remotely.

## Automated checks

```sh
bun run test
QUICKMAIL_LOCAL_BINDINGS=1 bun run check
QUICKMAIL_LOCAL_BINDINGS=1 bun run build
```

The tests cover HTML policies, readable snippets, Unicode entities, MIME
classification, byte ranges, attachment validation, provider content IDs,
server-rendered compose content, text links, failed HTTP responses, UTC date
formatting, and folder/label behavior against SQLite using the real migrations.
Folder and label tests cover account isolation, search bindings, and preservation
of archived mail, sent mail, and new replies to labeled conversations.

## Browser checks

Use a desktop viewport and a 390 × 844 mobile viewport; repeat the reader in both
themes. Intercept send requests or use a test provider to avoid real delivery.

| Area | Check |
| --- | --- |
| Embedded images | Receive a message with an image referenced by `cid:`. It loads without opting into remote images. |
| Remote images | Remote image requests remain blocked until explicitly loaded; loading them keeps scripts and embedded frames disabled. |
| HTML isolation | Script, event handler, iframe, refresh, form, and JavaScript-link markup cannot execute or navigate the mailbox. |
| Designed email | A newsletter with a long stylesheet has a useful list snippet and readable content in dark mode. |
| Attachment viewer | Open image, PDF, audio, video, and text files; browse files, zoom images/PDFs, change PDF pages, download, and close with Escape. |
| Preview failures | Missing/corrupt files show an error and retain the download control. Source code is displayed literally. |
| Drafts | Write text and attach files, wait for autosave, reload the draft, remove a file, and reload again. Contents and files persist. |
| Save failure | Reject a draft save. The composer shows an error, retains the content, and stays open; retry saves successfully. |
| Forwarding | Forward attached files and embedded images. The composer previews the image; outgoing HTML uses `cid:` and provider payloads retain the matching content ID. |
| Compose navigation | Navigate between two drafts and a fresh composer without reloading the page. Each displays its own content. |
| Paste/drop | Paste formatted text and clipboard images; drop files into the editor/attachment area. Markup is sanitized and reading files disables Send. |
| Plain text | Switch between formatted and plain text. Links work, line breaks remain, and quoted history can be expanded. |
| Selection | Select a conversation with `x`, move focus with `j`/`k`, and check selection is retained. Native modified shortcuts and button activation still work. |
| Visible controls | Desktop checkboxes and stars are available without a menu. Shift-click selects a range; Escape clears selection. Row actions are available on hover and keyboard focus. |
| Archive | Archive a selected conversation or use `e`; it leaves Inbox and remains in All mail, Sent and Starred as applicable. Undo returns it. Repeat from the reader. `#` moves mail to Trash. |
| Spam | Move a conversation to Spam. Ordinary mailboxes exclude it. Use Not spam or Move to inbox to recover it. Search can explicitly include Spam/Trash with `in:spam`, `in:trash` or `in:anywhere`. |
| Search | Search globally from the topbar or mobile search, and through the native search-options dialog. Combine `from:`, `to:`, `subject:`, `is:unread`, `has:attachment`, `filename:`, `label:`, `after:` and `before:`. Quoted phrases and negations work. Escape closes the dialog and restores focus. |
| Labels | Create a label in the sidebar, select conversations and apply it. Verify the sidebar filter, row badges, search and reader state. Remove it from a conversation and delete it from the manager; deleting labels preserves messages. Duplicate names show an error; failed apply retains changes for retry. |
| Sender names | Receive messages with named From headers via both providers. Mailbox rows use the decoded sender name and retain the address when no name exists. Older messages whose names were discarded keep their address fallback. |
| Text previews | HTML styles, scripts, tags, comments and image placeholders stay out of snippets, including mail with CSS in its plain-text alternative. Ordinary text, placeholders and URLs remain readable. |
| Density | Switch between comfortable/compact list spacing. Reload and verify persistence; Appearance settings use the same preference. Card view remains available. |
| Pagination | With more than 25 conversations, navigate forward/back on desktop and mobile. Preserve search and label filters across pages. |
| Action failure | Reject bulk/flag/pin/trash requests. An error appears, selection/flags remain correct, and the reader does not navigate away. |
| Empty trash | Hold with a pointer or Enter/Space. The control shows progress while awaiting the server, reports success only after completion, and remains retryable when the request fails. |
| Navigation | Open mail from a searched/filtered inbox and use Back. The same mailbox, filters, and page are restored. |
| Replies | Type a reply, attach a file, and use Ctrl/Cmd+Enter while the editor is focused. Failed delivery retains text and files. |
| Mobile | Sidebar stays outside the reading area, content has no page overflow, and attachment actions remain usable. |

The inbox redesign was checked in Chromium at widths of 1440, 1024, 900, 390 and
320 pixels, with light/dark themes, a full 35-conversation test inbox, and the
mobile reader and composer. Native dialogs keep keyboard focus inside them;
Escape closes label dialogs without clearing the underlying mailbox selection.

Local browser checks validate rendering, storage, and intercepted delivery
payloads. They do not verify live provider delivery, DNS, or production webhooks.
