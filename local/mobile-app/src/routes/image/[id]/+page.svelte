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
  let showChrome = true;
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
    showChrome = true;
    showDetails = false;

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

  function toggleChrome() {
    showChrome = !showChrome;
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
  {#if isLoading}
    <section class="center-state">
      <div class="spinner"></div>
      <p>Opening...</p>
    </section>
  {:else if error}
    <section class="center-state">
      <h1>Could not open it.</h1>
      <p>{error}</p>
      <button class="pill solid" type="button" on:click={loadMedia}>Try Again</button>
    </section>
  {:else if media}
    <main class={`stage ${showChrome && !videoControlsEnabled ? 'with-info' : ''} ${showDetails ? 'with-details' : ''}`}>
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

      {#if media.kind !== 'video' || !videoControlsEnabled}
        <button class="media-toggle" type="button" aria-label="Toggle viewer controls" on:click={toggleChrome}></button>
      {/if}
    </main>

    <nav class={`top-bar ${showChrome ? 'visible' : ''}`} aria-label="Detail navigation">
      <a class="pill" href="/">Back</a>
      <div class="top-actions">
        {#if media.kind === 'video'}
          <button class="pill solid" type="button" on:click={toggleVideoPlaybackMode}>
            {videoControlsEnabled ? 'Preview' : 'Sound'}
          </button>
        {/if}
        <button class="pill" type="button" on:click={() => showDetails = !showDetails}>
          {showDetails ? 'Hide info' : 'Info'}
        </button>
        <a class="pill solid" href={media.fileUrl} target="_blank" rel="noreferrer">Original</a>
      </div>
    </nav>

    <section class={`info-sheet ${showChrome && !videoControlsEnabled ? 'visible' : ''}`}>
      <div class="info-row">
        <div>
          <p class="eyebrow">{media.kind === 'video' ? 'Clip ID' : 'Image ID'}</p>
          <h1 class="item-id">{media.id}</h1>
        </div>
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
        </dl>

        {#if integrity?.repairRequired}
          <p class="repair">Repair needed: {integrity.missing.join(', ')}</p>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  :global(:root) {
    --font-ui: 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    --font-display: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(a),
  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    -webkit-tap-highlight-color: transparent;
  }

  :global(a:focus),
  :global(button:focus),
  :global(input:focus),
  :global(select:focus),
  :global(textarea:focus) {
    outline: none;
  }

  :global(a:focus-visible),
  :global(button:focus-visible),
  :global(input:focus-visible),
  :global(select:focus-visible),
  :global(textarea:focus-visible) {
    outline: 2px solid rgba(255, 199, 159, 0.88);
    outline-offset: 2px;
  }

  .viewer {
    min-height: 100vh;
    color: #fff9f3;
    font-family: var(--font-ui);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background:
      radial-gradient(circle at 18% 0%, rgba(213, 102, 42, 0.18), transparent 32%),
      radial-gradient(circle at 88% 12%, rgba(29, 122, 109, 0.16), transparent 28%),
      #120f0d;
  }

  .stage {
    position: relative;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 4.4rem 0 1.2rem;
  }

  .stage.with-info {
    padding-bottom: 7rem;
  }

  .stage.with-info.with-details {
    padding-bottom: 10.5rem;
  }

  .media-toggle {
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .media {
    display: block;
    position: relative;
    z-index: 0;
    max-width: 100%;
    max-height: 82vh;
    object-fit: contain;
  }

  .stage.with-info .media {
    max-height: calc(100dvh - 12rem);
  }

  .stage.with-info.with-details .media {
    max-height: calc(100dvh - 15.5rem);
  }

  .top-bar,
  .info-sheet {
    position: fixed;
    left: 0;
    right: 0;
    z-index: 3;
    opacity: 0;
    pointer-events: none;
    transition: opacity 160ms ease, transform 160ms ease;
  }

  .top-bar.visible,
  .info-sheet.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .top-bar {
    top: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    padding: calc(0.9rem + env(safe-area-inset-top, 0px)) 0.9rem 0.9rem;
    transform: translateY(-8px);
  }

  .top-bar.visible {
    transform: translateY(0);
  }

  .top-actions {
    display: flex;
    gap: 0.5rem;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.55rem;
    border: 1px solid rgba(255, 249, 243, 0.18);
    border-radius: 999px;
    padding: 0.7rem 0.9rem;
    background: rgba(255, 249, 243, 0.1);
    color: #fff9f3;
    font: inherit;
    font-weight: 700;
    font-size: 0.88rem;
    text-decoration: none;
    backdrop-filter: blur(16px);
    cursor: pointer;
  }

  .pill.solid {
    border-color: transparent;
    background: #fff9f3;
    color: #1f1814;
  }

  .info-sheet {
    bottom: 0;
    padding: 0 0.75rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
    transform: translateY(8px);
  }

  .info-sheet.visible {
    transform: translateY(0);
  }

  .info-sheet > * {
    max-width: 42rem;
    margin: 0 auto;
  }

  .info-row,
  .details {
    border: 1px solid rgba(255, 249, 243, 0.12);
    background: rgba(22, 17, 13, 0.64);
    backdrop-filter: blur(18px);
  }

  .info-row {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.82rem 0.9rem;
    border-radius: 1.1rem;
    box-shadow: 0 18px 46px rgba(0, 0, 0, 0.18);
  }

  h1,
  p,
  dl,
  dd {
    margin: 0;
  }

  h1 {
    font-size: clamp(1.05rem, 5vw, 1.6rem);
    line-height: 1.04;
    letter-spacing: -0.03em;
    font-family: var(--font-display);
    font-weight: 700;
  }

  .item-id {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-family: var(--font-ui);
    font-size: 0.88rem;
    line-height: 1.22;
    letter-spacing: 0.01em;
  }

  .eyebrow {
    margin-bottom: 0.28rem;
    color: #ffc79f;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .details {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.55rem;
    padding: 0.8rem;
    border-radius: 1rem;
    color: rgba(255, 249, 243, 0.8);
  }

  .details div {
    min-width: 0;
  }

  .details dt {
    margin-bottom: 0.2rem;
    color: rgba(255, 199, 159, 0.9);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .details dd {
    overflow-wrap: anywhere;
    font-size: 0.8rem;
    line-height: 1.28;
  }

  .repair {
    max-width: 42rem;
    margin: 0.55rem auto 0;
    color: #ffd18a;
    font-weight: 700;
    font-size: 0.82rem;
    text-align: left;
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
    color: rgba(255, 249, 243, 0.72);
    font-size: 0.96rem;
  }

  .spinner {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 999px;
    border: 4px solid rgba(255, 249, 243, 0.18);
    border-top-color: #fff9f3;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (min-width: 720px) {
    .top-bar {
      padding-inline: 1.4rem;
    }

    .info-sheet {
      padding-inline: 1.4rem;
    }

    .details {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
