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
        const url = new URL(buildApiUrl('/browse/random'));
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
                    describeRequestFailure(response.status, payload?.message || `HTTP error! Status: ${response.status}`)
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

        observer = new IntersectionObserver((entries) => {
            const [entry] = entries;
            if (!entry?.isIntersecting || isLoading || isLoadingMore || !hasMore || !nextCursor) {
                return;
            }

            fetchPage({ cursor: nextCursor });
        }, {
            rootMargin: '240px 0px'
        });

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

<div class="browse-container">
    <h2>Browse Images</h2>

    {#if isLoading}
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading images...</p>
        </div>
    {:else if error}
        <div class="error">
            <h3>Browse is unavailable right now</h3>
            <p>{error}</p>
            <div class="actions">
                <button on:click={retryInitialLoad}>Try Again</button>
                <a href="/random">Open Random</a>
            </div>
        </div>
    {:else if images.length === 0}
        <div class="empty">
            <h3>Nothing to browse yet</h3>
            <p>Upload media first, then come back here for the shuffled gallery.</p>
            <div class="actions">
                <a href="/random">Try Random</a>
                <a href="/">Back Home</a>
            </div>
        </div>
    {:else}
        <div class="gallery">
            {#each images as img (img.id)}
                <a class="thumbnail-wrapper" href={`/image/${img.id}`} data-id={img.id} aria-label={`Open image ${img.id}`}>
                    <Thumbnail src={buildThumbnailUrl(img.id)} />
                </a>
            {/each}
        </div>

        <div class="load-more-area">
            {#if isLoadingMore}
                <div class="loading loading-more">
                    <div class="spinner small"></div>
                    <p>Loading more...</p>
                </div>
            {:else if loadMoreError}
                <div class="error inline-error">
                    <h3>Could not load more items</h3>
                    <p>{loadMoreError}</p>
                    <div class="actions">
                        <button on:click={() => fetchPage({ cursor: nextCursor })}>Try Again</button>
                        <button class="secondary-action" on:click={retryInitialLoad}>Refresh Gallery</button>
                    </div>
                </div>
            {:else if !hasMore}
                <p class="end-of-results">You reached the end of this shuffle.</p>
            {/if}

            <div bind:this={sentinel} class="scroll-sentinel" aria-hidden="true"></div>
        </div>
    {/if}
</div>

<style>
    .browse-container {
        padding: 20px 0 48px;
        max-width: 1200px;
        margin: 0 auto;
    }

    h2 {
        color: #2c3e50;
        margin-bottom: 30px;
        text-align: center;
        font-size: 2.4em;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.05);
    }

    .gallery {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 24px;
        padding: 10px;
        justify-items: center;
        align-items: start;
    }

    .thumbnail-wrapper {
        display: block;
        width: 100%;
        text-decoration: none;
        transition: transform 0.3s, box-shadow 0.3s;
        border-radius: 8px;
        overflow: hidden;
    }

    .thumbnail-wrapper:hover {
        transform: scale(1.03);
        box-shadow: 0 10px 20px rgba(0,0,0,0.1);
        z-index: 1;
    }

    .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 220px;
    }

    .loading-more {
        min-height: 120px;
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
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    .error, .empty {
        text-align: center;
        padding: 50px;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .error h3,
    .empty h3 {
        margin: 0 0 12px;
        color: #2c3e50;
        font-size: 1.4em;
    }

    .inline-error {
        padding: 24px;
        margin-top: 24px;
    }

    .error p, .empty p {
        margin-bottom: 20px;
        color: #555;
        font-size: 1.1em;
        font-weight: 400;
        letter-spacing: 0.3px;
    }

    .loading p,
    .end-of-results {
        margin-top: 15px;
        font-size: 1.1em;
        font-weight: 300;
        letter-spacing: 0.3px;
        color: #555;
        text-align: center;
    }

    .error button {
        background-color: #e74c3c;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-family: 'Montserrat', sans-serif;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        transition: all 0.3s;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }

    .error button:hover {
        background-color: #c0392b;
    }

    .actions {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 20px;
    }

    .actions a,
    .secondary-action {
        background-color: #fff;
        color: #2c3e50;
        border: 1px solid rgba(44, 62, 80, 0.18);
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-family: 'Montserrat', sans-serif;
        letter-spacing: 0.3px;
        text-decoration: none;
        transition: all 0.3s;
    }

    .actions a:hover,
    .secondary-action:hover {
        border-color: rgba(44, 62, 80, 0.35);
        background-color: #f7f8fa;
    }

    .load-more-area {
        padding: 12px 10px 0;
    }

    .scroll-sentinel {
        width: 100%;
        height: 1px;
    }

    @media (max-width: 768px) {
        .gallery {
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 10px;
        }
    }
</style>
