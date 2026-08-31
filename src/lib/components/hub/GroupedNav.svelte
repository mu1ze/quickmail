<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	export type HubLink = {
		href: string;
		label: string;
		icon?: string;
		detail?: string;
	};

	let {
		links,
		footer
	}: {
		links: HubLink[];
		footer?: string;
	} = $props();
</script>

<nav class="group" aria-label="Sections">
	<ul class="group-list">
		{#each links as link (link.href)}
			<li>
				<a class="group-row" href={link.href}>
					{#if link.icon}
						<span class="group-icon" aria-hidden="true">
							<Icon name={link.icon} size={18} />
						</span>
					{/if}
					<span class="group-label">{link.label}</span>
					{#if link.detail}
						<span class="group-detail">{link.detail}</span>
					{/if}
					<span class="group-chevron" aria-hidden="true">
						<Icon name="arrow-right-s-line" size={18} />
					</span>
				</a>
			</li>
		{/each}
	</ul>
	{#if footer}
		<p class="group-footer">{footer}</p>
	{/if}
</nav>

<style>
	.group + .group {
		margin-top: 1.5rem;
	}

	.group-list {
		margin: 0;
		padding: 0;
		list-style: none;
		border-radius: 14px;
		overflow: hidden;
		background: var(--color-surface);
		box-shadow: var(--mat-panel);
	}

	.group-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 2.875rem;
		padding: 0.625rem 0.875rem;
		color: inherit;
		text-decoration: none;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.group-list li:last-child .group-row {
		box-shadow: none;
	}

	.group-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		background: var(--color-well);
	}

	.group-label {
		flex: 1;
		min-width: 0;
		font-size: 1rem;
		font-weight: 400;
	}

	.group-detail {
		flex-shrink: 0;
		font-size: 0.9375rem;
		color: var(--color-muted);
	}

	.group-chevron {
		flex-shrink: 0;
		color: var(--color-muted);
	}

	.group-footer {
		margin: 0.5rem 0.875rem 0;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--color-muted);
	}
</style>
