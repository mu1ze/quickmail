import { readBoundedBody } from '$lib/server/request-limits';
import { reserveRequestQuota } from '$lib/server/request-quota';
import { redirect, type Handle } from '@sveltejs/kit';
import { authorizeApiRequest } from '$lib/server/api-access';
import { getUserByApiToken, readBearerToken } from '$lib/server/api-tokens';
import { countUsers, getUserFromSession, readSessionToken } from '$lib/server/auth';
import { DOMAIN_COOKIE } from '$lib/server/constants';
import {
	domainIsVisibleToUser,
	listDomainPermissionRows,
	permissionMapForUser
} from '$lib/server/domain-permissions';
import { listAddressesForUser, listDomains } from '$lib/server/domains';

const PUBLIC_PREFIXES = [
	'/login',
	'/recover',
	'/setup',
	'/api/auth',
	'/api/setup',
	'/api/webhooks',
	'/install.sh',
	'/s'
];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function jsonError(error: string, status: number): Response {
	return secureResponse(
		new Response(JSON.stringify({ error }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		})
	);
}

const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline' https:",
	"img-src 'self' data: blob: https:",
	"font-src 'self' data: https:",
	"media-src 'self' data: blob: https:",
	"connect-src 'self'",
	"frame-src 'self' data: blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	'upgrade-insecure-requests'
].join('; ');

function secureResponse(response: Response): Response {
	const contentType = response.headers.get('Content-Type') ?? '';
	if (!response.headers.has('Cache-Control') && /text\/html|application\/json/.test(contentType)) {
		response.headers.set('Cache-Control', 'private, no-store');
	}
	if (!response.headers.has('Content-Security-Policy')) {
		response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
	}
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=(), payment=()'
	);
	return response;
}

