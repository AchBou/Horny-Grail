<script>
    import { onMount } from 'svelte';
    import { buildApiUrl, buildFileUrl } from '$lib/config/publicEnv.js';
    import { getMediaKindFromExt } from '$lib/models/image.js';

    let imageUrl = '';
    let mediaKind = 'image';
    let isLoading = true;
    let error = null;
    let id = '';
    let videoElement;
    let videoControlsEnabled = false;

    async function toggleVideoPlaybackMode() {
        videoControlsEnabled = !videoControlsEnabled;

        if (!videoElement) {
            return;
        }

        if (videoControlsEnabled) {
            try {
                await videoElement.play();
            } catch (playError) {
                console.error('Unable to start video playback with sound.', playError);
            }
            return;
        }

        videoElement.currentTime = 0;
        try {
            await videoElement.play();
        } catch (playError) {
            console.error('Unable to resume muted video preview.', playError);
        }
    }

    onMount(async () => {
        try {
            isLoading = true;
            error = null;
            imageUrl = '';
            videoControlsEnabled = false;

            const segments = (typeof window !== 'undefined' ? window.location.pathname : '').split('/');
            id = segments[segments.length - 1] || '';

            if (!id) {
                throw new Error('Missing image id in the URL');
            }

            const resp = await fetch(buildApiUrl(`/${id}`));
            if (!resp.ok) {
                throw new Error(`Failed to load image metadata (status ${resp.status})`);
            }

            const item = await resp.json();
            const ext = item?.ext || 'jpeg';
            mediaKind = getMediaKindFromExt(ext);
            imageUrl = buildFileUrl(id, ext);
        } catch (e) {
            console.error(e);
            error = e?.message || 'Unknown error';
        } finally {
            isLoading = false;
        }
    });
</script>

<div class="image-container-page">
    <h2>{mediaKind === 'video' ? 'Video' : 'Image'}</h2>

    <div class="img-box">
        {#if isLoading}
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading image...</p>
            </div>
        {:else if error}
            <div class="error">
                <p>Error loading image: {error}</p>
                <a class="btn" href="/browse">Back to Browse</a>
            </div>
        {:else if imageUrl}
            <div class="image-wrapper">
                {#if mediaKind === 'video'}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video
                        bind:this={videoElement}
                        class="media"
                        src={imageUrl}
                        autoplay
                        controls={videoControlsEnabled}
                        loop={!videoControlsEnabled}
                        muted={!videoControlsEnabled}
                        playsinline
                        preload="auto"
                    ></video>
                {:else}
                    <img class="media" src={imageUrl} alt="Selected file" />
                {/if}
            </div>
        {/if}
    </div>

    <div class="controls">
        {#if mediaKind === 'video' && imageUrl && !isLoading && !error}
            <button class="btn secondary-btn" type="button" on:click={toggleVideoPlaybackMode}>
                {videoControlsEnabled ? 'Hide Controls + Mute' : 'Enable Controls + Sound'}
            </button>
        {/if}
        <a class="btn" href="/browse">Back to Browse</a>
    </div>
</div>

<style>
    .image-container-page {
        padding: 20px 0;
        display: flex;
        flex-direction: column;
        min-height: calc(100vh - 200px);
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

    .img-box {
        background-color: #fff;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 90%;
        flex: 1;
        margin: 0 auto;
        border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        overflow: hidden;
        position: relative;
    }

    .image-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .media {
        display: block;
        max-width: 100%;
        max-height: 70vh;
        object-fit: contain;
        border-radius: 4px;
    }

    .controls {
        margin-top: 30px;
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 12px;
    }

    .btn {
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
        text-decoration: none;
    }

    .btn:hover {
        background-color: #c0392b;
    }

    .secondary-btn {
        background-color: #1f6f8b;
    }

    .secondary-btn:hover {
        background-color: #175569;
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

    .error {
        text-align: center;
        padding: 50px;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        width: 80%;
    }

    .error p {
        margin-bottom: 20px;
        color: #555;
        font-size: 1.1em;
        font-weight: 400;
        letter-spacing: 0.3px;
    }

    @media (max-width: 768px) {
        .img-box {
            width: 100%;
        }

        .media {
            max-height: 60vh;
        }
    }
</style>
