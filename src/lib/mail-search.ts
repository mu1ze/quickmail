import type { MailboxView } from './types';

export type MailSearch = {
	conditions: string[];
	bindings: string[];
	view?: MailboxView | 'anywhere';
};

const VIEWS: Record<string, MailboxView | 'anywhere'> = {
	inbox: 'inbox', sent: 'sent', drafts: 'drafts', starred: 'starred',
	snoozed: 'later', later: 'later', spam: 'spam', trash: 'trash', all: 'all', anywhere: 'anywhere'
};

function like(value: string): string {
	return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

function validDate(value: string): boolean {
	const parsed = new Date(`${value}T00:00:00Z`);
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Recognized operators become bound SQL predicates; unknown syntax stays literal. */
export function parseMailSearch(query: string): MailSearch {
	const search: MailSearch = { conditions: [], bindings: [] };
	const tokens = query.match(/(?:[^\s"]|"(?:\\.|[^"\\])*")+/g) ?? [];
	for (const raw of tokens) {
		const negated = raw.startsWith('-') && raw.length > 1;
		const token = negated ? raw.slice(1) : raw;
		const match = /^([a-z]+):(.*)$/i.exec(token);
		const operator = match?.[1]?.toLowerCase();
		const unquote = (value: string) => value.replace(/^"|"$/g, '').replace(/\\(["\\])/g, '$1');
		const value = unquote(match?.[2] ?? token);
		let condition = '';
		const bindings: string[] = [];
		if (value && (operator === 'from' || operator === 'to' || operator === 'subject')) {
			if (operator === 'to') {
				condition = "(e.to_addr LIKE ? ESCAPE '\\' OR COALESCE(e.cc_addr, '') LIKE ? ESCAPE '\\' OR COALESCE(e.bcc_addr, '') LIKE ? ESCAPE '\\')";
				bindings.push(like(value), like(value), like(value));
			} else {
				condition = `e.${operator === 'from' ? 'from_addr' : 'subject'} LIKE ? ESCAPE '\\'`;
				bindings.push(like(value));
			}
		} else if (operator === 'is' && ['unread', 'read', 'starred', 'pinned', 'archived'].includes(value)) {
			condition = { unread: 'e.is_read = 0', read: 'e.is_read = 1', starred: 'e.is_starred = 1', pinned: 'e.is_pinned = 1', archived: 'e.is_archived = 1' }[value]!;
		} else if (operator === 'has' && value === 'attachment') {
			condition = 'EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id)';
		} else if (operator === 'filename' && value) {
			condition = "EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id AND a.filename LIKE ? ESCAPE '\\')";
			bindings.push(like(value));
		} else if ((operator === 'after' || operator === 'before') && validDate(value)) {
			condition = `datetime(e.created_at) ${operator === 'after' ? '>=' : '<'} datetime(?)`;
			bindings.push(value);
		} else if (operator === 'in' && VIEWS[value] && !negated) {
			search.view = VIEWS[value];
			continue;
		} else {
			const literal = unquote(token);
			condition = "(e.subject LIKE ? ESCAPE '\\' OR e.from_addr LIKE ? ESCAPE '\\' OR e.to_addr LIKE ? ESCAPE '\\' OR COALESCE(e.body_text, e.body_html, '') LIKE ? ESCAPE '\\')";
			bindings.push(...Array<string>(4).fill(like(literal)));
		}
		search.conditions.push(negated ? `NOT (${condition})` : `(${condition})`);
		search.bindings.push(...bindings);
	}
	return search;
}

export function searchValue(value: string): string {
	return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
