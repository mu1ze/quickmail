# QuickMail security and efficiency audit

Audit date: October 22, 2026. Checkout: `c63ebbccb8195dfde6fe730417136ab154cbe532`.

The first fixes should be API-key authorization, cross-origin mutation protection, and inbound delivery deduplication. The largest efficiency improvement is to stop rebuilding conversation state from the entire mailbox on each fresh load.

This is a source and local runtime audit. Reproductions used synthetic accounts, mail, in-memory SQLite with all migrations, actual application handlers, and the existing local production build. No production mailbox was read or changed, no external mail was sent, and no runtime code or dependencies were changed. Deployment configuration, production traffic, browser behavior, and provider-side delivery remain unverified.

## Findings

### 1. High — sending-only API keys can delete conversations

Sources: [route permissions](/Users/dvlli/Websites/quickmail/src/lib/server/api-access.ts:54), [message mutations](/Users/dvlli/Websites/quickmail/src/routes/api/mail/[id]/+server.ts:54).

The single-message PATCH and DELETE routes require only `mail:send`. Their handlers do not apply the stricter action authorization used by `/api/mail/actions`, where trash and permanent deletion require both `mail:read` and `mail:send`.

Reproduced: a sending-only key was allowed by the route authorization; PATCH with `trashed: true` returned 200; DELETE returned 200 and removed the synthetic conversation. The equivalent bulk trash action was correctly denied with 403.

The attacker needs a valid sending key and a known message ID. IDs returned from the key's own sends are sufficient to demonstrate the privilege mismatch; this finding does not imply arbitrary ID discovery or access to another user's account.

Fix: use one action authorization policy for both endpoints. Flag changes should follow the corresponding bulk policy; trash, restore, and permanent deletion should require both scopes. Test each mutation with sending-only, reading-only, combined, and browser-session credentials.

### 2. High, conditional — cross-origin requests can perform destructive session actions

Sources: [request hook](/Users/dvlli/Websites/quickmail/src/hooks.server.ts:146), [bulk action handler](/Users/dvlli/Websites/quickmail/src/routes/api/mail/actions/+server.ts:27), installed SvelteKit `src/runtime/server/respond.js` and `src/utils/http.js`.

Most mutation endpoints have no explicit Origin check and accept JSON through `request.json()` regardless of Content-Type. SvelteKit's installed CSRF check covers form content types, including `text/plain`, but does not classify a request with no Content-Type as a form submission. Login, account switching, and push subscriptions already have explicit Origin checks; ordinary mailbox mutations do not.

Reproduced through the compiled production SvelteKit `Server.respond`: an authenticated POST from `https://sibling.example.test` to `https://mail.example.test/api/mail/actions`, with no Content-Type and a byte-array JSON body, returned 200 and permanently emptied the synthetic Trash.

