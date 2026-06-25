<script>
  import { onDestroy, onMount } from 'svelte';
  import { fetchAssetIntegrity, fetchItemById, isAbortError } from '$lib/mobile/api.js';
  import { createMediaView } from '$lib/mobile/items.js';

  let id = '';
  let media = null;
  let integrity = null;
  let isLoading = true;
  let error = null;
  let videoElement;
  let videoControlsEnabled = false;
  let showDetails = false;
  let controller = null;

  function getRouteId() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
  }

  function createDetailMedia(payload, routeId) {
    if (payload && typeof payload === 'object') {
      return createMediaView({ ...payload, id: payload.id || routeId });
    }

    if (typeof payload === 'string') {
      return createMediaView(payload);
    }

    return null;
  }

  async function loadMedia() {
    controller?.abort();
    const activeController = new AbortController();
    controller = activeController;
    isLoading = true;
    error = null;
    media = null;
    integrity = null;
    videoControlsEnabled = false;

    try {
      id = getRouteId();
      if (!id) {
        throw new Error('Missing media id in the URL');
      }

      const payload = await fetchItemById(id, { signal: activeController.signal });
      const nextMedia = createDetailMedia(payload, id);
      if (!nextMedia) {
        throw new Error('Media was not found');
      }

      media = nextMedia;
      integrity = await fetchAssetIntegrity(id, { signal: activeController.signal });
    } catch (loadError) {
      if (isAbortError(loadError)) {
        return;
      }

      console.error('Failed to load media detail', loadError);
      error = loadError?.message || 'Could not open this item';
    } finally {
      if (controller === activeController && !activeController.signal.aborted) {
        isLoading = false;
      }
    }
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
        console.error('Unable to start video playback with sound', playError);
      }
      return;
    }

    videoElement.currentTime = 0;
    try {
      await videoElement.play();
    } catch (playError) {
      console.error('Unable to resume muted video preview', playError);
    }
  }

  onMount(() => {
    loadMedia();
  });

  onDestroy(() => {
    controller?.abort();
  });
</script>

<svelte:head>
  <title>{media ? `${media.kind === 'video' ? 'Clip' : 'Image'} | HornyGrail` : 'HornyGrail'}</title>
  <meta name="description" content="HornyGrail private mobile media viewer." />
</svelte:head>

<div class="viewer">
  <nav class="top-bar" aria-label="Detail navigation">
    <a class="pill" href="/">Back</a>
    {#if media}
      <a class="pill dark" href={media.fileUrl} target="_blank" rel="noreferrer">Original</a>
    {/if}
  </nav>

  {#if isLoading}
    <section class="center-state">
      <div class="spinner"></div>
      <p>Opening...</p>
    </section>
  {:else if error}
    <section class="center-state">
      <h1>Could not open it.</h1>
      <p>{error}</p>
      <button class="pill dark" type="button" on:click={loadMedia}>Try Again</button>
    </section>
  {:else if media}
    <main class="stage">
      {#if media.kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={videoElement}
          class="media"
          src={media.fileUrl}
          poster={media.thumbnailUrl}
          autoplay
          controls={videoControlsEnabled}
          loop={!videoControlsEnabled}
          muted={!videoControlsEnabled}
          playsinline
          preload="auto"
        ></video>
      {:else}
        <img class="media" src={media.fileUrl} alt="Saved media" />
      {/if}
    </main>

    <section class="action-sheet">
      <div>
        <p class="eyebrow">{media.kind === 'video' ? 'Clip' : 'Image'}</p>
        <h1>Saved in your Grail</h1>
      </div>

      <div class="actions">
        {#if media.kind === 'video'}
          <button class="pill dark" type="button" on:click={toggleVideoPlaybackMode}>
            {videoControlsEnabled ? 'Mute Preview' : 'Sound + Controls'}
          </button>
        {/if}
        <button class="pill" type="button" on:click={() => showDetails = !showDetails}>
          {showDetails ? 'Hide Details' : 'Details'}
        </button>
      </div>

      {#if showDetails}
        <dl class="details">
          <div>
            <dt>Type</dt>
            <dd>{media.ext}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{media.dateAdded || 'Unknown'}</dd>
          </div>
          <div class="wide">
            <dt>Hash</dt>
            <dd>{media.id}</dd>
          </div>
        </dl>

        {#if integrity?.repairRequired}
          <p class="repair">Repair needed: {integrity.missing.join(', ')}</p>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: #17100c;
    color: #fff7ed;
    font-family: 'Trebuchet MS', 'Avenir Next', sans-serif;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .viewer {
    min-height: 100vh;
    background:
      radial-gradient(circle at 20% 0%, rgba(217, 95, 31, 0.28), transparent 35%),
      radial-gradient(circle at 92% 14%, rgba(13, 148, 136, 0.2), transparent 30%),
      #17100c;
  }

  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem;
    pointer-events: none;
  }

  .top-bar > * {
    pointer-events: auto;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.8rem;
    border: 1px solid rgba(255, 247, 237, 0.2);
    border-radius: 999px;
    padding: 0.78rem 1rem;
    background: rgba(255, 247, 237, 0.14);
    color: #fff7ed;
    font: inherit;
    font-weight: 800;
    text-decoration: none;
    backdrop-filter: blur(16px);
    cursor: pointer;
  }

  .pill.dark {
    border-color: transparent;
    background: #fff7ed;
    color: #20140e;
  }

  .stage {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 5rem 0 12rem;
  }

  .media {
    display: block;
    max-width: 100%;
    max-height: 78vh;
    object-fit: contain;
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28);
  }

  .action-sheet {
    position: fixed;
    left: 0.75rem;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 2;
    display: grid;
    gap: 1rem;
    max-width: 42rem;
    margin: 0 auto;
    padding: 1rem;
    border: 1px solid rgba(255, 247, 237, 0.12);
    border-radius: 1.5rem;
    background: rgba(32, 20, 14, 0.8);
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(22px);
  }

  h1,
  p,
  dl,
  dd {
    margin: 0;
  }

  h1 {
    font-size: clamp(1.65rem, 8vw, 3rem);
    line-height: 0.95;
    letter-spacing: -0.055em;
  }

  .eyebrow {
    margin-bottom: 0.35rem;
    color: #ffc38f;
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .actions {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  .details {
    display: grid;
    gap: 0.65rem;
    color: rgba(255, 247, 237, 0.76);
  }

  .details div {
    min-width: 0;
    padding: 0.75rem;
    border-radius: 1rem;
    background: rgba(255, 247, 237, 0.08);
  }

  .details dt {
    margin-bottom: 0.25rem;
    color: rgba(255, 195, 143, 0.88);
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .details dd {
    overflow-wrap: anywhere;
    font-size: 0.84rem;
  }

  .repair {
    color: #ffd18a;
    font-weight: 800;
  }

  .center-state {
    min-height: 100vh;
    display: grid;
    place-items: center;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
  }

  .center-state p {
    color: rgba(255, 247, 237, 0.72);
  }

  .spinner {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 999px;
    border: 4px solid rgba(255, 247, 237, 0.18);
    border-top-color: #fff7ed;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (min-width: 720px) {
    .action-sheet {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      left: 1.5rem;
      right: 1.5rem;
      bottom: 1.5rem;
    }

    .details {
      grid-column: 1 / -1;
      grid-template-columns: 1fr 1fr;
    }

    .details .wide {
      grid-column: 1 / -1;
    }
  }
</style>
