<script>
	import { onMount, tick } from 'svelte';
	import Thumbnail from '../../components/Thumbnail.svelte';
	import {
		USE_MOCK_GALLERY,
		buildApiUrl,
		buildMockThumbnailUrl,
		buildThumbnailUrl
	} from '$lib/config/publicEnv.js';
	import { replaceState } from '$app/navigation';
	import { getMockBrowsePage, getMockTagSummary } from '$lib/mocks/gallery.js';
	import { normalizeImages, readTagFilter, writeTagFilter } from '$lib/models/image.js';

	const PAGE_SIZE = 24;
	const PRELOAD_MARGIN_PX = 240;

	/** @type {import('$lib/models/image.js').ImageItem[]} */
	let images = $state([]);
	let isLoading = $state(true);
	let isLoadingMore = $state(false);
	let error = $state(null);
	let loadMoreError = $state(null);
	let hasMore = $state(false);
	let nextCursor = $state(null);
	let sentinel = $state();
	let observer = $state();

	// Tag filter: items with every selected tag, or only untagged ones. Kept in the URL.
	let filter = $state({ tags: [], untagged: false });
	/** @type {{ tags: { tag: string, count: number }[], total: number, untagged: number } | null} */
	let tagSummary = $state(null);
	const isFiltered = $derived(filter.untagged || filter.tags.length > 0);

	const seenIds = new Set();

	async function loadTagSummary() {
		try {
			if (USE_MOCK_GALLERY) {
				tagSummary = getMockTagSummary();
				return;
			}
			const response = await fetch(buildApiUrl('/tags'));
			if (response.ok) tagSummary = await response.json();
		} catch (err) {
			console.warn('Could not load tags', err);
		}
	}

	function applyFilter(next) {
		filter = next;
		const url = new URL(window.location.href);
		writeTagFilter(url.searchParams, next);
		replaceState(url, {});
		retryInitialLoad();
		loadTagSummary();
	}

	function toggleTag(tag) {
		const tags = filter.tags.includes(tag) ? filter.tags.filter((value) => value !== tag) : [...filter.tags, tag];
		applyFilter({ tags, untagged: false });
	}

	function describeRequestFailure(status, fallbackMessage) {
		if (status === 404) {
			return 'No active items are available to browse yet.';
		}

		if (status >= 500) {
			return 'The gallery is temporarily unavailable. Try again in a moment.';
		}

		return fallbackMessage || 'Failed to load images.';
	}

	function buildBrowseUrl(cursor = null) {
		const url = new URL(buildApiUrl('/browse/random'), window.location.origin);
		url.searchParams.set('limit', PAGE_SIZE.toString());
		if (cursor) {
			url.searchParams.set('cursor', cursor);
		}
		writeTagFilter(url.searchParams, filter);
		return url.toString();
	}

	function mergeImages(nextImages, replace = false) {
		const merged = [];

		if (replace) {
			seenIds.clear();
		}

		for (const image of nextImages) {
			if (!image?.id || seenIds.has(image.id)) {
				continue;
			}

			seenIds.add(image.id);
			merged.push(image);
		}

		images = replace ? merged : images.concat(merged);
	}

	// A fresh load (new filter, reshuffle) starts a new generation; pages still in flight
	// for the old one are dropped when they land instead of mixing into the new list.
	let generation = 0;

	async function fetchPage({ cursor = null, replace = false } = {}) {
		if (replace) {
			generation += 1;
			isLoading = true;
			isLoadingMore = false;
			error = null;
			loadMoreError = null;
		} else {
			isLoadingMore = true;
			loadMoreError = null;
		}

		const current = generation;
		try {
			const payload = USE_MOCK_GALLERY
				? getMockBrowsePage(cursor, PAGE_SIZE, filter)
				: await (async () => {
					const response = await fetch(buildBrowseUrl(cursor));
					if (!response.ok) {
						const body = await response.json().catch(() => null);
						const requestError = new Error(
							describeRequestFailure(
								response.status,
								body?.message || `HTTP error! Status: ${response.status}`
							)
						);
						requestError.status = response.status;
						throw requestError;
					}

					return response.json();
				})();

			if (current !== generation) return;
			mergeImages(normalizeImages(payload.items), replace);
			hasMore = Boolean(payload.hasMore);
			nextCursor = typeof payload.cursor === 'string' ? payload.cursor : null;
		} catch (err) {
			if (current !== generation) return;
			console.error(err);
			const message = describeRequestFailure(err?.status, err.message || 'Failed to load images');
			if (replace) {
				error = message;
			} else {
				loadMoreError = message;
			}
		} finally {
			if (current === generation) {
				if (replace) {
					isLoading = false;
				} else {
					isLoadingMore = false;
				}
			}
		}

		if (current === generation) await loadMoreIfSentinelVisible();
	}

	// IntersectionObserver only fires when visibility changes. On a tall screen the sentinel can
	// still be in view after a page renders, so check again instead of waiting for a scroll.
	async function loadMoreIfSentinelVisible() {
		await tick();
		if (!sentinel || isLoading || isLoadingMore || loadMoreError || !hasMore || !nextCursor) {
			return;
		}

		if (sentinel.getBoundingClientRect().top <= window.innerHeight + PRELOAD_MARGIN_PX) {
			await fetchPage({ cursor: nextCursor });
		}
	}

	function retryInitialLoad() {
		images = [];
		hasMore = false;
		nextCursor = null;
		fetchPage({ replace: true });
	}

	onMount(() => {
		filter = readTagFilter(new URL(window.location.href).searchParams);
		fetchPage({ replace: true });
		loadTagSummary();

		observer = new IntersectionObserver(
			(entries) => {
				const [entry] = entries;
				if (!entry?.isIntersecting || isLoading || isLoadingMore || !hasMore || !nextCursor) {
					return;
				}

				fetchPage({ cursor: nextCursor });
			},
			{
				rootMargin: `${PRELOAD_MARGIN_PX}px 0px`
			}
		);

		if (sentinel) {
			observer.observe(sentinel);
		}

		return () => {
			observer?.disconnect();
		};
	});

	// The sentinel only exists once the gallery renders, so observe it whenever it appears.
	$effect(() => {
		const target = sentinel;
		const currentObserver = observer;
		if (!currentObserver || !target) return;
		currentObserver.observe(target);
		return () => currentObserver.unobserve(target);
	});
