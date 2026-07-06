<script>
	import { onMount } from 'svelte';
	import Thumbnail from '../../components/Thumbnail.svelte';
	import { buildApiUrl, buildThumbnailUrl } from '$lib/config/publicEnv.js';
	import { normalizeImages } from '$lib/models/image.js';

	const PAGE_SIZE = 24;

	/** @type {import('$lib/models/image.js').ImageItem[]} */
	let images = [];
	let isLoading = true;
	let isLoadingMore = false;
	let error = null;
	let loadMoreError = null;
	let hasMore = false;
	let nextCursor = null;
	let sentinel;
	let observer;

	const seenIds = new Set();

	$: videoCount = images.filter((image) => image.kind === 'video').length;
	$: imageCount = Math.max(images.length - videoCount, 0);

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

	async function fetchPage({ cursor = null, replace = false } = {}) {
		if (replace) {
			isLoading = true;
			error = null;
			loadMoreError = null;
		} else {
			isLoadingMore = true;
			loadMoreError = null;
		}

		try {
			const response = await fetch(buildBrowseUrl(cursor));
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				const requestError = new Error(
					describeRequestFailure(
						response.status,
						payload?.message || `HTTP error! Status: ${response.status}`
					)
				);
				requestError.status = response.status;
				throw requestError;
			}

			const payload = await response.json();
			mergeImages(normalizeImages(payload.items), replace);
			hasMore = Boolean(payload.hasMore);
			nextCursor = typeof payload.cursor === 'string' ? payload.cursor : null;
		} catch (err) {
			console.error(err);
			const message = describeRequestFailure(err?.status, err.message || 'Failed to load images');
			if (replace) {
				error = message;
			} else {
				loadMoreError = message;
			}
		} finally {
			if (replace) {
				isLoading = false;
			} else {
				isLoadingMore = false;
			}
		}
	}

	function retryInitialLoad() {
		images = [];
		hasMore = false;
		nextCursor = null;
		fetchPage({ replace: true });
	}

	onMount(() => {
		fetchPage({ replace: true });

		observer = new IntersectionObserver(
			(entries) => {
				const [entry] = entries;
				if (!entry?.isIntersecting || isLoading || isLoadingMore || !hasMore || !nextCursor) {
					return;
				}

				fetchPage({ cursor: nextCursor });
			},
			{
				rootMargin: '240px 0px'
			}
		);

		if (sentinel) {
			observer.observe(sentinel);
		}

		return () => {
			observer?.disconnect();
		};
	});

	$: if (observer && sentinel) {
		observer.observe(sentinel);
	}
</script>

