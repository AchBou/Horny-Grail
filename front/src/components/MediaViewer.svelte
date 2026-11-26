<script module>
	// Sound stays as the user last set it, so unmuting once carries on to the next videos.
	const sound = $state({ muted: true });
</script>

<script>
	import { onMount } from 'svelte';
	import { fileUrlFor } from '$lib/media.js';

	/**
	 * Full-screen dark viewer for one item. ←/→ or a swipe move, Esc closes.
	 * @type {{
	 *   item: import('$lib/models/image.js').ImageItem,
	 *   hasPrev?: boolean,
	 *   hasNext?: boolean,
	 *   onPrev?: () => void,
	 *   onNext?: () => void,
	 *   onClose: () => void,
	 *   onTag?: (tag: string) => void,
	 *   label?: string,
	 *   nextLabel?: string
	 * }}
	 */
	let {
		item,
		hasPrev = false,
		hasNext = false,
		onPrev,
		onNext,
		onClose,
		onTag,
		label = '',
		nextLabel = 'Next'
	} = $props();

	let failed = $state(false);
	let swipeStart = null;

	$effect(() => {
		item.id;
		failed = false;
	});

	function onKeydown(event) {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		} else if (event.key === 'ArrowRight' && hasNext) {
			event.preventDefault();
			onNext?.();
		} else if (event.key === 'ArrowLeft' && hasPrev) {
			event.preventDefault();
			onPrev?.();
		}
	}

	function onPointerDown(event) {
		if (event.pointerType === 'mouse') return;
		swipeStart = { x: event.clientX, y: event.clientY };
	}

	function onPointerUp(event) {
		if (!swipeStart) return;
		const dx = event.clientX - swipeStart.x;
		const dy = event.clientY - swipeStart.y;
		swipeStart = null;
		if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
		if (dx < 0 && hasNext) onNext?.();
		if (dx > 0 && hasPrev) onPrev?.();
	}

	onMount(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="viewer" role="dialog" aria-modal="true" aria-label="Viewer">
	<div class="stage" role="presentation" onpointerdown={onPointerDown} onpointerup={onPointerUp} onpointercancel={() => (swipeStart = null)}>
		{#key item.id}
			{#if failed}
				<p class="failed">This file could not be loaded.</p>
			{:else if item.kind === 'video'}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					class="media"
					src={fileUrlFor(item)}
					controls
					autoplay
					loop
					playsinline
					bind:muted={sound.muted}
					onerror={() => (failed = true)}
				></video>
			{:else}
				<img class="media" src={fileUrlFor(item)} alt="" onerror={() => (failed = true)} />
			{/if}
		{/key}
	</div>

	<div class="top-bar">
		{#if label}<span class="label">{label}</span>{/if}
		<button type="button" class="round" onclick={onClose} title="Close (Esc)" aria-label="Close">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
		</button>
	</div>

	{#if onPrev}
		<button type="button" class="nav prev" onclick={onPrev} disabled={!hasPrev} title="Previous (←)" aria-label="Previous">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
		</button>
	{/if}
	{#if onNext}
		<button type="button" class="nav next" onclick={onNext} disabled={!hasNext} title="{nextLabel} (→)" aria-label={nextLabel}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
		</button>
	{/if}

	{#if item.tags.length > 0}
		<nav class="tags" aria-label="Tags">
			{#each item.tags as tag (tag)}
				{#if onTag}
					<button type="button" class="tag" onclick={() => onTag(tag)}>{tag}</button>
				{:else}
					<a class="tag" href={`/browse?tags=${encodeURIComponent(tag)}`}>{tag}</a>
				{/if}
			{/each}
		</nav>
	{/if}
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: #0b0d10;
		color: #f3f4f6;
	}

	.stage {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		touch-action: pan-y;
	}

	.media {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		display: block;
	}

	.failed {
		color: #9ca3af;
	}

	.top-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		padding: 12px;
		pointer-events: none;
	}

	.top-bar > * {
		pointer-events: auto;
	}

	.label {
		margin-right: auto;
		padding: 6px 12px;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		font-size: 0.85rem;
		font-weight: 600;
	}

	button {
		font: inherit;
		cursor: pointer;
	}

	svg {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.round,
	.nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		color: #f3f4f6;
		background: rgba(0, 0, 0, 0.55);
	}

	.round {
		width: 44px;
		height: 44px;
		border-radius: 50%;
	}

	.nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 48px;
		height: 72px;
		border-radius: 12px;
	}

	.round:hover,
	.nav:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.2);
	}

	.nav:disabled {
		opacity: 0.2;
		cursor: default;
	}

	.prev {
		left: 12px;
	}

	.next {
		right: 12px;
	}

	.tags {
		position: absolute;
		left: 50%;
		bottom: 70px;
		transform: translateX(-50%);
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		max-width: calc(100% - 140px);
		pointer-events: none;
	}

	.tag {
		pointer-events: auto;
		padding: 5px 12px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		color: #f3f4f6;
		font-size: 0.82rem;
		font-weight: 600;
		text-decoration: none;
	}

	.tag:hover {
		background: rgba(231, 76, 60, 0.85);
		border-color: transparent;
	}

	/* Phones: swipe instead of side buttons, which would cover the picture. */
	@media (hover: none) and (max-width: 768px) {
		.nav {
			display: none;
		}

		.tags {
			max-width: calc(100% - 24px);
		}
	}
</style>
