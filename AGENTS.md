# AGENTS.md

## Cursor Cloud specific instructions

QuickMail is a self-hosted email web app built with SvelteKit and deployed to
Cloudflare Workers (D1 for data, R2 for attachments). Package manager is `bun`.
Standard scripts live in `package.json`; developer setup is documented in the
`README.md` "Development" section. Notes below cover only the non-obvious,
cloud-environment caveats.

### Running the dev server (important caveat)

- Start the dev server with the local-bindings flag:
  `QUICKMAIL_LOCAL_BINDINGS=1 bun run dev` (Vite dev server on `http://localhost:5173`).
- Why the flag: `wrangler.jsonc` declares a `send_email` binding with
  `remote: true`. The Vite platform proxy would otherwise open a **remote**
  Cloudflare session that requires `CLOUDFLARE_API_TOKEN` (or an interactive
  `wrangler login`), which is unavailable in a headless VM — every route then
  returns HTTP 500. `svelte.config.js` reads `QUICKMAIL_LOCAL_BINDINGS` and,
  when set, emulates remote bindings locally so the app runs offline. Without
  the env var the default behavior is unchanged, so this does not affect the
  maintainer's normal `wrangler login` workflow or production deploys.
- Plain `bun run dev` (no flag) will 500 in this environment — this is expected.

### Local database (D1)

- The app needs the local D1 schema applied before login/account creation works:
  `bun run db:migrate:local`. This is idempotent (already-applied migrations are
  skipped) and writes to `.wrangler/state/v3` (gitignored, not persisted by git).
  Run it if the local DB state is missing or reset. It is intentionally **not**
  part of the automatic startup/update script.
- Inbound email (the `email()` handler) never runs under `vite dev`; it only
  works on a deployed Worker or `bun run preview`. For local development, test
  account creation and **outbound** compose/send flows.

### Lint / test / check

- Tests: `bun run test` (Bun test runner; all pass).
- Type/lint check: `bun run check` (svelte-check). This currently reports a few
  **pre-existing** type errors/warnings (e.g. in `src/lib/interior/FloatingField.svelte`)
  that exist on a clean checkout and are unrelated to environment setup.
- Build: `bun run build` (Vite build + `scripts/wrap-cloudflare-worker.mjs`).

### bun

- `bun` is installed at `~/.bun/bin/bun` and exported via `~/.bashrc`. If a shell
  ever reports `bun: command not found`, use the full path `~/.bun/bin/bun` or
  `export PATH="$HOME/.bun/bin:$PATH"`.
