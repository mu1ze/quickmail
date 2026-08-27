/** True when a keypress is meant for the focused field, not the mailbox. */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!target || typeof HTMLElement === 'undefined') return false;
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	return Boolean(target.closest('[contenteditable="true"], [role="textbox"]'));
}

export function isMod(event: KeyboardEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

let goUntil = 0;

/** Start a `g` chord so the next key can jump to a mailbox. */
export function armGoChord(ms = 800): void {
	goUntil = Date.now() + ms;
}

export function isGoChordArmed(): boolean {
	return Date.now() < goUntil;
}

/** True when a `g` chord was waiting. Always clears the chord. */
export function consumeGoChord(): boolean {
	const armed = isGoChordArmed();
	goUntil = 0;
	return armed;
}

export type Shortcut = {
	keys: string;
	action: string;
	group: 'Move' | 'Act' | 'Jump' | 'Write';
};

/** The handful Superhuman/Gmail users actually remember. The rest live in the palette. */
export const SHORTCUTS: Shortcut[] = [
	{ keys: 'j / k', action: 'Newer / older conversation', group: 'Move' },
	{ keys: 'Enter', action: 'Open', group: 'Move' },
	{ keys: 'x', action: 'Select', group: 'Move' },
	{ keys: '/', action: 'Search', group: 'Move' },
	{ keys: '⌘K', action: 'Command palette', group: 'Move' },
	{ keys: 'e', action: 'Move to trash', group: 'Act' },
	{ keys: 's', action: 'Star', group: 'Act' },
	{ keys: 'u', action: 'Mark unread', group: 'Act' },
	{ keys: 'b', action: 'Snooze', group: 'Act' },
	{ keys: 'z', action: 'Undo', group: 'Act' },
	{ keys: 'c', action: 'Compose', group: 'Write' },
	{ keys: 'r', action: 'Reply', group: 'Write' },
	{ keys: 'a', action: 'Reply all', group: 'Write' },
	{ keys: '⌘Enter', action: 'Send', group: 'Write' },
	{ keys: 'g i', action: 'Go to inbox', group: 'Jump' },
	{ keys: 'g s', action: 'Go to starred', group: 'Jump' },
	{ keys: 'g d', action: 'Go to drafts', group: 'Jump' },
	{ keys: 'g t', action: 'Go to sent', group: 'Jump' },
	{ keys: 'g b', action: 'Go to later', group: 'Jump' },
	{ keys: 'g e', action: 'Go to trash', group: 'Jump' },
	{ keys: '?', action: 'This list', group: 'Jump' }
];
