# QuickMail security review

**Review date:** 2026-08-23  
**Method:** Manual, unauthenticated static review of the application, Worker routes,
database migrations, and deployment configuration. No production target was probed and
no destructive exploit was attempted.

## Executive summary

The application has a sound authorization baseline: mailbox queries are generally
scoped to a user, API tokens are hashed and constrained by an endpoint allowlist,
session cookies use secure attributes, attachment reads check ownership, and Resend
webhooks are authenticated before processing.

The most important attack points are the public first-run bootstrap endpoint and the
unthrottled password login endpoint. Together, these make deployment sequencing and
edge rate limiting security-critical. Received HTML mail also loads sender-controlled
remote resources automatically, which allows conventional tracking pixels and can
disclose a user's IP address and message-open time.

## Findings

### QM-01 — Public first-run setup can be claimed by an attacker (High)

**Evidence.** `/api/setup` is deliberately included in the public route list. Its POST
handler accepts the future administrator's address, name, and password without an
operator-held bootstrap secret. The only gate is `countUsers(db) === 0`; after that
check, it creates an administrator and signs the caller in.

**Attack scenario.** A new Worker is deployed before its legitimate operator completes
setup. Anyone who discovers or scans the `workers.dev` hostname can submit setup first
and become the administrator. The attacker can then connect mail identities, read
mail routed to the instance, and create additional users or API keys. The initial
check and the later check in `bootstrapAdmin` also do not constitute an atomic
compare-and-create operation, so concurrent setup requests can race (the unique email
constraint limits some outcomes but does not make bootstrap ownership deterministic).

**Recommendation.** Require a high-entropy, one-time `SETUP_TOKEN` secret on every
setup GET/POST until initialization completes, or provision the first admin through a
deployment command rather than a public route. Perform the uninitialized check and
first-admin creation as one serialized/atomic operation. Operators should deploy with
the setup secret already configured and remove or rotate it immediately afterward.

### QM-02 — Login has no application-level abuse controls (High)

**Evidence.** The public login POST accepts an unlimited sequence of email/password
pairs and runs password verification for every request to an existing account. There
is no per-IP, per-account, or global failure counter, delay, lockout, CAPTCHA, or
Cloudflare rate-limit binding in the repository.

**Attack scenario.** An attacker can perform online password guessing against known
mail addresses. Requests for valid users also invoke PBKDF2, so parallel attempts can
consume Worker CPU and provide an inexpensive denial-of-service vector. The endpoint's
generic error is good practice and prevents direct account enumeration, but it does
not mitigate guessing or resource exhaustion.

**Recommendation.** Apply layered throttling: a Cloudflare rate-limiting/WAF rule at
the edge, plus short-lived per-IP and per-normalized-account failure buckets in a
Durable Object or another consistent store. Return `429` with `Retry-After`, add
exponential backoff, alert on sustained failures, and preserve the same observable
response for existing and nonexistent users. Consider optional WebAuthn or TOTP for
administrators.

### QM-03 — Viewing mail automatically requests sender-controlled resources (Medium)

**Evidence.** Received HTML is inserted into an iframe `srcdoc` without URL rewriting
or resource filtering. The iframe blocks scripts but permits normal image, stylesheet,
font, media, and CSS `url()` fetches. Its `referrerpolicy="no-referrer"` suppresses the
Referer header but does not stop the request itself.

**Attack scenario.** A sender embeds a unique remote image URL. Opening the message
requests that URL, confirming the mailbox is active and disclosing open time, IP/network
metadata, and browser characteristics to the sender. Remote CSS can cause further
requests. This is a privacy issue and can improve phishing reconnaissance.

**Recommendation.** Default to blocking remote resources in received mail. Sanitize
HTML and rewrite `src`, `srcset`, poster, stylesheet, SVG, and CSS URL-bearing values;
show a per-message “Load remote content” control. A privacy-preserving image proxy is
an alternative if it strips credentials, blocks private/link-local destinations,
limits size and redirects, and caches responses. Keep the current scriptless sandbox.

