<script>
    import Button from "../../components/Button.svelte";
    import { onMount } from "svelte";
    import { fade, fly } from 'svelte/transition';
    import { buildApiUrl } from "$lib/config/publicEnv.js";
    import { getMediaKindFromExt } from "$lib/models/image.js";

    let randomSrc = "";
    let mediaKind = "image";
    let isLoading = true;
    let error = null;

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

            let response = await fetch(buildApiUrl("/get-random-image"));
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await response.json();
                if (data && typeof data.url === 'string') {
                    randomSrc = data.url;
                } else {
                    throw new Error('Invalid response format: missing url');
                }
            } else {
                // Fallback: API returned plain text URL
                const text = await response.text();
                // Strip surrounding quotes if any
                randomSrc = text.replace(/^\"|\"$/g, '');
            }
            mediaKind = getMediaKindFromExt(inferExtFromUrl(randomSrc));
            isLoading = false;
        } catch (err) {
            console.error(err);
            error = err.message || 'Unknown error';
            isLoading = false;
        }
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
        {:else if error}
            <div class="error" in:fade>
                <p>Error loading image: {error}</p>
                <button on:click={generateRandomPic}>Try Again</button>
            </div>
        {:else if randomSrc}
            <div class="image-wrapper" in:fade={{ duration: 300 }}>
                {#if mediaKind === 'video'}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video class="random-media" controls preload="metadata" playsinline>
                        <source src={randomSrc} type="video/webm" />
                    </video>
                {:else}
                    <img class="random-media" src={randomSrc} alt="Random selection" />
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

    @media (max-width: 768px) {
        .img-container {
            width: 100%;
        }

        .random-media {
            max-height: 60vh;
        }
    }
</style>