export const handle: Handle = async ({ event, resolve }) => {
	const db = event.platform?.env.DB;
	event.locals.user = null;
	event.locals.authMethod = null;
	event.locals.apiScopes = [];
	event.locals.apiTokenId = null;
	event.locals.domains = [];
	event.locals.domainPermissions = {};
	event.locals.addresses = [];
	event.locals.activeDomainId = null;

	const { pathname } = event.url;
	// Session mutations must originate in this app, including requests with no Content-Type.
	if (
		pathname.startsWith('/api/') &&
		!pathname.startsWith('/api/webhooks/') &&
		!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)
	) {
		const bearer = readBearerToken(event.request);
		if (
			(!bearer || readSessionToken(event.cookies)) &&
			event.request.headers.get('origin') !== event.url.origin
		) {
			return jsonError('Cross-origin request rejected', 403);
		}
	}

	if (db) {
		const session = readSessionToken(event.cookies);
		event.locals.user = await getUserFromSession(db, session);
		if (event.locals.user) {
			event.locals.authMethod = 'session';
		} else if (pathname.startsWith('/api/')) {
			const bearer = readBearerToken(event.request);
			if (bearer) {
				const auth = await getUserByApiToken(db, bearer);
				if (auth) {
					event.locals.user = auth.user;
					event.locals.authMethod = 'api_token';
					event.locals.apiScopes = auth.scopes;
					event.locals.apiTokenId = auth.tokenId;
				}
			}
		}
	}

	// A stale tab must not read or mutate another account after a cookie switch.
	const expectedAccount = event.request.headers.get('X-QuickMail-Account');
	if (
		expectedAccount &&
		event.locals.authMethod !== 'api_token' &&
		expectedAccount !== event.locals.user?.id
	) {
		const response = jsonError('Your active account changed. Reload to continue.', 409);
		response.headers.set('X-QuickMail-Account-Changed', '1');
		return response;
	}

	if (
		pathname.startsWith('/api/') &&
		!pathname.startsWith('/api/webhooks/') &&
		!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)
	) {
		const contentType = event.request.headers
			.get('content-type')
			?.split(';')[0]
			.trim()
			.toLowerCase();
		const upload = pathname === '/api/signature-assets';
		if (event.request.body && contentType !== (upload ? 'multipart/form-data' : 'application/json'))
			return jsonError('Unsupported request content type', 415);
		const large =
			pathname === '/api/mail' ||
			pathname === '/api/drafts' ||
			/^\/api\/mail\/[^/]+$/.test(pathname);
		const limit = upload ? 1100000 : large ? 12000000 : 65536;
		const declared = Number(event.request.headers.get('content-length') ?? 0);
		if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)
			return jsonError('Request body too large', 413);
		if (db && event.locals.user && (large || upload)) {
			if (
				!(await reserveRequestQuota(
					db,
					event.locals.user.id,
					pathname === '/api/drafts'
						? 'draft'
						: large
							? event.request.method === 'POST'
								? 'mail'
								: 'mutation'
							: 'upload'
				))
			)
				return jsonError('Hourly request limit reached. Try again later.', 429);
		}
		try {
			if (event.request.body) {
				const bytes = await readBoundedBody(event.request.body, limit);
				if (!upload && bytes.length) {
					let data: Record<string, unknown>;
					try {
						data = JSON.parse(new TextDecoder().decode(bytes));
					} catch {
						return jsonError('Invalid JSON', 400);
					}
					if (!data || typeof data !== 'object' || Array.isArray(data))
						return jsonError('Expected a JSON object', 400);
					if (large) {
						for (const key of [
							'to',
							'cc',
							'bcc',
							'subject',
							'text',
							'html',
							'fromAddressId',
							'id',
							'draftId'
						]) {
							if (data[key] !== undefined && typeof data[key] !== 'string')
								return jsonError('Invalid message field', 400);
							if (typeof data[key] === 'string' && data[key].length > 256000)
								return jsonError('Message field too large', 413);
						}
						for (const key of [
							'isRead',
							'isStarred',
							'isPinned',
							'isArchived',
							'isSpam',
							'trashed',
							'messageOnly'
						])
							if (data[key] !== undefined && typeof data[key] !== 'boolean')
								return jsonError('Invalid message flag', 400);
						if (
							['to', 'cc', 'bcc'].reduce(
								(n, key) =>
									n +
									(typeof data[key] === 'string' ? data[key].split(',').filter(Boolean).length : 0),
								0
							) > 100
						)
							return jsonError('Too many recipients', 400);
					}
				}
				event.request = new Request(event.request, { body: bytes });
			}
		} catch {
			return jsonError('Request body too large', 413);
		}
	}

	// Webhooks authenticate with a signature, not a session.
	if (pathname.startsWith('/api/webhooks/')) {
		return secureResponse(await resolve(event));
	}

	if (
		db &&
		event.locals.user &&
		(!pathname.startsWith('/api/') ||
			/^\/api\/(mail|drafts|addresses|domains)(?:\/|$)/.test(pathname))
	) {
		const [allDomains, addresses, permissionRows] = await Promise.all([
			listDomains(db),
			listAddressesForUser(db, event.locals.user.id),
			event.locals.user.is_admin
				? Promise.resolve(new Map())
				: listDomainPermissionRows(db, event.locals.user.id)
		]);

		const domainPermissions = permissionMapForUser(event.locals.user, allDomains, permissionRows);
		const ownedDomainIds = new Set(addresses.map((address) => address.domain_id));

		event.locals.domainPermissions = domainPermissions;
		event.locals.addresses = addresses;
		event.locals.domains = event.locals.user.is_admin
			? allDomains
			: allDomains.filter((domain) =>
					domainIsVisibleToUser(domain.id, domainPermissions[domain.id], ownedDomainIds)
				);

		// Scripts pass `?domain=`; the dashboard uses a cookie.
		const requested = pathname.startsWith('/api/')
			? event.url.searchParams.get('domain')
			: event.cookies.get(DOMAIN_COOKIE);
		event.locals.activeDomainId =
			requested && event.locals.domains.some((domain) => domain.id === requested)
				? requested
				: null;
	}

	if (pathname.startsWith('/api/')) {
		if (isPublicPath(pathname)) {
			return secureResponse(await resolve(event));
		}
		if (!event.locals.user || !event.locals.authMethod) {
			return jsonError('Unauthorized', 401);
		}

		const access = authorizeApiRequest({
			pathname,
			method: event.request.method,
			authMethod: event.locals.authMethod,
			scopes: event.locals.apiScopes
		});
		if (!access.ok) {
			return jsonError(access.error, access.status);
		}

		return secureResponse(await resolve(event));
	}

	const needsSetup = db ? (await countUsers(db)) === 0 : false;

	if (needsSetup && pathname !== '/setup' && pathname !== '/install.sh') {
		throw redirect(303, '/setup');
	}

	if (pathname === '/setup') {
		if (!needsSetup && event.locals.user) {
			throw redirect(303, '/inbox');
		}
		if (!needsSetup && !event.locals.user) {
			throw redirect(303, '/login');
		}
		return secureResponse(await resolve(event));
	}

	if (pathname === '/login' || pathname === '/recover') {
		if (event.locals.user && event.url.searchParams.get('add') !== '1') {
			throw redirect(303, pathname === '/recover' ? '/settings' : '/inbox');
		}
		return secureResponse(await resolve(event));
	}

	if (isPublicPath(pathname)) {
		return secureResponse(await resolve(event));
	}

	if (!event.locals.user) {
		throw redirect(303, '/login');
	}

	// Nothing works until a provider domain is connected and the user owns an
	// address on it, so send them through onboarding first.
	const needsOnboarding = event.locals.domains.length === 0 || event.locals.addresses.length === 0;

	if (needsOnboarding && pathname !== '/onboarding') {
		throw redirect(303, '/onboarding');
	}

	if (!needsOnboarding && pathname === '/onboarding') {
		throw redirect(303, '/inbox');
	}

	if (pathname.startsWith('/admin') && !event.locals.user.is_admin) {
		throw redirect(303, '/inbox');
	}

	return secureResponse(await resolve(event));
};
