import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			config: 'wrangler.jsonc',
			platformProxy: {
				configPath: 'wrangler.jsonc',
				persist: { path: '.wrangler/state/v3' },
				// Local dev/preview emulation only (never runs in production).
				// The `send_email` binding is `remote: true`, which makes the
				// platform proxy open a remote Cloudflare session that needs auth
				// (CLOUDFLARE_API_TOKEN or `wrangler login`). Set
				// QUICKMAIL_LOCAL_BINDINGS=1 to emulate remote bindings locally so
				// `vite dev` runs offline without Cloudflare credentials.
				remoteBindings: process.env.QUICKMAIL_LOCAL_BINDINGS ? false : undefined
			}
		})
	}
};

export default config;
