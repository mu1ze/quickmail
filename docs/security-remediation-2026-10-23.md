# Security and efficiency remediation — October 23, 2026

This change addresses the nine findings in `security-efficiency-audit-2026-10-22.md`. The original audit remains a record of the earlier checkout.

| Finding | Change |
| --- | --- |
| Sending-only keys could delete mail | Single-message mutations enforce the same action permissions as bulk operations. Sending-only keys cannot trash, restore, or delete mail. |
| Cross-origin session mutations | Unsafe API requests require the app Origin unless using bearer authentication without cookies. JSON mutations require JSON Content-Type. Signed webhooks retain their independent authentication. |
| Duplicate detection dropped a second account's delivery | Cloudflare transport identities hash the envelope recipient, RFC Message-ID, and raw message content. The RFC Message-ID remains available for threading. Deterministic insert IDs also prevent concurrent identical deliveries from creating duplicate rows. |
| Unrelated senders merged by subject | Subject fallback is restricted to recent reply subjects and exact sender/recipient pairs. Explicit reply headers still take precedence. Historical threads are preserved; existing false merges are not automatically rewritten. |
| D1 parameter overflow and large reader responses | Expanded mutations, deletions, labels, and sender lookups are batched. Attachment metadata queries use ownership-scoped joins. The web reader initially loads 20 messages; older messages can be loaded in batches. The JSON API's default chronological contract is retained. |
| Dependency advisories | Compatible direct updates plus targeted transitive overrides clear the registry advisory matches. Overrides are explicit in `package.json`; keep auditing them during upgrades. |
| Account-wide mailbox aggregation | Migration 0031 builds indexed per-conversation projections maintained transactionally by database triggers. Ordinary mailbox counts/page ordering use these projections. Search, advanced filters, and accounts with active snoozes retain the existing query path for correctness. Saved browser sessions are validated in one query; API routes that do not need mailbox context skip domain/address loading. |
| Full-object attachment range reads | R2 attachments use streamed object bodies and ranged reads. Confidential attachment responses use private/no-store. Legacy database-backed attachments still use the bounded compatibility reader. |
| Late body limits and missing quotas | Incoming bodies are counted while streaming, before JSON/multipart parsing. Message field types, lengths, and recipient counts are checked. Per-account hourly quotas are reserved atomically before send, draft, mutation, and upload work. MIME intake has a bounded size and rejects oversized deliveries. |

## Deployment

Apply pending migrations before deploying code. This includes prior migration 0030 if it has not been applied, plus:

- `0031_mailbox_threads.sql`: creates and backfills conversation projections and adds maintenance triggers/indexes. Allow an appropriate migration window for a large mailbox and verify D1 execution limits against a representative copy first.
- `0032_request_quotas.sql`: creates bounded per-account quota counters.

No remote migration, deployment, or production mail change is performed by this implementation. Do not deploy the new Worker before its schema is present. Keep migration 0031 and the code together: the optimized loaders expect the projection table to exist.

The minutely cron introduced with code cleanup still needs to be deployed if it is not already registered.

## Resource limits

- JSON mail/draft/mutation body: 12,000,000 bytes including base64 attachment data.
- Other JSON API bodies: 65,536 bytes.
- Multipart signature upload body: 1,100,000 bytes; the existing 1 MiB image limit still applies.
- Message text/HTML fields: at most 256,000 characters each; no more than 100 recipients across To/Cc/Bcc.
- Outbound attachments: 5 MiB per file, **8 MiB combined**. The lower combined cap leaves memory headroom for base64 decoding and provider serialization.
- Incoming Cloudflare MIME: 15 MiB. Oversized mail is explicitly rejected rather than silently dropped.
- Per account, per UTC hour: 300 send/reply attempts, 1,800 draft saves, 1,800 individual message mutations, and 100 signature uploads. Counters use one row per account/action class and reset on the next hourly window. Failed attempts can consume quota. Bulk mutations remain bounded by the request body and D1 batching.

These limits are application policy, not claims about provider limits. Operator tuning should preserve Worker memory headroom and abuse protection.

## Verification

Regression coverage includes sending-key restrictions, foreign/missing Origin, separate envelope recipients with the same Message-ID, unrelated sender subjects, D1-compatible parameter limits on long threads, ranged streaming/cache policy, quota isolation/reset, and chunked body limits. Mail classification tests now explicitly link their synthetic replies instead of relying on the unsafe subject fallback.

Final local verification: **314 tests passed across 56 files**, production build passed, and Svelte checking reported **0 errors and 9 warnings in unchanged UI files**. The updated registry dependency audit returned **zero advisory matches**. The final stream typing correction is an erased TypeScript annotation; ranged-download behavior is covered by the regression test.

Browser interaction, production latency/billing, deployed account isolation, provider delivery/rejections, and migration duration on the production dataset require separate release verification.

The additional hardening suggestions in the original report (MFA, operator-gated setup, CSP nonces, and CI automation) were separate from the nine findings and remain future work.
