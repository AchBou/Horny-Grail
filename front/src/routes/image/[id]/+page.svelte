<script>
    import { onMount } from 'svelte';
    import { USE_MOCK_GALLERY, buildApiUrl, buildFileUrl, buildMockFileUrl } from '$lib/config/publicEnv.js';
    import { getMockItemById } from '$lib/mocks/gallery.js';
    import { getMediaKindFromExt } from '$lib/models/image.js';

    let imageUrl = '';
    let mediaKind = 'image';
    let isLoading = true;
    let error = null;
    let errorTitle = 'Unable to load item';
    let id = '';
    let videoElement;
    let videoControlsEnabled = false;

    function getCurrentIdFromPath() {
        const segments = (typeof window !== 'undefined' ? window.location.pathname : '').split('/');
        return segments[segments.length - 1] || '';
    }

    function describeDetailFailure(status, currentId, fallbackMessage) {
        if (status === 404) {
            return {
                title: 'Item not found',
                message: `No media item with id ${currentId} is available right now. It may not exist yet or may have been removed.`
            };
        }

        if (status >= 500) {
            return {
                title: 'Detail page is temporarily unavailable',
                message: 'The backend returned an error while loading this item. Try again in a moment.'
            };
        }

        return {
            title: 'Unable to load item',
            message: fallbackMessage || 'Unknown error'
        };
    }

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

    async function loadItem() {
        try {
            isLoading = true;
            error = null;
            errorTitle = 'Unable to load item';
            imageUrl = '';
            videoControlsEnabled = false;
            id = getCurrentIdFromPath();

            if (!id) {
                const routeError = new Error('Missing image id in the URL');
                routeError.status = 400;
                throw routeError;
            }

            const item = USE_MOCK_GALLERY
                ? getMockItemById(id)
                : await (async () => {
                    const resp = await fetch(buildApiUrl(`/${id}`));
                    if (!resp.ok) {
                        const payload = await resp.json().catch(() => null);
                        const requestError = new Error(
                            payload?.message || `Failed to load image metadata (status ${resp.status})`
                        );
                        requestError.status = resp.status;
                        throw requestError;
                    }

                    return resp.json();
                })();

            if (!item) {
                const missingItemError = new Error(`No mock item found for id ${id}`);
                missingItemError.status = 404;
                throw missingItemError;
            }

            const ext = item?.ext || 'jpeg';
            mediaKind = getMediaKindFromExt(ext);
            imageUrl = USE_MOCK_GALLERY ? buildMockFileUrl(id) : buildFileUrl(id, ext);
        } catch (e) {
            console.error(e);
            const failure = describeDetailFailure(e?.status, id || 'unknown', e?.message || 'Unknown error');
            errorTitle = failure.title;
            error = failure.message;
        } finally {
            isLoading = false;
        }
    }

    onMount(loadItem);

    function handleMediaError() {
        errorTitle = 'Media file could not be loaded';
        error = 'The item metadata loaded, but the original media file could not be displayed.';
        imageUrl = '';
    }

    function retryCurrentItem() {
        loadItem();
    }
</script>

<div class="image-container-page">
    <div class="img-box">
        {#if isLoading}
            <div class="loading">
                <div class="spinner"></div>
                <p>Loading image...</p>
            </div>
        {:else if error}
            <div class="error">
                <h3>{errorTitle}</h3>
                <p>{error}</p>
                <div class="error-actions">
                    <button class="btn" type="button" on:click={retryCurrentItem}>Try Again</button>
                    <a class="btn secondary-btn" href="/browse">Back to Browse</a>
                    <a class="btn secondary-btn" href="/random">Open Random</a>
                </div>
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
                        on:error={handleMediaError}
                    ></video>
                {:else}
                    <img class="media" src={imageUrl} alt="Selected file" on:error={handleMediaError} />
                {/if}
            </div>
        {/if}
    </div>

    <div class="controls">
        {#if mediaKind === 'video' && imageUrl && !isLoading && !error}
            <button
                class="btn secondary-btn icon-toggle-btn"
                type="button"
                aria-label={videoControlsEnabled ? 'Hide playback controls and mute video' : 'Enable playback controls and sound'}
                title={videoControlsEnabled ? 'Hide playback controls and mute video' : 'Enable playback controls and sound'}
                on:click={toggleVideoPlaybackMode}
            >
                {#if videoControlsEnabled}
                    <span class="icon-pair" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M14 5.23v13.54a1 1 0 0 1-1.64.77L7.6 16H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3.6l4.76-3.54A1 1 0 0 1 14 5.23Z"></path>
                            <path d="M18.36 8.05a1 1 0 0 1 1.41 0A5.97 5.97 0 0 1 21.5 12a5.97 5.97 0 0 1-1.73 3.95 1 1 0 0 1-1.41-1.41A3.98 3.98 0 0 0 19.5 12a3.98 3.98 0 0 0-1.14-2.54 1 1 0 0 1 0-1.41Z"></path>
                            <path d="M3.71 3.71a1 1 0 0 1 1.41 0l15.17 15.17a1 1 0 0 1-1.41 1.41L3.71 5.12a1 1 0 0 1 0-1.41Z"></path>
                        </svg>
                        <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M4 6a2 2 0 0 1 2-2h3v2H6v12h3v2H6a2 2 0 0 1-2-2V6Zm14.59 6L14 8.41V11H9v2h5v2.59L18.59 12Z"></path>
                            <path d="M20 5h-7v2h7v10h-7v2h7a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"></path>
                        </svg>
                    </span>
                {:else}
                    <span class="icon-pair" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M14 5.23v13.54a1 1 0 0 1-1.64.77L7.6 16H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3.6l4.76-3.54A1 1 0 0 1 14 5.23Z"></path>
                            <path d="M17.66 8.34a1 1 0 0 1 1.41 0A5.51 5.51 0 0 1 20.75 12a5.51 5.51 0 0 1-1.68 3.66 1 1 0 1 1-1.41-1.41A3.5 3.5 0 0 0 18.75 12a3.5 3.5 0 0 0-1.09-2.25 1 1 0 0 1 0-1.41Z"></path>
                        </svg>
                        <svg viewBox="0 0 24 24" focusable="false">
                            <path d="M8 6.82v10.36a1 1 0 0 0 1.53.85l8.14-5.18a1 1 0 0 0 0-1.7L9.53 5.97A1 1 0 0 0 8 6.82Z"></path>
                        </svg>
                    </span>
                {/if}
                <span class="sr-only">
                    {videoControlsEnabled ? 'Hide playback controls and mute video' : 'Enable playback controls and sound'}
                </span>
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

    .error-actions {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 20px;
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

    .icon-toggle-btn {
        min-width: 64px;
        padding: 10px 16px;
    }

    .icon-pair {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
    }

    .icon-pair svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
        flex: 0 0 auto;
    }

    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
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

    .error h3 {
        margin: 0 0 12px;
        color: #2c3e50;
        font-size: 1.4em;
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
