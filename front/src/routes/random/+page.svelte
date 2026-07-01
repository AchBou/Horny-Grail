<script>
    import Button from "../../components/Button.svelte";
    import { onMount } from "svelte";
    import { fade } from 'svelte/transition';
    import { buildApiUrl, buildFileUrl } from "$lib/config/publicEnv.js";
    import { getMediaKindFromExt } from "$lib/models/image.js";

    let randomSrc = "";
    let mediaKind = "image";
    let isLoading = true;
    let error = null;
    let errorTitle = "Random image unavailable";
    let mediaLoadFailed = false;

    function describeRandomFailure(status, fallbackMessage) {
        if (status === 404) {
            return {
                title: "Nothing is available yet",
                message: "The backend did not find an active item to show. Upload media first, then try again."
            };
        }

        if (status >= 500) {
            return {
                title: "Random picker is temporarily unavailable",
                message: "The service returned an error while selecting media. Try again in a moment."
            };
        }

        return {
            title: "Random image unavailable",
            message: fallbackMessage || "Unable to load a random item right now."
        };
    }

    function inferExtFromUrl(url) {
        try {
            const pathname = new URL(url).pathname;
            const ext = pathname.split('.').pop();
            return ext ? ext.toLowerCase() : null;
        } catch {
            const base = url.split('?')[0];
            const ext = base.split('.').pop();
            return ext ? ext.toLowerCase() : null;
        }
    }

    async function generateRandomPic() {
        try {
            isLoading = true;
            randomSrc = "";
            mediaKind = "image";
            error = null;
            errorTitle = "Random image unavailable";
            mediaLoadFailed = false;

            const response = await fetch(buildApiUrl("/get-random-image"));
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                const requestError = new Error(payload?.message || `HTTP error! Status: ${response.status}`);
                requestError.status = response.status;
                throw requestError;
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await response.json();
                if (data?.id && data?.ext) {
                    randomSrc = buildFileUrl(data.id, data.ext);
                } else if (typeof data?.url === 'string') {
                    randomSrc = data.url;
                } else {
                    throw new Error('Invalid response format: missing media item');
                }
            } else {
                const text = await response.text();
                randomSrc = text.replace(/^\"|\"$/g, '');
            }

            mediaKind = getMediaKindFromExt(inferExtFromUrl(randomSrc));
        } catch (err) {
            console.error(err);
            const failure = describeRandomFailure(err?.status, err.message || 'Unknown error');
            errorTitle = failure.title;
            error = failure.message;
        } finally {
            isLoading = false;
        }
    }

    function handleMediaError() {
        mediaLoadFailed = true;
        errorTitle = "Media file could not be loaded";
        error = "The random item metadata loaded, but the media file itself could not be displayed.";
    }

    onMount(generateRandomPic);
</script>

<div class="random-container">
    <h2>Random {mediaKind === 'video' ? 'Video' : 'Image'}</h2>

    <div class="img-container">
        {#if isLoading}
            <div class="loading" in:fade>
                <div class="spinner"></div>
                <p>Loading a random image...</p>
            </div>
        {:else if error || mediaLoadFailed}
            <div class="error" in:fade>
                <h3>{errorTitle}</h3>
                <p>{error}</p>
                <div class="actions">
                    <button on:click={generateRandomPic}>Try Again</button>
                    <a href="/browse">Open Browse</a>
                </div>
            </div>
        {:else if randomSrc}
            <div class="image-wrapper" in:fade={{ duration: 300 }}>
                {#if mediaKind === 'video'}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video class="random-media" src={randomSrc} autoplay loop muted playsinline preload="auto" on:error={handleMediaError}></video>
                {:else}
                    <img class="random-media" src={randomSrc} alt="Random selection" on:error={handleMediaError} />
                {/if}
            </div>
        {/if}
    </div>

    <div class="controls">
        <Button on:click={generateRandomPic} text="Get Another" primary={true} size="medium"/>
    </div>
</div>

<style>
    .random-container {
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

    .img-container {
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

    .random-media {
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

    .actions {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 20px;
    }

    .actions a {
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

    .actions a:hover {
        border-color: rgba(44, 62, 80, 0.35);
        background-color: #f7f8fa;
    }

    @media (max-width: 768px) {
        .img-container {
            width: 100%;
        }

        .random-media {
            max-height: 60vh;
        }
    }
</style>
