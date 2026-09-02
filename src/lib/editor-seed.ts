/** Write html into a contenteditable once. Empty html still counts as seeded. */
export function seedEditor(
	editor: { innerHTML: string } | null,
	html: string,
	seeded: boolean
): boolean {
	if (!editor || seeded) return seeded;
	editor.innerHTML = html;
	return true;
}
