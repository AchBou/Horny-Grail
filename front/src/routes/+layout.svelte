<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { NEUTRAL_ICON, NEUTRAL_TITLE, hideNow, loadPrivacy, privacy, setDiscreet, unhide } from '$lib/privacy.svelte.js';

	let { children } = $props();

	const onAccessPage = $derived(page.url.pathname.startsWith('/access'));
	// Random follows the tag filter you are browsing with. Browse changes its filter with shallow
	// routing, which page.url does not follow, so read the address bar at click time.
	/** @param {MouseEvent} event */
	function openRandom(event) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const { pathname, search } = window.location;
		if (pathname !== '/browse' && !pathname.startsWith('/image/')) return;
		event.preventDefault();
		goto(`/random${search}`);
	}
	const section = $derived(page.url.pathname.startsWith('/random') ? 'random' : page.url.pathname.startsWith('/browse') || page.url.pathname.startsWith('/image/') ? 'browse' : '');

	let originalIcons = [];

	onMount(() => {
		loadPrivacy();
		originalIcons = [...document.querySelectorAll('link[rel~="icon"]')].map((link) => [link, link.getAttribute('href')]);
	});

	// Tab title and icon: neutral in discreet mode and while hidden.
	$effect(() => {
		const neutral = privacy.discreet || privacy.hidden;
		document.title = neutral ? NEUTRAL_TITLE : 'The Horny Grail';
		for (const [link, href] of originalIcons) link.setAttribute('href', neutral ? NEUTRAL_ICON : href);
	});

	/** @param {KeyboardEvent} event */
	function onKeydown(event) {
		if (event.key !== 'b' && event.key !== 'B') return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const target = /** @type {HTMLElement} */ (event.target);
		if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
		event.preventDefault();
		if (privacy.hidden) unhide();
		else hideNow();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<header>
	<a href="/browse" class="title-link" aria-label="Home">
		{#if privacy.discreet}
			<span class="wordmark neutral">Gallery</span>
		{:else}
			<img class="logo-mark" src="/brand/horny-grail-public.svg" alt="" width="40" height="40" />
			<h1 class="wordmark">THE HORNY GRAIL</h1>
		{/if}
	</a>

	{#if !onAccessPage}
		<nav class="main-nav" aria-label="Main">
			<a href="/browse" class:active={section === 'browse'}>Browse</a>
			<a href="/random" onclick={openRandom} class:active={section === 'random'}>Random</a>
		</nav>

		<div class="privacy-tools">
			<button
				type="button"
				class="icon-button"
				class:on={privacy.discreet}
				aria-pressed={privacy.discreet}
				onclick={() => setDiscreet(!privacy.discreet)}
				title={privacy.discreet ? 'Discreet mode is on: neutral tab title and icon' : 'Discreet mode: neutral tab title and icon'}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					{#if privacy.discreet}
						<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.5 7.6C4.3 9.2 3 12 3 12s4 6 9 6a8.7 8.7 0 0 0 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
					{:else}
						<path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="3" />
					{/if}
				</svg>
				<span class="tool-label">Discreet</span>
			</button>
			<button type="button" class="icon-button" onclick={hideNow} title="Hide the page now (B)">
				<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16" /></svg>
				<span class="tool-label">Hide</span>
			</button>
		</div>
	{/if}
</header>

<main class="main">
	{@render children()}
</main>

{#if privacy.hidden}
	<button type="button" class="cover" onclick={unhide} aria-label="Show the page again"></button>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: 'Poppins', sans-serif;
		background-color: #f5f5f5;
		color: #333;
		line-height: 1.6;
		font-size: 16px;
		font-weight: 400;
	}

	:global(h1, h2, h3, h4, h5, h6) {
		font-family: 'Montserrat', sans-serif;
		line-height: 1.2;
		margin-top: 0;
		font-weight: 700;
	}

	header {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 8px 16px;
		background-color: #2c3e50;
		color: white;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
	}

	.title-link {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		text-decoration: none;
	}

	.logo-mark {
		width: 2.5rem;
		height: 2.5rem;
		flex: 0 0 auto;
	}

	.wordmark {
		color: #e74c3c;
		text-transform: uppercase;
		font-family: 'Montserrat', sans-serif;
		font-size: 1.35rem;
		font-weight: 800;
		margin: 0;
		letter-spacing: 2px;
		white-space: nowrap;
	}

	.wordmark.neutral {
		color: #e5e7eb;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 700;
	}

	.main-nav {
		display: flex;
		gap: 4px;
	}

	.main-nav a {
		padding: 6px 14px;
		border-radius: 999px;
		color: #d1d5db;
		font-family: 'Montserrat', sans-serif;
		font-weight: 600;
		font-size: 0.95rem;
		text-decoration: none;
	}

	.main-nav a:hover {
		color: white;
		background: rgba(255, 255, 255, 0.1);
	}

	.main-nav a.active {
		color: white;
		background: rgba(255, 255, 255, 0.16);
	}

	.privacy-tools {
		margin-left: auto;
		display: flex;
		gap: 4px;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: #cbd5e1;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.icon-button:hover {
		color: white;
		background: rgba(255, 255, 255, 0.1);
	}

	.icon-button.on {
		color: white;
		background: rgba(255, 255, 255, 0.16);
	}

	.icon-button svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.main {
		padding: 16px;
		max-width: 1680px;
		margin: 0 auto;
	}

	/* Blank page shown by Hide; covers everything, including the viewer. */
	.cover {
		position: fixed;
		inset: 0;
		z-index: 1000;
		border: none;
		background: #f5f5f5;
		cursor: default;
	}

	@media (max-width: 640px) {
		header {
			gap: 10px;
			padding: 6px 10px;
		}

		.logo-mark {
			width: 2rem;
			height: 2rem;
		}

		.wordmark:not(.neutral) {
			display: none;
		}

		.tool-label {
			display: none;
		}

		.main {
			padding: 12px;
		}
	}
</style>
