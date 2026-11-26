<script>
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { pushState, replaceState } from '$app/navigation';
	import Thumbnail from '../../components/Thumbnail.svelte';
	import MediaViewer from '../../components/MediaViewer.svelte';
	import { USE_MOCK_GALLERY, buildApiUrl } from '$lib/config/publicEnv.js';
	import { getMockTagSummary } from '$lib/mocks/gallery.js';
	import { describeRequestFailure, fetchShufflePage, thumbnailUrlFor } from '$lib/media.js';
	import { readTagFilter, writeTagFilter } from '$lib/models/image.js';

	const PAGE_SIZE = 48;
	const PRELOAD_MARGIN_PX = 600;

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

	// The viewer opens over the grid through shallow routing: the URL becomes /image/<id> (so the
	// link works on its own), Back closes it, and the grid keeps its order and scroll position.
	const openId = $derived(page.state?.viewerId ?? null);
	const openIndex = $derived(openId ? images.findIndex((image) => image.id === openId) : -1);
	const openItem = $derived(openIndex >= 0 ? images[openIndex] : null);
	let lastViewedId = null;

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
		url.pathname = '/browse';
		writeTagFilter(url.searchParams, next);
		replaceState(url, {});
		window.scrollTo({ top: 0 });
		retryInitialLoad();
		loadTagSummary();
	}

	function toggleTag(tag) {
		const tags = filter.tags.includes(tag) ? filter.tags.filter((value) => value !== tag) : [...filter.tags, tag];
		applyFilter({ tags, untagged: false });
	}

	function mergeImages(nextImages, replace = false) {
		if (replace) seenIds.clear();
		const merged = [];
		for (const image of nextImages) {
			if (!image?.id || seenIds.has(image.id)) continue;
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
			const result = await fetchShufflePage({ cursor, limit: PAGE_SIZE, filter });
			if (current !== generation) return;
			mergeImages(result.items, replace);
			hasMore = result.hasMore;
			nextCursor = result.cursor;
		} catch (err) {
			if (current !== generation) return;
			console.error(err);
			const message = describeRequestFailure(err?.status, err?.message);
			if (replace) error = message;
			else loadMoreError = message;
		} finally {
			if (current === generation) {
				if (replace) isLoading = false;
				else isLoadingMore = false;
			}
		}

		if (current === generation) await loadMoreIfSentinelVisible();
	}

	// IntersectionObserver only fires when visibility changes. On a tall screen the sentinel can
	// still be in view after a page renders, so check again instead of waiting for a scroll.
	async function loadMoreIfSentinelVisible() {
		await tick();
		if (!sentinel || isLoading || isLoadingMore || loadMoreError || !hasMore || !nextCursor) return;
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

	function viewerUrl(id) {
		return `/image/${id}${window.location.search}`;
	}

	/** @param {MouseEvent} event */
	function openViewer(event, id) {
		// Let new-tab and new-window clicks open the item page as usual.
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		lastViewedId = id;
		pushState(viewerUrl(id), { viewerId: id });
	}

	async function showAt(index) {
		const item = images[index];
		if (!item) return;
		lastViewedId = item.id;
		replaceState(viewerUrl(item.id), { viewerId: item.id });
		if (index >= images.length - 4 && hasMore && !isLoadingMore && nextCursor) {
			await fetchPage({ cursor: nextCursor });
		}
	}

	function closeViewer() {
		history.back();
	}

	function filterByTagFromViewer(tag) {
		applyFilter({ tags: [tag], untagged: false });
	}

	// After the viewer closes, keep the last item seen in view.
	$effect(() => {
		if (openItem || !lastViewedId) return;
		const id = lastViewedId;
		lastViewedId = null;
		tick().then(() => {
			document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
		});
	});

	onMount(() => {
		filter = readTagFilter(new URL(window.location.href).searchParams);
		fetchPage({ replace: true });
		loadTagSummary();

		observer = new IntersectionObserver(
			(entries) => {
				const [entry] = entries;
				if (!entry?.isIntersecting || isLoading || isLoadingMore || !hasMore || !nextCursor) return;
				fetchPage({ cursor: nextCursor });
			},
			{ rootMargin: `${PRELOAD_MARGIN_PX}px 0px` }
		);

		return () => observer?.disconnect();
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
	<h1 class="visually-hidden">Browse</h1>

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
		<div class="state">
			<div class="spinner"></div>
		</div>
	{:else if error}
		<div class="state">
			<p>{error}</p>
			<div class="actions">
				<button type="button" class="primary-action" onclick={retryInitialLoad}>Try again</button>
			</div>
		</div>
	{:else if images.length === 0 && isFiltered}
		<div class="state">
			<p>{filter.untagged ? 'Everything is tagged.' : 'Nothing has all of these tags.'}</p>
			<div class="actions">
				<button type="button" class="primary-action" onclick={() => applyFilter({ tags: [], untagged: false })}>Show everything</button>
			</div>
		</div>
	{:else if images.length === 0}
		<div class="state">
			<p>Nothing here yet.</p>
		</div>
	{:else}
		<div class="gallery">
			{#each images as img (img.id)}
				<a
					class="tile"
					href={`/image/${img.id}`}
					data-id={img.id}
					onclick={(event) => openViewer(event, img.id)}
					aria-label={img.kind === 'video' ? 'Open video' : 'Open image'}
				>
					<Thumbnail src={thumbnailUrlFor(img)} alt="" kind={img.kind} />
				</a>
			{/each}
		</div>

		<div class="load-more-area">
			{#if isLoadingMore}
				<div class="spinner small"></div>
			{:else if loadMoreError}
				<div class="state compact">
					<p>{loadMoreError}</p>
					<div class="actions">
						<button type="button" class="primary-action" onclick={() => fetchPage({ cursor: nextCursor })}>Try again</button>
					</div>
				</div>
			{:else if !hasMore}
				<div class="end-state">
					<span>That's everything{isFiltered ? ' with these tags' : ''}.</span>
					<button type="button" class="secondary-action" onclick={() => { window.scrollTo({ top: 0 }); retryInitialLoad(); }}>Shuffle again</button>
				</div>
			{/if}

			<div bind:this={sentinel} class="scroll-sentinel" aria-hidden="true"></div>
		</div>
	{/if}
</div>

{#if openItem}
	<MediaViewer
		item={openItem}
		hasPrev={openIndex > 0}
		hasNext={openIndex < images.length - 1}
		onPrev={() => showAt(openIndex - 1)}
		onNext={() => showAt(openIndex + 1)}
		onClose={closeViewer}
		onTag={filterByTagFromViewer}
		label={`${openIndex + 1} / ${hasMore ? `${images.length}+` : images.length}`}
	/>
{/if}

<style>
	.browse-shell {
		padding: 4px 0 40px;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.tag-bar {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin: 0 auto 16px;
	}

	.tag-chip {
		padding: 6px 14px;
		border-radius: 999px;
		border: 1px solid rgba(44, 62, 80, 0.18);
		background: white;
		color: #2c3e50;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.15s, border-color 0.15s;
	}

	.tag-chip:hover {
		border-color: rgba(44, 62, 80, 0.4);
	}

	.tag-chip.dashed:not(.selected) {
		border-style: dashed;
	}

	.tag-chip.selected {
		background-color: #e74c3c;
		border-color: #e74c3c;
		color: white;
	}

	.tag-count {
		margin-left: 4px;
		font-weight: 500;
		opacity: 0.7;
	}

	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 10px;
	}

	.tile {
		display: block;
		border-radius: 10px;
		text-decoration: none;
	}

	.tile:focus-visible {
		outline: 3px solid #e74c3c;
		outline-offset: 2px;
	}

	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 40vh;
		text-align: center;
		color: #4b5563;
	}

	.state.compact {
		min-height: 0;
		padding: 16px 0;
	}

	.state p {
		margin: 0;
		font-size: 1.05rem;
	}

	.spinner {
		border: 4px solid rgba(0, 0, 0, 0.1);
		border-radius: 50%;
		border-top: 4px solid #e74c3c;
		width: 36px;
		height: 36px;
		animation: spin 1s linear infinite;
	}

	.spinner.small {
		width: 24px;
		height: 24px;
		border-width: 3px;
		margin: 8px auto;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.actions {
		display: flex;
		justify-content: center;
		gap: 10px;
		margin-top: 16px;
	}

	.primary-action,
	.secondary-action {
		padding: 9px 18px;
		border-radius: 999px;
		cursor: pointer;
		font-weight: 700;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.9rem;
	}

	.primary-action {
		background-color: #e74c3c;
		color: white;
		border: none;
	}

	.primary-action:hover {
		background-color: #c0392b;
	}

	.secondary-action {
		background-color: white;
		color: #2c3e50;
		border: 1px solid rgba(44, 62, 80, 0.2);
	}

	.secondary-action:hover {
		border-color: rgba(44, 62, 80, 0.4);
	}

	.load-more-area {
		padding-top: 16px;
	}

	.end-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: #6b7280;
		font-size: 0.95rem;
	}

	.scroll-sentinel {
		width: 100%;
		height: 1px;
	}

	@media (max-width: 600px) {
		.gallery {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 4px;
		}

		.tile,
		.tile :global(.thumbnail) {
			border-radius: 4px;
		}

		.tag-bar {
			flex-wrap: nowrap;
			justify-content: flex-start;
			overflow-x: auto;
			margin: 0 -12px 12px;
			padding: 0 12px;
			scrollbar-width: none;
		}

		.tag-chip {
			flex: 0 0 auto;
		}
	}
</style>
