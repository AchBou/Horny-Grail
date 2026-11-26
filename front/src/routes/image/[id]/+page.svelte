<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import MediaViewer from '../../../components/MediaViewer.svelte';
    import { USE_MOCK_GALLERY, buildApiUrl } from '$lib/config/publicEnv.js';
    import { getMockItemById } from '$lib/mocks/gallery.js';
    import { normalizeImageItem } from '$lib/models/image.js';

    // An item opened from a link or a reload. Opening from Browse shows the same viewer over the
    // grid instead; closing here goes to Browse with the filter from this URL.
    /** @type {import('$lib/models/image.js').ImageItem | null} */
    let item = $state(null);
    let isLoading = $state(true);
    let error = $state(null);

    function currentId() {
        const segments = window.location.pathname.split('/');
        return decodeURIComponent(segments[segments.length - 1] || '');
    }

    async function loadItem() {
        isLoading = true;
        error = null;
        item = null;
        const id = currentId();
        try {
            if (!id) throw Object.assign(new Error('Missing id'), { status: 404 });

            const payload = USE_MOCK_GALLERY
                ? getMockItemById(id)
                : await (async () => {
                    const response = await fetch(buildApiUrl(`/${id}`));
                    if (!response.ok) throw Object.assign(new Error(`HTTP error ${response.status}`), { status: response.status });
                    return response.json();
                })();

            item = normalizeImageItem(payload ? { ext: 'jpeg', ...payload } : null);
            if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
        } catch (e) {
            console.error(e);
            error = e?.status === 404
                ? 'This item is not in the Grail. It may have been deleted.'
                : 'This item could not be loaded. Try again in a moment.';
        } finally {
            isLoading = false;
        }
    }

    function close() {
        goto(`/browse${window.location.search}`);
    }

    onMount(loadItem);
</script>

{#if item}
    <MediaViewer {item} onClose={close} />
{:else}
    <div class="dark">
        {#if isLoading}
            <div class="spinner"></div>
        {:else}
            <p>{error}</p>
            <div class="actions">
                <button type="button" onclick={loadItem}>Try again</button>
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