</script>

<div class="browse-shell">
	<h2>Browse Images</h2>

	{#if tagSummary && (tagSummary.tags.length > 0 || isFiltered)}
		<nav class="tag-bar" aria-label="Filter by tag">
			<button type="button" class="tag-chip" class:selected={!isFiltered} aria-pressed={!isFiltered} onclick={() => applyFilter({ tags: [], untagged: false })}>
				All <span class="tag-count">{tagSummary.total}</span>
			</button>
			{#if tagSummary.untagged > 0 || filter.untagged}
				<button type="button" class="tag-chip dashed" class:selected={filter.untagged} aria-pressed={filter.untagged} onclick={() => applyFilter({ tags: [], untagged: true })}>
					Untagged <span class="tag-count">{tagSummary.untagged}</span>
				</button>
			{/if}
			{#each tagSummary.tags as entry (entry.tag)}
				{@const selected = filter.tags.includes(entry.tag)}
				<button type="button" class="tag-chip" class:selected aria-pressed={selected} onclick={() => toggleTag(entry.tag)}>
					{entry.tag} <span class="tag-count">{entry.count}</span>
				</button>
			{/each}
		</nav>
	{/if}

	{#if isLoading}
		<div class="state-card loading">
			<div class="spinner"></div>
			<p>Loading gallery...</p>
		</div>
	{:else if error}
		<div class="state-card">
			<h3>Gallery unavailable</h3>
			<p>{error}</p>
			<div class="actions">
				<button type="button" class="primary-action" onclick={retryInitialLoad}>Try Again</button>
				<a class="secondary-action" href="/random">Open Random</a>
			</div>
		</div>
	{:else if images.length === 0 && isFiltered}
		<div class="state-card">
			<h3>{filter.untagged ? 'Everything is tagged' : 'Nothing has all of these tags'}</h3>
			<div class="actions">
				<button type="button" class="primary-action" onclick={() => applyFilter({ tags: [], untagged: false })}>Show Everything</button>
			</div>
		</div>
	{:else if images.length === 0}
		<div class="state-card">
			<h3>No items yet</h3>
			<div class="actions">
				<a class="primary-link" href="/random">Try Random</a>
				<a class="secondary-action" href="/">Back Home</a>
			</div>
		</div>
	{:else}
		<section class="gallery-panel">
			<div class="gallery">
				{#each images as img (img.id)}
					<a
						class="thumbnail-wrapper"
						href={`/image/${img.id}`}
						data-id={img.id}
						aria-label={`Open ${img.kind === 'video' ? 'video' : 'image'} ${img.id}`}
					>
						<Thumbnail
							src={USE_MOCK_GALLERY ? buildMockThumbnailUrl(img.id) : buildThumbnailUrl(img.id)}
							alt={img.kind === 'video' ? 'Video thumbnail' : 'Image thumbnail'}
							kind={img.kind}
						/>
					</a>
				{/each}
			</div>
		</section>

		<div class="load-more-area">
			{#if isLoadingMore}
				<div class="loading loading-more">
					<div class="spinner small"></div>
					<p>Loading more...</p>
				</div>
			{:else if loadMoreError}
				<div class="state-card inline-error">
					<h3>Could not load more</h3>
					<p>{loadMoreError}</p>
					<div class="actions">
						<button type="button" class="primary-action" onclick={() => fetchPage({ cursor: nextCursor })}>Try Again</button>
						<button type="button" class="secondary-action" onclick={retryInitialLoad}>Refresh Gallery</button>
					</div>
				</div>
			{:else if !hasMore}
				<div class="end-state">
					<h3>End of gallery</h3>
					<div class="actions">
						<button type="button" class="primary-action" onclick={retryInitialLoad}>Shuffle Again</button>
						<a class="secondary-action" href="/random">Open Random</a>
					</div>
				</div>
			{/if}

			<div bind:this={sentinel} class="scroll-sentinel" aria-hidden="true"></div>
		</div>
	{/if}
</div>

<style>
	.browse-shell {
		padding: 24px 0 56px;
		max-width: 1380px;
		margin: 0 auto;
	}

	h2 {
		color: #23364a;
		margin: 0 0 24px;
		text-align: center;
		font-size: clamp(2.1rem, 4vw, 3.2rem);
		font-weight: 800;
		letter-spacing: -0.04em;
	}

	.tag-bar {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin: -8px auto 24px;
		max-width: 1100px;
	}

	.tag-chip {
		padding: 8px 16px;
		border-radius: 999px;
		border: 1px solid rgba(44, 62, 80, 0.18);
		background: rgba(255, 255, 255, 0.95);
		color: #2c3e50;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tag-chip:hover {
		border-color: rgba(44, 62, 80, 0.35);
	}

	.tag-chip.dashed:not(.selected) {
		border-style: dashed;
	}

	.tag-chip.selected {
		background-color: #e74c3c;
		border-color: #e74c3c;
		color: white;
		box-shadow: 0 8px 18px rgba(231, 76, 60, 0.18);
	}

	.tag-count {
		margin-left: 4px;
		font-weight: 500;
		opacity: 0.7;
	}

	.gallery-panel {
		padding: clamp(18px, 2.5vw, 28px);
		border-radius: 28px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(251, 252, 253, 0.98));
		box-shadow:
			0 24px 50px rgba(44, 62, 80, 0.08),
			inset 0 0 0 1px rgba(44, 62, 80, 0.08);
	}

	.state-card h3,
	.end-state h3 {
		margin: 0;
		color: #23364a;
		font-size: 1.75rem;
		font-weight: 800;
		letter-spacing: -0.03em;
	}

	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 22px;
		align-items: start;
	}

	.thumbnail-wrapper {
		display: block;
		width: 100%;
		text-decoration: none;
		transition:
			transform 0.28s ease,
			filter 0.28s ease;
		border-radius: 20px;
	}

	.thumbnail-wrapper:hover,
	.thumbnail-wrapper:focus-visible {
		transform: translateY(-6px);
		filter: saturate(1.03);
		outline: none;
	}

	.state-card,
	.end-state,
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: clamp(28px, 5vw, 50px);
		border-radius: 28px;
		background: rgba(255, 255, 255, 0.96);
		box-shadow:
			0 24px 50px rgba(44, 62, 80, 0.08),
			inset 0 0 0 1px rgba(44, 62, 80, 0.08);
		min-height: 220px;
	}

	.loading-more {
		min-height: 120px;
		padding: 18px 0 12px;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.spinner {
		border: 4px solid rgba(0, 0, 0, 0.1);
		border-radius: 50%;
		border-top: 4px solid #e74c3c;
		width: 40px;
		height: 40px;
		animation: spin 1s linear infinite;
		margin-bottom: 20px;
	}

	.spinner.small {
		width: 28px;
		height: 28px;
		margin-bottom: 12px;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.inline-error {
		padding: 24px;
		margin-top: 24px;
		min-height: 0;
	}

	.state-card p,
	.loading p {
		color: #555;
		font-size: 1.05rem;
		letter-spacing: 0.01em;
		line-height: 1.7;
		max-width: 660px;
	}

	.state-card p {
		margin-bottom: 20px;
	}

	.loading p {
		margin-top: 15px;
		margin-bottom: 0;
		font-weight: 500;
		color: #5c6773;
		text-align: center;
	}

	.primary-action,
	.primary-link {
		background-color: #e74c3c;
		color: white;
		border: none;
		padding: 12px 22px;
		border-radius: 999px;
		cursor: pointer;
		font-weight: 700;
		font-family: 'Montserrat', sans-serif;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		transition: all 0.3s;
		box-shadow: 0 12px 24px rgba(231, 76, 60, 0.18);
		text-decoration: none;
	}

	.primary-action:hover,
	.primary-link:hover {
		background-color: #c0392b;
	}

	.actions {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 20px;
	}

	.secondary-action {
		background-color: rgba(255, 255, 255, 0.95);
		color: #2c3e50;
		border: 1px solid rgba(44, 62, 80, 0.18);
		padding: 12px 20px;
		border-radius: 999px;
		cursor: pointer;
		font-weight: 600;
		font-family: 'Montserrat', sans-serif;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-decoration: none;
		transition: all 0.3s;
	}

	.secondary-action:hover {
		border-color: rgba(44, 62, 80, 0.35);
		background-color: #f7f8fa;
	}

	.load-more-area {
		padding: 22px 0 0;
	}

	.end-state {
		margin-top: 14px;
		min-height: 0;
	}

	.end-state .actions {
		margin-top: 0;
	}

	.scroll-sentinel {
		width: 100%;
		height: 1px;
	}

	@media (max-width: 768px) {
		.browse-shell {
			padding: 12px 0 40px;
		}

		.gallery-panel,
		.state-card,
		.end-state {
			border-radius: 20px;
		}

		h2 {
			text-align: center;
			font-size: 2.4rem;
		}

		.gallery {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 14px;
		}
	}
</style>
