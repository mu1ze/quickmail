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

The review originally identified login abuse, remote email resources, password hashing,
browser headers, and webhook request size as the main attack points. Those items are
now mitigated in the repository as described below. The first-run bootstrap route is
explicitly accepted as part of the deployment trust model rather than treated as a
vulnerability.

## Findings

### QM-01 — First-run setup trust assumption (Accepted / not a finding)

**Original evidence.** `/api/setup` is deliberately included in the public route list. Its POST
handler accepts the future administrator's address, name, and password without an
operator-held bootstrap secret. The only gate is `countUsers(db) === 0`; after that
check, it creates an administrator and signs the caller in.

**Disposition.** The operator explicitly accepts this behavior: control of the
Cloudflare account and deployment URL is the trust boundary, and setup is completed as
part of deployment. No code change is planned. Operators should still complete setup
immediately and keep the Cloudflare account protected with strong MFA.

### QM-02 — Login abuse controls (Remediated)

**Original evidence.** The public login POST accepted an unlimited sequence of email/password
pairs and ran password verification for every request to an existing account. There
was no per-IP, per-account, or global failure counter, delay, lockout, CAPTCHA, or
Cloudflare rate-limit binding in the repository.

**Attack scenario.** An attacker can perform online password guessing against known
mail addresses. Requests for valid users also invoke PBKDF2, so parallel attempts can
consume Worker CPU and provide an inexpensive denial-of-service vector. The endpoint's
generic error is good practice and prevents direct account enumeration, but it does
not mitigate guessing or resource exhaustion.

**Remediation.** Failed attempts are now recorded in hashed per-IP and per-account D1
buckets. Account attempts are limited to 10 and IP attempts to 30 in a 15-minute
window; limited requests receive `429` and `Retry-After`, successful authentication
clears the account bucket, and stale rows are cleaned opportunistically. A Cloudflare
WAF rule remains useful as defense in depth.

### QM-03 — Sender-controlled remote resources (Remediated)

**Original evidence.** Received HTML was inserted into an iframe `srcdoc` without URL rewriting
or resource filtering. The iframe blocks scripts but permits normal image, stylesheet,
font, media, and CSS `url()` fetches. Its `referrerpolicy="no-referrer"` suppresses the
Referer header but does not stop the request itself.

**Attack scenario.** A sender embeds a unique remote image URL. Opening the message
requests that URL, confirming the mailbox is active and disclosing open time, IP/network
metadata, and browser characteristics to the sender. Remote CSS can cause further
requests. This is a privacy issue and can improve phishing reconnaissance.

**Remediation.** Received HTML now gets an early iframe-local CSP that permits inline
styles and embedded data/blob media but blocks network resources. Messages containing
remote URL-bearing attributes or CSS show an explicit “Load remote content” control.
The scriptless sandbox and no-referrer policy remain in place.

### QM-04 — Password hashing cost (Remediated)

**Original evidence.** Passwords used PBKDF2-HMAC-SHA-256 with a random 16-byte salt, but the
work factor was fixed at 100,000 iterations. The stored format contained only
`salt:hash`, so it cannot identify an algorithm/version or raise cost opportunistically
without coordinated migration logic.

**Impact.** If the D1 users table is disclosed, modern hardware can test candidate
passwords faster than with a contemporary work factor or memory-hard KDF. The
eight-character minimum further increases the likelihood of guessable credentials.

**Remediation.** New hashes use a versioned PBKDF2-SHA-256 format with 600,000
iterations. Existing 100,000-iteration hashes remain verifiable and are upgraded after
a successful login. New and changed passwords require at least 12 characters.

### QM-05 — Browser security-header policy (Remediated)

**Original evidence.** The global hook resolved responses without adding a Content Security
Policy, `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, or an explicit
Permissions Policy. The deployment configuration also does not define static response
headers.

**Attack scenario.** The application can be framed for clickjacking unless an external
Cloudflare rule supplies protection. If a future injection bug is introduced, the lack
of a restrictive CSP makes exploitation easier. Browser feature and MIME-sniffing
defaults are left to user agents.

**Remediation.** The global server hook now adds an enforcing Content Security Policy
with `frame-ancestors 'none'`, `object-src 'none'`, restricted base/form/connect
directives, and HTTPS upgrades. It also adds `X-Content-Type-Options`, a conservative
referrer policy, and a restrictive Permissions Policy. HSTS remains an edge/custom
domain responsibility so local HTTP development is not accidentally pinned.

### QM-06 — Webhook request size (Remediated)

**Original evidence.** The unauthenticated webhook route called `request.text()` before signature
verification and defined no application-specific Content-Length or decoded-body limit.
The platform's request limits were the only bound.

**Impact.** An attacker can repeatedly send large bodies to a public endpoint, causing
avoidable allocation and HMAC work. This is primarily a cost and availability concern;
the signature check correctly prevents unauthorized mail processing.

**Remediation.** The webhook rejects invalid or declared bodies over 1 MiB before
buffering and verifies the actual UTF-8 byte length after reading to cover chunked or
misdeclared requests. Provider signatures are still checked before event processing.

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

1. Apply migration `0016_login_rate_limits.sql` before deploying the new login route.
2. Regression-test the CSP against production mail templates and provider flows.
3. Consider a Cloudflare WAF login/webhook rule as defense in depth.
4. Consider WebAuthn/TOTP for administrator accounts.

## Review limitations

This review did not include a deployed Cloudflare configuration, provider accounts,
runtime secrets, third-party penetration testing, fuzzing, DAST, or an authenticated
multi-user test environment. Cloudflare dashboard WAF/rate-limit/header rules may
mitigate findings that are not represented in this repository. Dependency advisory
coverage also depends on registry audit availability and should be run in CI.