Browser exploitation requires the session cookie to be sent. Explicit SameSite=Lax cookies restrict ordinary cross-site POSTs, but do not isolate same-site sibling origins. A malicious or compromised HTTPS sibling subdomain can issue this kind of request with credentials included. CORS does not need to expose the response for the mutation to happen. This was verified at the server boundary, not in an interactive browser. See the [Fetch documentation](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#including_credentials) for credential and same-site behavior.

Fix: centrally reject unsafe session requests whose Origin differs from the app origin; define a strict policy for missing Origin and require the expected Content-Type. Preserve bearer-token CLI access and independently signed webhook handling. Test no Content-Type, allowed JSON, form content types, sibling origins, and account mismatch handling through the full request pipeline.

### 3. High — inbound deduplication drops a second account's copy

Sources: [Cloudflare inbound handling](/Users/dvlli/Websites/quickmail/src/lib/server/cloudflare-inbound.ts:50), [global provider-ID lookup](/Users/dvlli/Websites/quickmail/src/lib/server/mail-store.ts:124), [inbound ID generation](/Users/dvlli/Websites/quickmail/src/lib/server/cloudflare-inbound.ts:186).

For Cloudflare mail, `providerId` is the sender's Message-ID when present. Deduplication checks that ID globally, before resolving the receiving account. Two deliveries with the same Message-ID to different local accounts are treated as duplicates.

Reproduced with two separate envelope deliveries to two configured local users, both carrying the same Message-ID: only the first user's row was stored. This affects normal multi-recipient mail. Sender-controlled IDs can also collide with another delivery. When Message-ID and Date are both missing, the fallback identity has no body or arrival entropy, so distinct messages with the same sender and recipient can collide too.

Fix: resolve the authoritative envelope recipient first and deduplicate per intended mailbox delivery. Store the transport/delivery identity separately from the RFC Message-ID and enforce the chosen uniqueness in the database. Preserve delivery to every intended local account. Test two accounts, two aliases of one account, missing IDs, collisions, and concurrent retry events.

### 4. Medium — threading merges unrelated senders

Source: [subject fallback](/Users/dvlli/Websites/quickmail/src/lib/server/threads.ts:143).

The subject fallback includes both the sender and recipient in its overlap test. The account's own recipient address therefore satisfies the shared-participant condition for unrelated inbound senders with the same subject. Address matching also uses substrings rather than exact normalized addresses.

Reproduced: `alice@outside.test` and `mallory@unrelated.test` both sent an unrelated message titled `Invoice` to the same account, without reply headers. Both messages acquired the same thread ID.

Impact: unrelated conversations mix; a thread-level trash/archive action can affect unrelated mail; an untrusted sender can appear inside an existing conversation. This does not itself disclose another account's messages.

Fix: prefer explicit reply headers, exclude the user's own identities from fallback participant matching, compare exact external addresses, and use a narrower fallback. Existing false merges need an explicit repair strategy rather than an indiscriminate migration.

### 5. Medium — long threads and ordinary bulk selections exceed D1 limits

Sources: [thread attachments query](/Users/dvlli/Websites/quickmail/src/lib/server/mail-store.ts:986), [flag update](/Users/dvlli/Websites/quickmail/src/lib/server/mail-store.ts:750), [sender-name query](/Users/dvlli/Websites/quickmail/src/lib/server/mail-store.ts:427).

Several queries build an unbounded placeholder list from all messages in a thread or expanded selection. Cloudflare documents a maximum of [100 bound parameters per query](https://developers.cloudflare.com/d1/platform/limits/). The analysis loader already chunks its IDs; these paths do not.

Reproduced with actual SQL and a wrapper enforcing the documented D1 limit:

| Operation | Synthetic input | Result |
| --- | --- | --- |
| Open conversation | 101 messages | Attachment query requires 101 parameters; fails |
| Trash one page of conversations | 25 threads × 5 messages | Expanded update requires 126 parameters; fails |

The ordinary Bun SQLite test adapter has a larger parameter limit, so the existing suite does not catch these failures. The reader also fetches both text and HTML bodies for every message even when most messages are collapsed.

Fix: reserve space for fixed bindings when chunking; prefer joins/subqueries scoped by user and thread instead of expanding IDs into application memory. Add bounded newest-message loading and load older bodies on demand. Enforce D1-compatible limits in the test adapter and test long-thread read, mutation, deletion, and label operations.

### 6. Medium — vulnerable dependency versions need a controlled update

Source: [lockfile](/Users/dvlli/Websites/quickmail/bun.lock:271).

The live registry audit reported 58 advisory matches across 15 locked packages: 21 high, 30 moderate, 6 low, and 1 critical. These are dependency matches, not 58 demonstrated vulnerabilities in the web app.

Relevant distinctions:

| Dependency | Locked version | Exposure assessment |
| --- | --- | --- |
| `@sveltejs/kit` | 2.61.1 | Framework code ships in the Worker. The maintainer documents CPU exhaustion through crafted Accept headers, patched in 2.70.2. Platform header limits mitigate exposure; no production exploit was attempted. |
| `devalue` | 5.8.1 | Used by Svelte/SvelteKit; multiple matches. Several require special serialization/reviver paths not established in this app. A documented ArrayBuffer fix is in 5.9.3. |
| `@modelcontextprotocol/sdk` | 1.30.0 | Used by the local CLI over stdio. The SDK's HTTP server memory-exhaustion advisory explicitly excludes stdio-only servers. |
| `proxy-addr` | 2.0.7 | The critical registry match is an Express/MCP transitive dependency. No Express HTTP server is exposed by this web app. |
| Vite, PostCSS, source-map tooling, Wrangler dependencies | Various | Primarily development/build exposure. They still need updates; registry severity alone does not describe production reachability. |

Sources: [SvelteKit advisory](https://github.com/sveltejs/kit/security/advisories/GHSA-29g2-3rmr-qm68), [devalue advisory](https://github.com/sveltejs/devalue/security/advisories/GHSA-r9w8-h9r3-54w4), [MCP SDK advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453).

Fix: update compatible framework/toolchain packages and regenerate the lockfile, then rerun the audit, full tests, type checks, build, and authenticated browser checks. Review the remaining matches for reachable code paths. The patch versions above address the cited advisories; they are not a promise that those minimum versions clear every audit match.

### 7. Medium — mailbox work grows with the whole account, not the visible page

Sources: [mailbox query](/Users/dvlli/Websites/quickmail/src/lib/server/mail-store.ts:278), [sidebar counts](/Users/dvlli/Websites/quickmail/src/lib/server/mail-store.ts:619), [request context](/Users/dvlli/Websites/quickmail/src/hooks.server.ts:112), [layout data](/Users/dvlli/Websites/quickmail/src/routes/+layout.server.ts:24).

The first page counts all matching conversations, enumerates and sorts all matching conversation activity, then loads every message summary belonging to the selected threads. Sidebar counts use seven separate DISTINCT aggregates across the user's mail. Layout loading revalidates the active saved account again and each additional saved account individually. Every authenticated API request loads domains, addresses, and permissions even for endpoints that do not need them.

Measured using the actual hook, layout loader, and mailbox function with one saved non-admin account, 25 visible conversations, 5 messages per conversation, persisted previews, and known sender names:

| Messages in account | SQL statements | Rows returned across statements | Largest result |
| --- | --- | --- | --- |
| 1,000 | 16 | 407 | 125 |
| 10,000 | 16 | 407 | 125 |
| 50,000 | 16 | 407 | 125 |

These are returned rows, not rows scanned. Query plans showed seven temporary DISTINCT trees for counts and temporary grouping/sorting for page selection. The existing expression index helps thread lookup, but cannot eliminate rebuilding these account-wide aggregates. Local timings varied greatly with host load, so they are not reliable production latency estimates. No D1 billing or production response-time claim is made.

Fix: store indexed per-thread activity and summary state, use an indexed latest-activity/pinned cursor, and keep counts consistent through atomic updates or revision-aware caching. Load only the context each route needs. Validate saved sessions in one bounded query, reuse the active user, and batch independent enrichment reads. Profile D1 rows-read and p95 response time before and after; do not trade account isolation or permission freshness for a global cache.

### 8. Medium — attachment ranges still read the entire object

Sources: [attachment response](/Users/dvlli/Websites/quickmail/src/routes/api/mail/[id]/attachments/[attachmentId]/+server.ts:22), [R2 read](/Users/dvlli/Websites/quickmail/src/lib/server/attachments.ts:125).

The handler downloads the whole R2 object into memory before parsing the Range header, then slices or copies it. Repeated media range requests repeat that full-object work.

Reproduced with a mock R2 object: a request for one byte of a 5 MiB PDF read all 5,242,880 bytes and returned one byte with status 206. Ownership checks still ran correctly. The response also allows one hour of private browser caching; sensitive attachments can remain reusable from a browser cache after account switching/logout without another server ownership check. That cache behavior is inferred from headers and was not tested in a browser.

Fix: use R2 range reads and streamed bodies, derive metadata from the object, and return appropriate 206/416 responses without buffering the full file. Choose an explicit confidential-attachment cache policy, preferably no-store where logout/account isolation should require fresh authorization.

### 9. Medium — request limits are applied after large bodies are buffered

Sources: [send endpoint](/Users/dvlli/Websites/quickmail/src/routes/api/mail/+server.ts:83), [draft endpoint](/Users/dvlli/Websites/quickmail/src/routes/api/drafts/+server.ts:31), [signature upload](/Users/dvlli/Websites/quickmail/src/routes/api/signature-assets/+server.ts:15), [Cloudflare MIME read](/Users/dvlli/Websites/quickmail/src/lib/server/cloudflare-inbound.ts:34).

Mail and draft endpoints parse the entire JSON body before validation. Signature uploads parse multipart data before checking the file's size. The stored-message truncation limit does not limit incoming request allocation or outbound provider content. Base64 attachments add memory overhead before decoding. Cloudflare inbound mail is also fully buffered and parsed before attachment limits are enforced. Explicit application rate controls exist for login/recovery, but no send/upload quotas were found.

This is a source-confirmed resource-control gap, not a demonstrated production outage. Authenticated users or leaked sending credentials could generate excessive allocation/provider use. Cloudflare's platform request limits do not replace appropriately smaller limits for this application.

Fix: implement bounded streaming body readers, reject excessive declared lengths early while also counting actual bytes, validate runtime schemas and recipient counts, and enforce account/IP sending and upload quotas. Bound MIME intake using transport size information where available. Test oversized and chunked bodies without contacting providers.

## Controls already present

- Message, attachment, draft, label, and signature ownership checks are generally user-scoped; reviewed access uses bound SQL parameters.
- Session/API tokens are random and stored as hashes; browser cookies are HttpOnly, Secure, and SameSite=Lax.
- Password changes revoke other sessions and API keys; login/recovery have account and IP attempt limits and unknown-account password timing work.
- Mail HTML passes through DOMPurify and a scriptless sandboxed iframe with a restrictive inner policy. Remote resources default to blocked. These are source-verified controls, not a complete browser XSS proof.
- Stale tabs carry an account identity header; service-worker notification actions validate account context. The service worker does not cache mailbox/API data.
- Resend webhooks require signatures and timestamps; analysis jobs recheck account consent and ownership before provider calls and result persistence.
- Code cleanup defaults off and moves individual messages to recoverable Trash, with protections for retained messages.

## Additional hardening and release checks

- Replace the outer page's `script-src 'unsafe-inline'` with SvelteKit nonces/hashes; keep the separate email iframe policy restrictive.
- Gate initial setup with an operator-only bootstrap secret and make first-admin creation atomic. Setup currently relies on the instance having no users; it should not remain publicly claimable before an operator initializes it.
- Treat `PASSWORD_RESET_KEY` as an operator master credential; do not distribute it as ordinary end-user recovery. Consider WebAuthn/MFA for mailbox accounts and per-user recovery.
- Make login attempt reservation atomic before expensive password work; the current read/check followed by recording failures can permit concurrent bursts beyond the intended attempt threshold.
- Add dependency scanning and D1-compatible boundary tests to CI. No `.github` workflow directory was present in this checkout.
- Verify deployed migration state, including `0030`, scheduler registration, production security headers, provider/DNS configuration, retention settings for external analysis, backup restoration, and account isolation in signed-in browsers. None of those are established by this local audit.

## Validation and next work

The full existing suite passed: **304 tests across 56 files**. Type checking reported **0 errors and 9 existing warnings in 2 files**. The audit harness additionally reproduced the API scope bypass, unrelated-thread merge, two-account delivery loss, D1 reader and bulk limits, the cross-origin mutation through the production request handler, and the inefficient attachment range read. All fixtures were synthetic. The D1 limit reproduction uses a documented-limit wrapper around SQLite rather than a production D1 database.

Temporary evidence: `/tmp/quickmail-audit.ts`, `/tmp/quickmail-audit-results.json`, `/tmp/quickmail-security-audit-dependencies.json`, `/tmp/quickmail-security-audit-tests.log`, and `/tmp/quickmail-security-audit-check.log`. Temporary files are not durable project documentation; the results and source locations above are retained here.

Recommended implementation order: authorization and Origin checks first; delivery deduplication and threading correctness second; D1-safe batching and dependency updates next; then thread-state queries, attachment streaming, and request quotas. Each fix needs a regression that fails against this audited commit. No fixes, deployment, or commit were performed as part of this audit.
