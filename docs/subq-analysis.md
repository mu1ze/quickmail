# Incoming email analysis

QuickMail uses SubQ Snap for suggested categories and independent phishing,
spam, reply, deadline, and urgency judgments. Analysis never moves mail,
marks it read, sends a reply, or changes weekly cleanup decisions.

## Enable locally

1. Apply migrations: `bun run db:migrate:local`.
2. Set `SUBQ_API_KEY` in the gitignored `.env`. If `.dev.vars` exists,
   Wrangler ignores `.env`; put the key in `.dev.vars` instead.
3. Use `QUICKMAIL_LOCAL_BINDINGS=1 bun run dev` to inspect the UI. Vite runs
   the SvelteKit fetch handler, not the queue/cron handlers; use
   `bun run preview` to exercise background delivery with local bindings.
4. Settings → Automations → Incoming email analysis: enable the account.

The setting is off by default and applies only to future incoming messages.
Existing mail is analyzed on request with **Analyze all existing emails**: it
queues batches of 200 and the five-minute reconcile keeps topping up until
nothing is left (the Settings page shows how many remain, and has a Stop
button). Failed jobs are not re-queued automatically; use Retry. Disable analysis to cancel pending work and invalidate active leases.
A request already in flight cannot be recalled, but its answer is discarded
after opt-out. Existing analysis/corrections are retained locally.

## Deploy prerequisites

Deployment is a separate operation; adding `.env` does not create a production
Worker secret. Before deploying this revision:

```sh
bun run db:migrate:remote
bunx wrangler queues create quickmail-analysis
bunx wrangler secret put SUBQ_API_KEY
bun run deploy
```

Create the queue only if it does not already exist. The setup wizard provisions a queue named after the Worker for new installations. The checked-in producer and
consumer bindings use `quickmail-analysis`, with a small batch and concurrency
of one. The Worker also reconciles durable jobs every five minutes. The weekly
cleanup still runs only on its Sunday cron. Self-hosted installations may omit
the queue bindings; they use bounded direct background processing plus the same
D1 retry jobs. Provisioning, production migration, deployment, and real-mail
analysis are not performed by the implementation tests.

## Data sent and retained

Each call uses the latest message's own text, limited to 6,000 characters,
sender/recipient names and addresses, subject, selected headers, attachment
filenames/types, and up to 20 parsed HTML link/text pairs. Reply quotes and
signatures are removed where recognizable; meaningful forwarded material is
preserved. Link credentials/query parameters and recognizable verification
codes are redacted. No remote links/images are fetched, attachment bytes are
not submitted, and no request metadata tags carry mail content. Redaction is
best effort and is not a guarantee that all sensitive text is removed.

Raw Authentication-Results is explicitly **unverified**. Sender-injected
headers, successful authentication, familiar display names, and prior
correspondence do not establish safety. The integration is semantic triage,
not antivirus, domain reputation, or SPF/DKIM/DMARC verification. Legacy
messages have unknown metadata where ingestion previously discarded it.


D1 stores selected inbound metadata, typed answer probabilities, version/model,
input hash, token usage, status, and manual corrections. Analysis does not store
an extra body copy or raw provider error payload. Deleting mail permanently
cascades through its analysis tables. Logs for the evaluator contain only
aggregate synthetic results and safe error codes.

## Categories and attention

Ten internal categories follow the supplied evaluation report: transaction,
promotion, newsletter, notification, security_alert, support, sales_outreach,
personal, work, and other. Primary groups personal/work/support; Updates groups
notification/security_alert; Promotions groups promotion/sales_outreach.

Category confidence must be at least 0.60 (calibrated on 270 real messages, where
guesses at 0.60–0.89 were consistently correct and a 0.90 cutoff hid ~40% of mail).
Lower confidence produces Review,
not a guessed category. Phishing/spam probabilities above 0.50 also produce
Review and warnings, retaining a confident purpose category independently.
Reply/deadline probabilities above 0.50 produce hints, suppressed for suspicious
messages. Urgency is retained as a numeric judgment, not a verified deadline.
Actual deadline dates are not extracted in this release.

Conversation categories and task hints use the latest non-trashed inbound
message (timestamp, then insertion order as a stable tie-breaker); a newer message supersedes
older task suggestions. Warnings aggregate across all non-trashed inbound
messages. A linked outbound message with a sent/delivered/delayed state clears
the corresponding reply hint; drafts, failed/bounced mail, opening a message,
and unrelated sent mail do not. Deadlines require task completion rather than
being cleared merely by a reply.

Use `category:primary`, `category:transaction`, `needs:review`, `needs:reply`,
`needs:deadline`, `needs:attention`, `risk:phishing`, or `risk:spam` in search.
Filters, counts, and pagination use the same owner-scoped conversation
predicates. Correct categories, dismiss warnings, and complete tasks from the
conversation menu or message's Review analysis panel. Corrections remain
separate from inference and survive retries. Pending and failed states are
visible; an unflagged message is never labeled safe.

## Reliability and evaluation

Inbound storage and job creation are one D1 transaction. Queue messages carry
IDs only. Leases and consent checks protect against duplicate delivery, stale
workers, opt-out races, and deleted mail. Transient network/429/5xx failures use
bounded backoff (five attempts); auth/credit/access failures pause processing,
and failed jobs require the Retry button after the underlying problem is fixed.
During a provider pause, due jobs remain in D1 for reconciliation. Rare crashes
after a provider accepts a request can cause another paid call: provider-side
idempotency is not documented, so exactly-once billing is not promised.

Run deterministic tests with `bun run test`, type check with `bun run check`,
and build with `bun run build`. To test the real API with **synthetic mail only**:

```sh
bun scripts/evaluate-subq.ts
```

If the key is only in `.dev.vars`, run `bun --env-file=.dev.vars scripts/evaluate-subq.ts` instead.

The included 15 examples are distinct from the report's original 47 fixtures.
They do not prove real-inbox accuracy. The final live run completed 15/15,
matched 15 categories (14 at confidence ≥0.90; threshold since lowered to 0.60), matched 14 reply labels, and
flagged the one phishing example. Median end-to-end latency was 305 ms, with
14,967 reported input tokens total. These are one-run observations, not an SLA.

Before changing thresholds, review roughly 200 real messages .
Settings reports category agreement by confidence band for manually reviewed
messages only; uncorrected predictions are not assumed correct. Include wanted
marketing, authentic security mail, scams, retractions, CC-only requests,
multilingual messages, and HTML/forwarding edge cases. Taxonomy/input changes
must change `ANALYSIS_VERSION`, and their quality must be evaluated separately.
