import { getContext, setContext } from 'svelte';

export type ShellContext = {
	openNav: () => void;
	focusSearch: () => void;
};

const KEY = Symbol('shell');

export function setShellContext(ctx: ShellContext) {
	setContext(KEY, ctx);
}

export function getShellContext(): ShellContext | undefined {
	return getContext<ShellContext>(KEY);
}
