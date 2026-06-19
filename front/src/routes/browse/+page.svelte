<script>
    import Thumbnail from '../../components/Thumbnail.svelte';
    import { onMount } from 'svelte';
    import { buildApiUrl, buildThumbnailUrl } from '$lib/config/publicEnv.js';
    import { normalizeImages } from '$lib/models/image.js';

    /** @type {import('$lib/models/image.js').ImageItem[]} */
    let images = [];
    let isLoading = true;
    let error = null;

    onMount(async () => {
        try {
            const response = await fetch(buildApiUrl());
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const payload = await response.json();
            images = normalizeImages(payload);
            console.log(images);
            isLoading = false;
        } catch (err) {
            console.error(err);
            error = err.message;
            isLoading = false;
        }
    });
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
            <p>Error loading images: {error}</p>
            <button on:click={() => window.location.reload()}>Try Again</button>
        </div>
    {:else if images.length === 0}
        <div class="empty">
            <p>No images found.</p>
        </div>
    {:else}
        <div class="gallery">
            {#each images as img (img.id)}
                <a class="thumbnail-wrapper" href={`/image/${img.id}`} data-id={img.id} aria-label={`Open image ${img.id}`}>
                    <Thumbnail src={buildThumbnailUrl(img.id)} />
                </a>
            {/each}
        </div>
    {/if}
</div>

<style>
    .browse-container {
        padding: 20px 0;
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
        height: 300px;
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

    .error p, .empty p {
        margin-bottom: 20px;
        color: #555;
        font-size: 1.1em;
        font-weight: 400;
        letter-spacing: 0.3px;
    }

    .loading p {
        margin-top: 15px;
        font-size: 1.1em;
        font-weight: 300;
        letter-spacing: 0.3px;
        color: #555;
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

    @media (max-width: 768px) {
        .gallery {
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 10px;
        }
    }
</style>
