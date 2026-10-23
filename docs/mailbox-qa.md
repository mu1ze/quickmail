# Mailbox regression checks

Incoming SubQ analysis requires migration `0023_mail_analysis.sql` before
deploying this revision. See [the analysis guide](subq-analysis.md) for queue
provisioning, secret configuration, account opt-in, and the synthetic evaluator.

One-time code cleanup requires `0030_verification_code_cleanup.sql` before
deployment and the updated one-minute Worker cron. Keep this opt-in setting off
until checking the behavior with disposable local mail. The five-minute deadline
starts at arrival, including unread messages; the next scheduled pass moves it
to recoverable Trash. Existing messages are not backfilled.

Analysis QA: check Primary/Updates and specific category filters, Review and
reply/deadline filters, pagination totals, category corrections, warning
dismissal, task completion, and opt-out during in-flight analysis. A newer
inbound message must supersede an old reply suggestion; same-second arrivals
use insertion order. Warnings from earlier messages must remain visible until
dismissed. Verify these flows at desktop, 390px, and 320px widths. Analysis
alone must not move messages or mark them read.

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
`0021_mail_labels.sql`, `0022_sender_names.sql`, and `0023_mail_analysis.sql`. Use `bun run db:migrate:remote` with Cloudflare
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
| Sender names | Receive messages with named From headers via both providers. Mailbox rows and reader headers use the decoded sender name. Older messages reuse known names only from the same account; otherwise they use a readable local-part/domain label. The row tooltip and reader header retain the full address. |
| Reader repaint | Open HTML mail with remote content blocked, opt in, and hold the image response open. Text must remain visible before images finish, without highlighting or zooming. Repeat with remote loading already enabled, theme changes, cached images, and browser back/forward navigation. |
| Categories | Use the category strip, specific-category menu and attention filter. Combine categories with Unread, Starred, Attachments and search; Reset clears filters. Check the horizontally scrollable category strip and labeled filters at 320px. |
| Sidebar | Collapse and expand at both tall and short desktop heights. The scrollbar is hidden, Compose keeps its height, and all navigation remains reachable by scrolling and keyboard. |
| Text previews | HTML styles, scripts, tags, comments and image placeholders stay out of snippets, including mail with CSS in its plain-text alternative. Ordinary text, placeholders and URLs remain readable. |
| Row options | Right-click a conversation, use Shift+F10 on its link, or hold on touch for 550 ms. The same options open without navigating. Moving to scroll cancels the hold; a normal tap still opens mail. Check Escape, outside tap, keyboard navigation and menus near the viewport bottom. |
| Density | Switch between comfortable/compact list spacing. Reload and verify persistence; Appearance settings use the same preference. Card view remains available. |
| Pagination | With more than 25 conversations, navigate forward/back on desktop and mobile. Preserve search and label filters across pages. |
| Action failure | Reject bulk/flag/pin/trash requests. An error appears, selection/flags remain correct, and the reader does not navigate away. |
| Empty trash | Hold with a pointer or Enter/Space. The control shows progress while awaiting the server, reports success only after completion, and remains retryable when the request fails. |
| Navigation | Open mail from a searched/filtered inbox and use Back. The same mailbox, filters, and page are restored. |
| Replies | Type a reply, attach a file, and use Ctrl/Cmd+Enter while the editor is focused. Failed delivery retains text and files. |
| Thread order | Open a thread through its oldest and newest message links. The latest message is first and expanded in the initial server render; equal timestamps use insertion order. Older messages expand individually or with Expand all. Replies and forwards still target the latest message. |
| Code trash | Trash one code from a mixed conversation using its code card. Other messages stay live. Undo restores only that email, and restored mail is not scheduled again. Fail the PATCH request and verify the reader and error stay visible. |
| Code timer | Enable One-time codes in Automations for one test account. New inbound code mail gets an arrival + five-minute deadline; outbound mail, old mail, receipts, alerts and recovery codes do not. Run the scheduled pass just before and at that deadline. Verify account isolation, unread cleanup, protected flags/keep rules, disabling before expiry, and repeat passes. |
| Mobile | Sidebar stays outside the reading area, content has no page overflow, and attachment actions remain usable. |
| Mobile accounts | Open the account picker from the inbox header and navigation drawer. At 320px and in short landscape viewports, account rows scroll while Add account and sign-out actions remain visible. Switching replaces the inbox with the selected account's mail. |
| Mobile navigation | Closed navigation is inert. Opening the drawer focuses Close navigation, keeps Tab/Shift+Tab within the drawer, and makes covered content inert. Escape closes it and restores focus. Repeat from Settings. |

The inbox redesign was checked in Chromium at widths of 1440, 1024, 900, 390 and
320 pixels, with light/dark themes, a full 35-conversation test inbox, and the
mobile reader and composer. Native dialogs keep keyboard focus inside them;
Escape closes label dialogs without clearing the underlying mailbox selection.

Local browser checks validate rendering, storage, and intercepted delivery
payloads. They do not verify live provider delivery, DNS, or production webhooks.

The October 14 category redesign was checked locally in Chromium in both themes
at 1440, 1024, 900, 390 and 320 pixels with an isolated sample mailbox. Checks
covered category and attention filtering, sender names, both layouts, collapsed
navigation, and HTML text staying visible while a remote-image response was held
open. The downloaded WebKit runtime stalled during page creation, so the exact
Safari repaint symptom remains unverified in that engine.

The October 22 mobile account/layout pass was checked locally in Chromium at
320 × 568, 390 × 844, 844 × 390, and 1440 × 900 with two synthetic accounts.
Checks covered the header account switch, a landscape picker with a scrolling
account list and visible actions, navigation focus trapping/restoration,
Settings navigation, compact list spacing, the selection header, and a saved
composer draft. Header controls use 44px touch targets and the ready Send button
uses the shared accent. No mail was sent. These viewport checks do not establish
native iOS/Safari behavior.

The thread/code cleanup pass verifies reader load order (including same-second
arrivals) and the cleanup SQL against SQLite with all migrations. A standalone
Svelte server-render smoke with a fixture navigation store also checks that the
newest body is expanded before hydration, older linked messages are available,
code actions render, and the closed reply prompt follows the messages. Browser
tools were unavailable for this pass, so interactive/visual behavior and the
deployed cron still require verification.
