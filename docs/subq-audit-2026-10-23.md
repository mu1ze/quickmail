# SubQ decision implementation audit — 2026-10-23

Audited checkout: `d2c5b10`. This is a source and local synthetic audit. No real
mail was sent to SubQ, no provider credentials were inspected, and production
settings, migrations, queues, accuracy, billing, and retention were not verified.
Runtime code was not changed.

## Findings, in recommended repair order

### 1. High: enabling analysis has no retention acknowledgement or operator policy gate

Locations: `src/routes/api/settings/analysis/+server.ts:18`,
`src/lib/components/AnalysisSettings.svelte:34`,
`src/lib/server/mail-analysis-jobs.ts:80`.

The settings endpoint accepts `{enabled:true}` with only a configured key and an
owner browser session. The UI discloses the fields sent, but neither displays the
provider's retention policy nor asks for the previously required ZDR confirmation.
There is no stored retention acknowledgement or configured retention policy to
check before the provider call. A configured key does not establish ZDR.

Local reproduction: the real PUT handler returned 200 and enabled the account
without any retention acknowledgement. This demonstrates the missing gate, not
that production currently retains mail.

The repository's guide says ZDR must be active, but its claim that default retention
is indefinite is outdated. SubQ currently documents deletion within 60 days,
subject to investigation/legal exceptions; organization ZDR stores no content.
The per-request `store:false` option is documented for Chat/Responses, not
Decisions. See [SubQ retention](https://docs.subq.ai/using-the-api/data-retention/).

Recommendation: make the operator's retention policy explicit, disclose it before
opt-in, and persist a versioned account acknowledgement. Require an operator ZDR
attestation or explicit consent to the disclosed retention policy; do not present
an attestation as API verification. Check that policy with consent before calls.
Prior authorization for a one-time historical pass does not authorize ongoing
retention-enabled processing.

### 2. Medium: failed jobs can prevent older mail from ever entering backfill

Location: `src/lib/server/mail-analysis-store.ts:25–59`.

The INSERT's SELECT excludes existing analyses but does not exclude existing jobs
before applying LIMIT 200. `INSERT OR IGNORE` then ignores those jobs. If the newest
200 messages all have failed jobs, older unqueued mail is never selected.
`continueBackfill` interprets zero inserts and zero open jobs as completion and
turns the backfill flag off.

Local reproduction with 201 messages: queue the newest 200, mark their jobs failed,
then continue backfill. It adds zero jobs, clears `backfill_all`, and leaves the
oldest message unqueued. The existing happy-path test does not cover this case.

Recommendation: exclude current-version jobs in the SELECT before LIMIT. Keep
failed-job retry separate, and determine completion from eligible unqueued work,
not only the number inserted in one batch.

### 3. Medium: trashing during inference can leave restored mail pending forever

Location: `src/lib/server/mail-analysis-jobs.ts:86–97`.

The result INSERT checks that the message remains untrashed. The following job
UPDATE checks only the job identity and lease. If the mail is trashed during the
provider request, the result is correctly discarded, but the job is still marked
`analyzed`. Restoring it leaves an analyzed job with no analysis row.

Local reproduction: trash inside the mocked provider request, return a valid
response, then restore. The database contains zero analyses and an `analyzed` job;
the reader reports `pending`. Counting unqueued mail returns zero, backfill inserts
nothing, and reconciliation makes no new provider call. Retry only resets failed
jobs, so it does not repair this state.

Recommendation: couple completion to a successfully persisted analysis under the
same consent/ownership/lease guard. Model cancellation explicitly, or make skipped
jobs recoverable on restore. Reconcile analyzed jobs missing their analysis row.

### 4. Medium: settings can falsely report that all mail has been analyzed

Locations: `src/lib/components/AnalysisSettings.svelte:27–32`,
`src/lib/server/mail-analysis-store.ts:34–40`.

`remaining` means messages with neither an analysis nor a current-version job.
The UI treats `remaining === 0` as “All existing mail has been analyzed,” even when
jobs are pending, processing, or failed, provided automatic backfill is off.
Ordinary opted-in inbound processing can reach this state, as can stopping a
backfill while already queued jobs finish. Failed jobs are also excluded from
`remaining`.

Evidence: source-confirmed predicate mismatch, plus the restored-mail reproduction
above where `remaining` is zero without any saved analysis. The rendered settings
page was not browser-tested during this audit.

Recommendation: expose separate analyzed, pending, processing, failed, cancelled,
and unqueued counts. Claim completion only when all eligible messages have usable
current-version results; show failures separately rather than treating them as
completed analysis.

## Additional hardening and decision-quality risks

These are source-confirmed gaps or policy choices, not demonstrated production
incidents or measured classification errors.

- **Paid inference has no durable account/global budget.** Attempts are bounded
  per job, dispatch rounds are bounded, and the configured queue concurrency is
  one. Those limit retries and processing rate, not total paid work. New inbound
  mail can create unlimited distinct jobs for enabled accounts; the request quotas
  in `hooks.server.ts` cover mail/draft/upload mutations, not background analysis.
  Add daily account/global token or call reservations, a pause state, and visible
  budget exhaustion before scaling continuous analysis.
- **Uncertainty is collapsed at 0.50 for every Noul.** A local synthetic response
  with phishing/spam at exactly 0.50 and reply/deadline at 0.500001 produces both
  task hints and no Review flag when category confidence is high. This is current
  policy, not evidence the model misclassified real mail. Use separate evaluated
  safety and task policies, with an uncertainty band where appropriate. Preserve
  probabilities for inspection. A Choice confidence of 0.60 is not a measured 60%
  real-inbox accuracy. The supplied 15 examples are too limited to establish
  safety-signal calibration; no labeled spam/deadline/urgency evaluation is present
  in the evaluator. It exits successfully on wrong labels if the requests succeed.
- **Parsing validates required answers but persists extra provider fields.**
  `subq.ts:95` returns the original `answers` object through a type cast, and
  `mail-analysis-jobs.ts:95` serializes it into D1. A synthetic extra field containing
  an unexpected body echo passed validation and remained in the returned object.
  No actual provider echo was observed. Build a canonical object from allowed
  scalar fields and bounded distributions before persistence; also bound response
  bytes. This keeps the stored-data contract independent of provider additions.
- **Evidence can be incomplete or stale.** Body text is capped at 6,000 characters
  and HTML links at 20. Plaintext and HTML can disagree, and quote removal is
  heuristic. The state has a sender-supplied Date but no explicit evaluation time,
  reducing the grounding for “today” urgency during historical backfill. Evaluate
  truncation, alternative-body disagreement, HTML-only scams, quoted retractions,
  old deadlines, CC-only requests, multilingual mail, and prompt injection before
  claiming inbox accuracy or changing thresholds. Input/question changes require
  a new analysis version.

## What is working well

- Current endpoint, model, question shapes, and zero-output-token contract match
  [SubQ Decisions documentation](https://docs.subq.ai/endpoints/decisions-api/).
  The separate TypeSafe documentation is not evidence that this SubQ endpoint
  needs migration.
- Six independent judgments share one request; folder purpose is separate from
  phishing/spam. Analysis does not itself trash, mark read, or send mail.
- Account opt-in defaults off. Settings and corrections require browser sessions;
  queries scope results and mutations to the owner. Queue payloads carry IDs only.
- Lease claims protect against ordinary duplicate processing. Consent and message
  existence are checked before calls and saving; opting out invalidates leases.
  A request already in flight cannot be recalled, and the implementation does not
  promise exactly-once provider billing.
- Network/429/5xx retries are bounded. Provider errors use safe codes rather than
  logging response bodies. Attachment bytes and remote resource fetches are absent
  from analysis input; URL/code redaction is explicitly best effort.
- Manual corrections survive inference. Newest inbound messages control categories
  and tasks, including same-second ordering; older security warnings remain visible.

## Evidence and validation

- Existing focused suite: **24 passed, 0 failed**, covering jobs, SubQ adapter,
  analysis/search behavior, ownership, opt-out, retries, and corrections.
  Command: `bun test src/lib/server/mail-analysis-jobs.test.ts src/lib/server/subq.test.ts src/lib/mail-analysis.test.ts --timeout 120000`.
- Additional synthetic audit harness: **5 passed, 0 failed**, reproducing the
  missing acknowledgement, blocked backfill, trash/restore race, extra-field
  retention, and 0.50 uncertainty behavior against actual functions and migrated
  in-memory SQLite. These assertions document current behavior, not successful
  fixes. Temporary harness: `/tmp/quickmail-subq-audit.test.ts`;
  logs: `/tmp/subq-audit-reproductions.log`, `/tmp/subq-audit-baseline.log`.
- All migrations were applied to the synthetic database. SQL used the same
  statements as production functions; Cloudflare queue/runtime behavior was mocked.
- No runtime changes, full build, browser pass, live inference, real-mail
  evaluation, or production migration were needed or performed for this audit.
