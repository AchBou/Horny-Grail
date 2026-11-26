<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import MediaViewer from '../../components/MediaViewer.svelte';
    import { describeFilter, describeRequestFailure, fetchShufflePage } from '$lib/media.js';
    import { readTagFilter } from '$lib/models/image.js';

    // Random: a fresh shuffle of everything matching the filter in the URL (?tags=a,b or
    // ?untagged=1), shown one at a time. → or a swipe for the next, ← goes back. When the
    // shuffle runs out, a new one starts.
    const BATCH = 24;

    /** @type {import('$lib/models/image.js').ImageItem[]} */
    let queue = $state([]);
    let index = $state(0);
    let cursor = null;
    let hasMore = true;
    let loading = $state(true);
    let error = $state(null);
    let filter = $state({ tags: [], untagged: false });
    const current = $derived(queue[index] ?? null);

    async function loadBatch() {
        const page = await fetchShufflePage({ cursor, limit: BATCH, filter });
        cursor = page.cursor;
        hasMore = page.hasMore;
        return page.items;
    }

    async function start() {
        loading = true;
        error = null;
        try {
            cursor = null;
            queue = await loadBatch();
            index = 0;
            if (queue.length === 0) error = 'Nothing matches this filter.';
        } catch (e) {
            console.error(e);
            error = describeRequestFailure(e?.status, e?.message);
        } finally {
            loading = false;
        }
    }

    async function next() {
        if (index < queue.length - 1) {
            index += 1;
        } else if (!loading) {
            // End of this shuffle: start a new one, skipping a repeat of the item on screen.
            loading = true;
            try {
                if (!hasMore) cursor = null;
                const more = (await loadBatch()).filter((item) => item.id !== current?.id);
                if (more.length) {
                    queue = [...queue, ...more];
                    index += 1;
                }
            } catch (e) {
                console.error(e);
            } finally {
                loading = false;
            }
            return;
        }
        if (index >= queue.length - 3 && hasMore && !loading) {
            loadBatch().then((more) => {
                const known = new Set(queue.map((item) => item.id));
                queue = [...queue, ...more.filter((item) => !known.has(item.id))];
            }).catch((e) => console.error(e));
        }
    }

    function previous() {
        if (index > 0) index -= 1;
    }

    function close() {
        goto(`/browse${window.location.search}`);
    }

    onMount(() => {
        filter = readTagFilter(new URL(window.location.href).searchParams);
        start();
    });
</script>

{#if current}
    <MediaViewer
        item={current}
        hasPrev={index > 0}
        hasNext={queue.length > 1}
        onPrev={previous}
        onNext={next}
        onClose={close}
        label={`Random · ${describeFilter(filter)}`}
        nextLabel="Another"
    />
{:else}
    <div class="dark">
        {#if loading}
            <div class="spinner"></div>
        {:else}
            <p>{error}</p>
            <div class="actions">
                <button type="button" onclick={start}>Try again</button>
                <a href="/browse">Browse</a>
            </div>
        {/if}
    </div>
{/if}

<style>
    .dark {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        background: #0b0d10;
        color: #d1d5db;
        text-align: center;
        padding: 24px;
    }

    p {
        margin: 0;
    }

    .actions {
        display: flex;
        gap: 10px;
    }

    button,
    a {
        padding: 9px 18px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: transparent;
        color: #f3f4f6;
        font: inherit;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
    }

    .spinner {
        border: 4px solid rgba(255, 255, 255, 0.15);
        border-top-color: #e74c3c;
        border-radius: 50%;
        width: 36px;
        height: 36px;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
