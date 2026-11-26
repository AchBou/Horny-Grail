<script>
    /** @type {{ src: string, alt?: string, kind?: 'image' | 'video' }} */
    let { src, alt = 'thumbnail', kind = 'image' } = $props();

    // The src that failed to load; a new src clears the error on its own.
    let failedSrc = $state(null);
    const hasError = $derived(failedSrc === src);

    function handleError() {
        failedSrc = src;
    }
</script>

<div class="thumbnail">
    {#if hasError}
        <div class="fallback" aria-hidden="true"></div>
    {:else}
        <img {src} {alt} loading="lazy" decoding="async" onerror={handleError} />
    {/if}

    {#if kind === 'video'}
        <span class="video-badge" aria-label="Video">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
        </span>
    {/if}
</div>

<style>
    .thumbnail {
        position: relative;
        width: 100%;
        aspect-ratio: 4 / 5;
        overflow: hidden;
        border-radius: 10px;
        background: #1f2937;
    }

    img,
    .fallback {
        width: 100%;
        height: 100%;
    }

    img {
        display: block;
        object-fit: cover;
        object-position: center;
        image-orientation: from-image;
        transition: transform 0.3s ease;
    }

    .fallback {
        background: linear-gradient(160deg, #1d2734, #101722 70%);
    }

    .video-badge {
        position: absolute;
        top: 6px;
        left: 6px;
        display: inline-flex;
        padding: 4px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.6);
    }

    .video-badge svg {
        width: 14px;
        height: 14px;
        fill: white;
    }

    .thumbnail:hover img {
        transform: scale(1.04);
    }
</style>