<div class="browse-shell">
	<section class="browse-hero">
		<p class="eyebrow">Shuffled Collection</p>
		<h2>Browse Images</h2>
		<p class="hero-copy">
			A randomized pass through the collection with larger cards, faster scanning, and direct open on tap.
		</p>

		<div class="hero-stats" aria-label="Gallery summary">
			<div class="stat-chip">
				<span class="stat-value">{images.length}</span>
				<span class="stat-label">Loaded</span>
			</div>
			<div class="stat-chip">
				<span class="stat-value">{imageCount}</span>
				<span class="stat-label">Images</span>
			</div>
			<div class="stat-chip">
				<span class="stat-value">{videoCount}</span>
				<span class="stat-label">Videos</span>
			</div>
		</div>
	</section>

	{#if isLoading}
		<div class="state-card loading">
			<div class="spinner"></div>
			<p>Building your shuffled gallery...</p>
		</div>
	{:else if error}
		<div class="state-card">
			<h3>Browse is unavailable right now</h3>
			<p>{error}</p>
			<div class="actions">
				<button type="button" class="primary-action" on:click={retryInitialLoad}>Try Again</button>
				<a class="secondary-action" href="/random">Open Random</a>
			</div>
		</div>
	{:else if images.length === 0}
		<div class="state-card">
			<h3>Nothing to browse yet</h3>
			<p>Upload media first, then come back here for the shuffled gallery.</p>
			<div class="actions">
				<a class="primary-link" href="/random">Try Random</a>
				<a class="secondary-action" href="/">Back Home</a>
			</div>
		</div>
	{:else}
		<section class="gallery-panel">
			<div class="gallery-heading">
				<div>
					<p class="section-label">Now Showing</p>
					<h3>Shuffled Gallery</h3>
				</div>
				<div class="gallery-meta">
					<span>{images.length} loaded</span>
					<span>{hasMore ? 'More incoming' : 'Shuffle complete'}</span>
				</div>
			</div>

			<div class="gallery">
				{#each images as img (img.id)}
					<a
						class="thumbnail-wrapper"
						href={`/image/${img.id}`}
						data-id={img.id}
						aria-label={`Open ${img.kind === 'video' ? 'video' : 'image'} ${img.id}`}
					>
						<Thumbnail
							src={buildThumbnailUrl(img.id)}
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
					<p>Pulling more from the shuffle...</p>
				</div>
			{:else if loadMoreError}
				<div class="state-card inline-error">
					<h3>Could not load more items</h3>
					<p>{loadMoreError}</p>
					<div class="actions">
						<button type="button" class="primary-action" on:click={() => fetchPage({ cursor: nextCursor })}>Try Again</button>
						<button type="button" class="secondary-action" on:click={retryInitialLoad}>Refresh Gallery</button>
					</div>
				</div>
			{:else if !hasMore}
				<div class="end-state">
					<p class="end-kicker">End of This Shuffle</p>
					<h3>You reached the end of the current pass.</h3>
					<p>
						Reload the gallery for a fresh randomized order or jump straight into a single random item.
					</p>
					<div class="actions">
						<button type="button" class="primary-action" on:click={retryInitialLoad}>Shuffle Again</button>
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

	.browse-hero {
		margin-bottom: 28px;
		padding: clamp(24px, 4vw, 40px);
		border-radius: 28px;
		background:
			radial-gradient(circle at top left, rgba(231, 76, 60, 0.16), transparent 28%),
			radial-gradient(circle at top right, rgba(31, 111, 139, 0.14), transparent 24%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 249, 251, 0.9));
		box-shadow:
			0 24px 60px rgba(44, 62, 80, 0.08),
			inset 0 0 0 1px rgba(44, 62, 80, 0.08);
	}

	.eyebrow,
	.section-label,
	.end-kicker {
		margin: 0 0 10px;
		color: #e74c3c;
		font-family: 'Montserrat', sans-serif;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	h2 {
		color: #23364a;
		margin: 0 0 12px;
		text-align: center;
		font-size: clamp(2.4rem, 5vw, 4.2rem);
		font-weight: 800;
		letter-spacing: -0.04em;
	}

	.hero-copy {
		max-width: 760px;
		margin: 0 auto;
		color: #5a6673;
		font-size: 1.08rem;
		line-height: 1.7;
		text-align: center;
	}

	.hero-stats {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 14px;
		margin-top: 26px;
	}

	.stat-chip {
		min-width: 120px;
		padding: 14px 18px;
		border-radius: 18px;
		background: rgba(255, 255, 255, 0.78);
		box-shadow: inset 0 0 0 1px rgba(44, 62, 80, 0.08);
		text-align: center;
	}

	.stat-value {
		display: block;
		color: #23364a;
		font-family: 'Montserrat', sans-serif;
		font-size: 1.2rem;
		font-weight: 800;
	}

	.stat-label {
		display: block;
		margin-top: 4px;
		color: #66727f;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.gallery-panel {
		padding: clamp(18px, 2.5vw, 28px);
		border-radius: 28px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(251, 252, 253, 0.98));
		box-shadow:
			0 24px 50px rgba(44, 62, 80, 0.08),
			inset 0 0 0 1px rgba(44, 62, 80, 0.08);
	}

	.gallery-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 22px;
	}

	.gallery-heading h3,
	.state-card h3,
	.end-state h3 {
		margin: 0;
		color: #23364a;
		font-size: 1.75rem;
		font-weight: 800;
		letter-spacing: -0.03em;
	}

	.gallery-meta {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 10px;
	}

	.gallery-meta span {
		padding: 8px 12px;
		border-radius: 999px;
		background: #eef3f7;
		color: #4f5d6d;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
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
	.end-state p,
	.loading p {
		color: #555;
		font-size: 1.05rem;
		letter-spacing: 0.01em;
		line-height: 1.7;
		max-width: 660px;
	}

	.state-card p,
	.end-state p {
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
	}

	.end-state .actions {
		margin-top: 8px;
	}

	.scroll-sentinel {
		width: 100%;
		height: 1px;
	}

	@media (max-width: 768px) {
		.browse-shell {
			padding: 12px 0 40px;
		}

		.browse-hero,
		.gallery-panel,
		.state-card,
		.end-state {
			border-radius: 20px;
		}

		.gallery-heading {
			flex-direction: column;
			align-items: flex-start;
		}

		h2 {
			text-align: left;
			font-size: 2.4rem;
		}

		.hero-copy {
			text-align: left;
			margin: 0;
		}

		.hero-stats {
			justify-content: flex-start;
		}

		.stat-chip {
			min-width: 104px;
		}

		.gallery {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 14px;
		}
	}
</style>
