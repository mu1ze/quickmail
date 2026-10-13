# Mailbox regression checks

## Local setup

Use a disposable local account and local mail fixtures. Never repoint production
webhooks or send to real recipients for these checks.

```sh
bun install
bun run db:migrate:local
QUICKMAIL_LOCAL_BINDINGS=1 bun run dev
```

The attachment content ID migration (`0019_attachment_content_ids.sql`) must also
be applied to the deployment database before deploying these changes.

## Automated checks

```sh
bun run test
QUICKMAIL_LOCAL_BINDINGS=1 bun run check
QUICKMAIL_LOCAL_BINDINGS=1 bun run build
```

The tests cover HTML policies, readable snippets, Unicode entities, MIME
classification, byte ranges, attachment validation, provider content IDs,
server-rendered compose content, text links, and failed HTTP responses.

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
| Action failure | Reject bulk/flag/pin/trash requests. An error appears, selection/flags remain correct, and the reader does not navigate away. |
| Empty trash | Hold with a pointer or Enter/Space. The control shows progress while awaiting the server, reports success only after completion, and remains retryable when the request fails. |
| Navigation | Open mail from a searched/filtered inbox and use Back. The same mailbox, filters, and page are restored. |
| Replies | Type a reply, attach a file, and use Ctrl/Cmd+Enter while the editor is focused. Failed delivery retains text and files. |
| Mobile | Sidebar stays outside the reading area, content has no page overflow, and attachment actions remain usable. |

Local browser checks validate rendering, storage, and intercepted delivery
payloads. They do not verify live provider delivery, DNS, or production webhooks.
