<script lang="ts">
	import HubShell from '$lib/components/hub/HubShell.svelte';
	import DesktopNotifications from '$lib/components/DesktopNotifications.svelte';
	import BrrrNotifications from '$lib/components/BrrrNotifications.svelte';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();
</script>

<svelte:head>
	<title>Notifications — Settings</title>
</svelte:head>

<HubShell title="Notifications" backHref="/settings">
	<DesktopNotifications configured={data.push.configured} publicKey={data.push.publicKey} embedded />
	<div class="stack-gap"></div>
	<BrrrNotifications initial={data.brrr} sounds={data.brrrSounds} embedded />
</HubShell>

<style>
	.stack-gap {
		height: 1.25rem;
	}
</style>