### QM-04 — Password hashing cost is below current defensive expectations (Medium)

**Evidence.** Passwords use PBKDF2-HMAC-SHA-256 with a random 16-byte salt, but the
work factor is fixed at 100,000 iterations. The stored format contains only
`salt:hash`, so it cannot identify an algorithm/version or raise cost opportunistically
without coordinated migration logic.

**Impact.** If the D1 users table is disclosed, modern hardware can test candidate
passwords faster than with a contemporary work factor or memory-hard KDF. The
eight-character minimum further increases the likelihood of guessable credentials.

**Recommendation.** Prefer Argon2id where the runtime and deployment constraints allow
it. Otherwise benchmark and substantially increase PBKDF2-SHA-256 iterations while
staying within Worker CPU limits. Store a versioned format containing algorithm and
cost, and rehash after successful login. Raise the minimum length (while allowing long
passphrases), screen new passwords against known-compromised values, and do not impose
composition rules.

### QM-05 — No explicit browser security-header policy (Medium)

**Evidence.** The global hook resolves responses without adding a Content Security
Policy, `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, or an explicit
Permissions Policy. The deployment configuration also does not define static response
headers.

**Attack scenario.** The application can be framed for clickjacking unless an external
Cloudflare rule supplies protection. If a future injection bug is introduced, the lack
of a restrictive CSP makes exploitation easier. Browser feature and MIME-sniffing
defaults are left to user agents.

**Recommendation.** Add centrally tested headers to document responses and APIs. Start
with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
`X-Content-Type-Options: nosniff`, a conservative `Referrer-Policy`, and a restrictive
Permissions Policy. Roll CSP out in report-only mode first because Svelte styles and
received-message iframe content require deliberate directives/nonces. Configure HSTS
at the custom domain/Cloudflare edge after confirming HTTPS-only operation.

### QM-06 — Public webhook buffers the body before applying a size policy (Low)

**Evidence.** The unauthenticated webhook route calls `request.text()` before signature
verification and defines no application-specific Content-Length or decoded-body limit.
The platform's request limits remain the only bound.

**Impact.** An attacker can repeatedly send large bodies to a public endpoint, causing
avoidable allocation and HMAC work. This is primarily a cost and availability concern;
the signature check correctly prevents unauthorized mail processing.

**Recommendation.** Reject absent or excessive Content-Length values where practical,
enforce a conservative maximum while reading, and rate-limit malformed/unsigned
requests at the edge. Set the maximum above the largest legitimate provider event and
test attachment-event metadata at that boundary.

## Positive controls observed

- Session and API tokens are generated from cryptographic randomness and stored only
  as SHA-256 hashes; session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`.
- API bearer access uses an explicit method/path allowlist and separates read, send,
  and admin scopes. API keys cannot mint keys or change passwords.
- Mail and attachment data-access helpers are passed the authenticated user ID, and
  attachment retrieval verifies both message and attachment ownership.
- Webhook verification authenticates the raw body, checks timestamp freshness, and
  compares signatures without an early-exit byte comparison.
- SQL reviewed in the authentication and mailbox paths uses prepared statements with
  bound values rather than string concatenation.
- Received HTML executes in a sandboxed iframe without `allow-scripts`; external links
  are forced to a new context with `noopener noreferrer`.

## Suggested remediation order

1. Protect first-run setup before the next fresh deployment (QM-01).
2. Add edge and application login throttling (QM-02).
3. Block remote mail content by default (QM-03).
4. Introduce versioned password hashes and tune the KDF (QM-04).
5. Deploy and regression-test browser headers (QM-05).
6. Bound and edge-throttle webhook requests (QM-06).

## Review limitations

This review did not include a deployed Cloudflare configuration, provider accounts,
runtime secrets, third-party penetration testing, fuzzing, DAST, or an authenticated
multi-user test environment. Cloudflare dashboard WAF/rate-limit/header rules may
mitigate findings that are not represented in this repository. Dependency advisory
coverage also depends on registry audit availability and should be run in CI.
