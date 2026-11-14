<script lang="ts">
	import { moveDraftStart, parseGuestInput, type EventDraft } from '$lib/calendar/editor';
	import { describeRecurrence, MAX_COUNT, presetFor, repeatPresets, type Frequency, type RepeatPreset } from '$lib/calendar/recurrence';
	import { addDays, weekday, weekdayName } from '$lib/calendar/time';
	import { ALL_DAY_REMINDERS, MAX_REMINDERS, reminderLabel, TIMED_REMINDERS, type AttendeeStatus, type CalendarInfo } from '$lib/calendar/types';
	import Icon from '../Icon.svelte';

	let {
		draft,
		calendars,
		timeZone,
		busy = false,
		error = '',
		defaultReminder = 10,
		onSave,
		onDelete,
		onRespond,
		onClose
	}: {
		draft: EventDraft | null;
		calendars: CalendarInfo[];
		timeZone: string;
		busy?: boolean;
		error?: string;
		defaultReminder?: number | null;
		onSave: (draft: EventDraft) => void;
		onDelete: (draft: EventDraft) => void;
		/** Answer an invitation from someone else. */
		onRespond?: (draft: EventDraft, status: Exclude<AttendeeStatus, 'needs-action'>) => void;
		onClose: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let titleInput = $state<HTMLInputElement>();
	let form = $state<EventDraft | null>(null);
	let guestText = $state('');

	$effect(() => {
		if (draft) {
			form = {
				...draft,
				rule: draft.rule ? { ...draft.rule, byDay: draft.rule.byDay ? [...draft.rule.byDay] : undefined } : null,
				attendees: draft.attendees.map((guest) => ({ ...guest })),
				reminders: [...draft.reminders]
			};
			guestText = '';
			if (!dialog?.open) dialog?.showModal();
			queueMicrotask(() => { if (!draft?.occurrence) titleInput?.focus(); });
		} else if (dialog?.open) {
			dialog.close();
		}
	});

	const presets = $derived(form ? repeatPresets(form.startDate) : []);
	const preset = $derived<RepeatPreset>(form ? presetFor(form.rule, form.startDate) : 'none');
	let customOpen = $state(false);
	const showCustom = $derived(customOpen || preset === 'custom');
	const endsMode = $derived(form?.rule?.count ? 'count' : form?.rule?.until ? 'until' : 'never');
	const calendarColor = $derived(calendars.find((calendar) => calendar.id === form?.calendarId)?.color ?? 'var(--color-accent)');
	const isNew = $derived(!draft?.occurrence);
	/** A subscribed calendar's event: nothing can change. */
	const subscribed = $derived(Boolean(calendars.find((calendar) => calendar.id === draft?.occurrence?.calendarId)?.source_url));
	/** Someone else's invitation: the details are theirs; calendar and reminders are the user's. */
	const invited = $derived(Boolean(draft?.occurrence?.myStatus));
	const locked = $derived(subscribed || invited);
	const writable = $derived(calendars.filter((calendar) => !calendar.source_url || calendar.id === form?.calendarId));
	const reminderChoices = $derived(form?.allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS);
	const newGuests = $derived(form && !invited ? form.attendees.filter((guest) => !draft?.attendees.some((before) => before.email === guest.email)).length : 0);

	const STATUS_ICON: Record<AttendeeStatus, string> = { accepted: 'checkbox-circle-fill', declined: 'close-circle-fill', tentative: 'question-fill', 'needs-action': 'time-line' };
	const STATUS_LABEL: Record<AttendeeStatus, string> = { accepted: 'Going', declined: 'Not going', tentative: 'Maybe', 'needs-action': 'No answer yet' };
	const ANSWERS = [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']] as const;

	function choosePreset(value: string) {
		if (!form) return;
		if (value === 'custom') {
			customOpen = true;
			form.rule = form.rule ?? { freq: 'WEEKLY', interval: 1, byDay: [weekday(form.startDate)] };
			return;
		}
		customOpen = false;
		const chosen = presets.find((item) => item.value === value);
		// Keep how the series ends when switching between repeat patterns.
		form.rule = chosen?.rule ? { ...chosen.rule, count: form.rule?.count, until: form.rule?.until } : null;
		if (form.rule && !form.rule.count) delete form.rule.count;
		if (form.rule && !form.rule.until) delete form.rule.until;
	}

	function setFrequency(freq: Frequency) {
		if (!form?.rule) return;
		form.rule = { freq, interval: form.rule.interval, count: form.rule.count, until: form.rule.until, byDay: freq === 'WEEKLY' ? [weekday(form.startDate)] : undefined };
	}

	function toggleDay(day: number) {
		if (!form?.rule) return;
		const days = form.rule.byDay ?? [weekday(form.startDate)];
		const next = days.includes(day) ? days.filter((value) => value !== day) : [...days, day];
		form.rule.byDay = next.length ? next.sort((a, b) => a - b) : days;
	}

	function setEnds(mode: string) {
		if (!form?.rule) return;
		const rule = { ...form.rule };
		delete rule.count;
		delete rule.until;
		if (mode === 'count') rule.count = 10;
		if (mode === 'until') rule.until = addDays(form.startDate, 30);
		form.rule = rule;
	}

	function changeStart(date: string, time: string) {
		if (!form || !date) return;
		form = moveDraftStart(form, date, time || form.startTime);
	}

	function setAllDay(next: boolean) {
		if (!form) return;
		// Reminder choices differ: minutes before a start vs. mornings before a day.
		if (next !== form.allDay && form.reminders.length) form.reminders = next ? [0] : [defaultReminder ?? 10];
		form.allDay = next;
	}

	function addGuests() {
		if (!form || !guestText.trim()) return;
		const parsed = parseGuestInput(guestText);
		for (const guest of parsed) {
			if (!form.attendees.some((item) => item.email === guest.email)) form.attendees = [...form.attendees, { ...guest, status: 'needs-action' }];
		}
		// Keep text that could not be read so it can be fixed.
		if (parsed.length) guestText = '';
	}

	function guestKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
			if (!guestText.trim()) return;
			event.preventDefault();
			addGuests();
		} else if (event.key === 'Backspace' && !guestText && form?.attendees.length) {
			form.attendees = form.attendees.slice(0, -1);
		}
	}

	function addReminder() {
		if (!form || form.reminders.length >= MAX_REMINDERS) return;
		const unused = reminderChoices.find((choice) => !form!.reminders.includes(choice)) ?? reminderChoices[0];
		form.reminders = [...form.reminders, unused];
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		addGuests();
		if (form && !busy && !subscribed) onSave(form);
	}

	function onKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && form && !busy && !subscribed) {
			event.preventDefault();
			addGuests();
			onSave(form);
		}
	}
