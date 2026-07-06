<script>
    export let src;
    export let alt = 'thumbnail';
    export let kind = 'image';

    let hasError = false;
    let previousSrc = null;

    $: if (src !== previousSrc) {
        previousSrc = src;
        hasError = false;
    }

    function handleError() {
        hasError = true;
    }
</script>

<div class="thumbnail">
    <div class="image-frame">
        {#if hasError}
            <div class="fallback" aria-hidden="true">
                <span>{kind === 'video' ? 'VIDEO' : 'IMAGE'}</span>
            </div>
        {:else}
            <img {src} {alt} on:error={handleError} />
        {/if}

        <span class="kind-badge">{kind === 'video' ? 'Video' : 'Image'}</span>
    </div>
</div>

<style>
    .thumbnail {
        position: relative;
        height: 100%;
        min-height: 0;
    }

    .image-frame {
        position: relative;
        width: 100%;
        aspect-ratio: 4 / 5;
        overflow: hidden;
        border-radius: 18px;
        background:
            linear-gradient(180deg, rgba(17, 24, 39, 0.06), rgba(17, 24, 39, 0.18)),
            #101a29;
        box-shadow:
            0 14px 30px rgba(17, 24, 39, 0.14),
            inset 0 0 0 1px rgba(255, 255, 255, 0.08);
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
        transition: transform 0.35s ease, filter 0.35s ease;
    }

    .fallback {
        display: grid;
        place-items: center;
        background:
            radial-gradient(circle at top, rgba(231, 76, 60, 0.35), transparent 45%),
            linear-gradient(160deg, #1d2734, #101722 70%);
        color: rgba(255, 255, 255, 0.7);
        font-family: 'Montserrat', sans-serif;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.24em;
        text-transform: uppercase;
    }

    .kind-badge {
        position: absolute;
        top: 12px;
        right: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.78);
        color: #f7fafc;
        font-family: 'Montserrat', sans-serif;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        backdrop-filter: blur(10px);
    }

    .thumbnail:hover img {
        transform: scale(1.06);
        filter: saturate(1.05);
    }
</style>