</script>

<dialog bind:this={dialog} class="editor" aria-label={isNew ? 'New event' : 'Edit event'} oncancel={(event) => { event.preventDefault(); onClose(); }} onkeydown={onKeydown}>
	{#if form}
		<form onsubmit={submit} style="--ev:{calendarColor}">
			<header>
				<span class="swatch"></span>
				<input bind:this={titleInput} class="title" bind:value={form.title} placeholder="Add title" aria-label="Title" maxlength="300" autocomplete="off" readonly={locked} />
				<button type="button" class="icon-btn" aria-label="Close" onclick={onClose}><Icon name="close-line" size={18} /></button>
			</header>
			{#if subscribed}<p class="notice"><Icon name="lock-line" size={14} />From a subscribed calendar, so it can't be changed here.</p>{/if}

			<fieldset class="details" disabled={locked}>
				<div class="row">
					<Icon name="time-line" size={17} />
					<div class="when">
						<div class="times">
							<span class="label">Starts</span>
							<input type="date" aria-label="Start date" value={form.startDate} onchange={(event) => changeStart(event.currentTarget.value, form!.startTime)} required />
							{#if !form.allDay}<input type="time" aria-label="Start time" step="300" value={form.startTime} onchange={(event) => changeStart(form!.startDate, event.currentTarget.value)} required />{/if}
							<span class="label">Ends</span>
							<input type="date" aria-label="End date" bind:value={form.endDate} min={form.startDate} required />
							{#if !form.allDay}<input type="time" aria-label="End time" step="300" bind:value={form.endTime} required />{/if}
						</div>
						{#if !locked}<label class="toggle"><input type="checkbox" role="switch" class="switch" checked={form.allDay} onchange={(event) => setAllDay(event.currentTarget.checked)} /> All day</label>{/if}
						{#if form.timeZone !== timeZone && !form.allDay}
							<p class="hint">Times shown in {timeZone.replaceAll('_', ' ')}; repeats follow {form.timeZone.replaceAll('_', ' ')}.</p>
						{/if}
					</div>
				</div>

				{#if !locked || form.rule}
					<div class="row">
						<Icon name="repeat-line" size={17} />
						<div class="repeat">
							{#if locked}
								<span class="static">{form.rule ? describeRecurrence(form.rule, form.startDate) : ''}</span>
							{:else}
								<select aria-label="Repeat" value={showCustom ? 'custom' : preset} onchange={(event) => choosePreset(event.currentTarget.value)}>
									{#each presets as item (item.value)}<option value={item.value}>{item.label}</option>{/each}
									<option value="custom">Custom…</option>
								</select>
							{/if}
							{#if form.rule && showCustom && !locked}
								<div class="custom">
									<label class="inline">Every
										<input type="number" min="1" max="999" aria-label="Repeat interval" value={form.rule.interval} onchange={(event) => { const n = Math.max(1, Math.min(999, Math.floor(Number(event.currentTarget.value)) || 1)); form!.rule = { ...form!.rule!, interval: n }; }} />
										<select aria-label="Repeat unit" value={form.rule.freq} onchange={(event) => setFrequency(event.currentTarget.value as Frequency)}>
											<option value="DAILY">{form.rule.interval === 1 ? 'day' : 'days'}</option>
											<option value="WEEKLY">{form.rule.interval === 1 ? 'week' : 'weeks'}</option>
											<option value="MONTHLY">{form.rule.interval === 1 ? 'month' : 'months'}</option>
											<option value="YEARLY">{form.rule.interval === 1 ? 'year' : 'years'}</option>
										</select>
									</label>
									{#if form.rule.freq === 'WEEKLY'}
										<div class="days" role="group" aria-label="Repeat on">
											{#each [0, 1, 2, 3, 4, 5, 6] as day (day)}
												{@const on = (form.rule.byDay ?? [weekday(form.startDate)]).includes(day)}
												<button type="button" class:on aria-pressed={on} aria-label={weekdayName(day)} onclick={() => toggleDay(day)}>{weekdayName(day, 'narrow')}</button>
											{/each}
										</div>
									{/if}
									<div class="ends">
										<span>Ends</span>
										<select aria-label="Ends" value={endsMode} onchange={(event) => setEnds(event.currentTarget.value)}>
											<option value="never">Never</option>
											<option value="until">On date</option>
											<option value="count">After</option>
										</select>
										{#if form.rule.until}<input type="date" aria-label="Last date" min={form.startDate} value={form.rule.until} onchange={(event) => { if (event.currentTarget.value) form!.rule = { ...form!.rule!, until: event.currentTarget.value }; }} />{/if}
										{#if form.rule.count}<input type="number" min="1" max={MAX_COUNT} aria-label="Occurrences" value={form.rule.count} onchange={(event) => { const n = Math.max(1, Math.min(MAX_COUNT, Math.floor(Number(event.currentTarget.value)) || 1)); form!.rule = { ...form!.rule!, count: n }; }} /><span>times</span>{/if}
									</div>
								</div>
							{/if}
							{#if form.rule && showCustom && !locked}<p class="hint">{describeRecurrence(form.rule, form.startDate)}</p>{/if}
						</div>
					</div>
				{/if}

				{#if !locked || form.location}
					<div class="row">
						<Icon name="map-pin-line" size={17} />
						<input class="plain" bind:value={form.location} placeholder="Add location" aria-label="Location" maxlength="500" />
					</div>
				{/if}

				{#if !locked || form.description}
					<div class="row top">
						<Icon name="align-left" size={17} />
						<textarea class="plain" bind:value={form.description} placeholder="Add description" aria-label="Description" rows="3" maxlength="10000"></textarea>
					</div>
				{/if}
			</fieldset>

			{#if invited && draft?.occurrence}
				{@const occurrence = draft.occurrence}
				<div class="row">
					<Icon name="mail-line" size={17} />
					<div class="rsvp">
						<span>{occurrence.organizer?.name ?? occurrence.organizer?.email ?? 'The organizer'} invited you · Going?</span>
						<div class="answers" role="group" aria-label="Your answer">
							{#each ANSWERS as [value, label] (value)}
								<button type="button" class:on={occurrence.myStatus === value} aria-pressed={occurrence.myStatus === value} disabled={busy} onclick={() => onRespond?.(form!, value)}>{label}</button>
							{/each}
						</div>
					</div>
				</div>
			{/if}

			{#if !subscribed}
				{#if !invited || form.attendees.length}
					<div class="row top">
						<Icon name="group-line" size={17} />
						<div class="guests">
							{#if form.attendees.length}
								<ul>
									{#each form.attendees as guest (guest.email)}
										<li title={`${guest.email} · ${STATUS_LABEL[guest.status]}`}>
											<span class="status {guest.status}" role="img" aria-label={STATUS_LABEL[guest.status]}><Icon name={STATUS_ICON[guest.status]} size={14} /></span>
											<span class="who">{guest.name ?? guest.email}</span>
											{#if !invited}<button type="button" class="remove" aria-label={`Remove ${guest.email}`} onclick={() => (form!.attendees = form!.attendees.filter((item) => item.email !== guest.email))}><Icon name="close-line" size={14} /></button>{/if}
										</li>
									{/each}
								</ul>
							{/if}
							{#if !invited}
								<input class="plain" bind:value={guestText} onkeydown={guestKeydown} onblur={addGuests} placeholder={form.attendees.length ? 'Add more guests' : 'Add guests'} aria-label="Add guests by email" autocomplete="email" inputmode="email" />
								{#if newGuests}<p class="hint">Saving emails an invitation to {newGuests === 1 ? 'the new guest' : `${newGuests} new guests`}.</p>
								{:else if !isNew && form.attendees.length}<p class="hint">Guests get an email when the time or details change.</p>{/if}
							{/if}
						</div>
					</div>
				{/if}

				<div class="row top">
					<Icon name="notification-3-line" size={17} />
					<div class="reminders">
						{#each form.reminders as minutes, index (index)}
							<div class="reminder">
								<select aria-label="Reminder" value={minutes} onchange={(event) => { form!.reminders[index] = Number(event.currentTarget.value); }}>
									{#each reminderChoices.includes(minutes) ? reminderChoices : [minutes, ...reminderChoices] as choice (choice)}<option value={choice}>{reminderLabel(choice, form.allDay)}</option>{/each}
								</select>
								<button type="button" class="remove" aria-label="Remove reminder" onclick={() => (form!.reminders = form!.reminders.filter((_, i) => i !== index))}><Icon name="close-line" size={15} /></button>
							</div>
						{/each}
						{#if form.reminders.length < MAX_REMINDERS}<button type="button" class="link" onclick={addReminder}>{form.reminders.length ? 'Add another reminder' : 'Add reminder'}</button>{/if}
					</div>
				</div>

				<div class="row">
					<Icon name="calendar-line" size={17} />
					<select aria-label="Calendar" bind:value={form.calendarId}>
						{#each writable as calendar (calendar.id)}<option value={calendar.id}>{calendar.name}</option>{/each}
					</select>
				</div>
			{/if}

			{#if error}<p class="error" role="alert">{error}</p>{/if}

			<footer>
				{#if subscribed}
					<span class="spacer"></span>
					<button type="button" class="btn-primary" onclick={onClose}>Close</button>
				{:else}
					{#if !isNew}
						<button type="button" class="btn-ghost danger" disabled={busy} onclick={() => onDelete(form!)}><Icon name="delete-bin-line" size={16} />{invited ? 'Remove' : 'Delete'}</button>
					{/if}
					<span class="spacer"></span>
					<button type="button" class="btn-ghost" onclick={onClose}>Cancel</button>
					<button type="submit" class="btn-primary" disabled={busy}>{busy ? 'Saving…' : newGuests ? 'Save & invite' : 'Save'}</button>
				{/if}
			</footer>
		</form>
	{/if}
</dialog>

<style>
	.editor { width: min(34rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 0; border: 1px solid var(--color-line); border-radius: 18px; background: var(--color-surface); color: var(--color-text); box-shadow: var(--mat-float); overflow: auto; }
	.editor::backdrop { background: rgb(0 0 0 / 35%); backdrop-filter: blur(3px); }
	form { display: flex; flex-direction: column; gap: 0.25rem; padding: 1rem 1.25rem 1.1rem; }
	header { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
	.swatch { flex-shrink: 0; width: 0.85rem; height: 0.85rem; border-radius: 4px; background: var(--ev); }
	.title { flex: 1; min-width: 0; padding: 0.4rem 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; background: transparent; border-bottom: 2px solid var(--color-line); outline: none; }
	.title:focus { border-color: var(--ev); }
	.title:read-only { border-bottom-color: transparent; }
	.details { display: contents; }
	.details:disabled input, .details:disabled select, .details:disabled textarea { opacity: 1; color: var(--color-text); -webkit-text-fill-color: var(--color-text); background: transparent; padding-left: 0; resize: none; }
	.details:disabled input::-webkit-calendar-picker-indicator { display: none; }
	.row { display: flex; align-items: center; gap: 0.85rem; min-height: 2.75rem; color: var(--color-muted); }
	.row.top { align-items: flex-start; }
	.row.top > :global(i) { margin-top: 0.6rem; }
	.row > :global(i) { flex-shrink: 0; }
	.when, .repeat { flex: 1; display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; padding: 0.35rem 0; }
	.times { display: grid; grid-template-columns: 2.75rem 9.5rem 7.5rem; justify-content: start; align-items: center; gap: 0.35rem 0.5rem; }
	.times .label { font-size: 0.75rem; color: var(--color-text-secondary); min-width: 2.75rem; }
	.static { font-size: 0.875rem; color: var(--color-text); }
	input[type='date'], input[type='time'], input[type='number'], select { min-height: 2.25rem; padding: 0 0.55rem; border-radius: 9px; font-size: 0.8125rem; color: var(--color-text); background: var(--color-well); border: 1px solid transparent; }
	input[type='date']:focus, input[type='time']:focus, input[type='number']:focus, select:focus { border-color: var(--color-focus-line); outline: none; }
	input[type='number'] { width: 4.25rem; }
	select { flex: 0 1 auto; max-width: 100%; }
	.row > select { flex: 1; }
	.toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.plain { flex: 1; min-width: 0; padding: 0.55rem 0.65rem; border-radius: 9px; font-size: 0.875rem; color: var(--color-text); background: var(--color-well); outline: none; border: 1px solid transparent; resize: vertical; }
	.plain:focus { border-color: var(--color-focus-line); }
	textarea.plain { font-family: inherit; line-height: 1.5; }
	.custom { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.65rem; border-radius: 12px; background: var(--color-surface-muted); color: var(--color-text-secondary); font-size: 0.8125rem; }
	.custom input, .custom select { background: var(--color-surface); }
	.inline, .ends { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
	.days { display: flex; gap: 0.3rem; }
	.days button { width: 2rem; height: 2rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; color: var(--color-text-secondary); background: var(--color-surface); box-shadow: var(--mat-cap); }
	.days button.on { background: var(--color-accent); color: var(--color-on-accent); box-shadow: var(--mat-cap-accent); }
	.hint { font-size: 0.75rem; color: var(--color-muted); }
	.notice { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.25rem; padding: 0.45rem 0.65rem; border-radius: 10px; font-size: 0.8125rem; color: var(--color-text-secondary); background: var(--color-surface-muted); }
	.rsvp { flex: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0; font-size: 0.8125rem; color: var(--color-text-secondary); }
	.answers { display: flex; gap: 0.3rem; }
	.answers button { min-height: 2rem; padding: 0 0.85rem; border-radius: 999px; font-size: 0.8125rem; font-weight: 500; color: var(--color-text); background: var(--color-surface-muted); }
	.answers button:hover { background: var(--color-surface-hover); }
	.answers button.on { color: var(--color-on-accent); background: var(--color-accent); }
	.guests, .reminders { flex: 1; display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; padding: 0.35rem 0; }
	.guests ul { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.guests li { display: flex; align-items: center; gap: 0.3rem; max-width: 100%; min-height: 1.9rem; padding: 0.1rem 0.25rem 0.1rem 0.45rem; border-radius: 999px; font-size: 0.8125rem; color: var(--color-text); background: var(--color-surface-muted); }
	.who { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.status { display: grid; place-items: center; color: var(--color-muted); }
	.status.accepted { color: #2f8a4c; }
	.status.declined { color: var(--color-danger); }
	.status.tentative { color: #b7861a; }
	.remove { display: grid; place-items: center; flex-shrink: 0; width: 1.6rem; height: 1.6rem; border-radius: 999px; color: var(--color-muted); }
	.remove:hover { color: var(--color-text); background: var(--color-surface-hover); }
	.reminder { display: flex; align-items: center; gap: 0.25rem; }
	.link { align-self: flex-start; min-height: 2rem; padding: 0 0.15rem; font-size: 0.8125rem; font-weight: 500; color: var(--color-accent-text); }
	.link:hover { text-decoration: underline; }
	.error { margin-top: 0.25rem; padding: 0.5rem 0.75rem; border-radius: 10px; font-size: 0.8125rem; color: var(--tone-bad-fg); background: var(--tone-bad-bg); }
	footer { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
	.spacer { flex: 1; }
	.danger { color: var(--color-danger); }
	@media (max-width: 640px) {
		.editor { width: 100vw; max-width: none; max-height: 92dvh; margin: auto 0 0; border-radius: 18px 18px 0 0; border-bottom: 0; }
		form { padding: 0.85rem 1rem calc(1rem + env(safe-area-inset-bottom)); }
		input[type='date'], input[type='time'] { font-size: 1rem; padding: 0 0.4rem; }
		.times { grid-template-columns: 2.5rem minmax(0, 1.15fr) minmax(0, 1fr); justify-content: stretch; }
		.plain, .title, select { font-size: 1rem; }
	}
</style>
