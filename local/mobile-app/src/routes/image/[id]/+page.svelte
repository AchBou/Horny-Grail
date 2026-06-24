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
        throw new Error('Media metadata was not found');
      }

      media = nextMedia;
      integrity = await fetchAssetIntegrity(id, { signal: activeController.signal });
    } catch (loadError) {
      if (isAbortError(loadError)) {
        return;
      }

      console.error('Failed to load media detail', loadError);
      error = loadError?.message || 'Failed to load media detail';
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
  <title>{media ? `${media.kind === 'video' ? 'Video' : 'Image'} ${media.id.slice(0, 12)}` : 'Media Detail'} | HornyGrail Mobile</title>
  <meta name="description" content="HornyGrail private mobile media detail view." />
</svelte:head>

<div class="page">
  <main class="detail-shell">
    <nav class="top-bar" aria-label="Detail navigation">
      <a class="nav-link" href="/">Back</a>
      {#if media}
        <a class="nav-link accent" href={media.fileUrl} target="_blank" rel="noreferrer">Open Original</a>
      {/if}
    </nav>

    {#if isLoading}
      <section class="panel center-state">
        <div class="spinner"></div>
        <p>Loading media...</p>
      </section>
    {:else if error}
      <section class="panel center-state">
        <p class="error-text">{error}</p>
        <button class="secondary-button" type="button" on:click={loadMedia}>Try Again</button>
      </section>
    {:else if media}
      <section class="media-stage">
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
          <img class="media" src={media.fileUrl} alt={media.id} />
        {/if}
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <p class="section-label">{media.kind === 'video' ? 'Video' : 'Image'}</p>
            <h1>{media.id.slice(0, 12)}...</h1>
          </div>
          {#if media.kind === 'video'}
            <button class="secondary-button" type="button" on:click={toggleVideoPlaybackMode}>
              {videoControlsEnabled ? 'Mute Preview' : 'Controls + Sound'}
            </button>
          {/if}
        </div>

        <dl class="meta-grid">
          <div>
            <dt>Hash</dt>
            <dd>{media.id}</dd>
          </div>
          <div>
            <dt>Extension</dt>
            <dd>{media.ext}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{media.dateAdded || 'Unknown'}</dd>
          </div>
        </dl>

        {#if integrity}
          <div class={`integrity ${integrity.repairRequired ? 'warning' : 'ok'}`}>
            {#if integrity.repairRequired}
              Repair needed: {integrity.missing.join(', ')}
            {:else}
              Metadata, original, and thumbnail are present.
            {/if}
          </div>
        {/if}
      </section>
    {/if}
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(255, 144, 84, 0.18), transparent 28%),
      radial-gradient(circle at bottom right, rgba(28, 181, 154, 0.18), transparent 26%),
      linear-gradient(180deg, #fff7f0 0%, #f6efe7 42%, #efe5da 100%);
    color: #241811;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }

  .page {
    min-height: 100vh;
  }

  .detail-shell {
    max-width: 58rem;
    margin: 0 auto;
    padding: 1rem 1rem 3rem;
  }

  .top-bar {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .nav-link,
  .secondary-button {
    border: none;
    border-radius: 0.7rem;
    padding: 0.78rem 1rem;
    background: rgba(255, 252, 247, 0.86);
    color: #6c5443;
    border: 1px solid rgba(108, 84, 67, 0.22);
    font-size: 0.95rem;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }

  .nav-link.accent,
  .secondary-button {
    background: #0f766e;
    color: #f1fffd;
    border-color: transparent;
  }

  .media-stage {
    min-height: 52vh;
    display: grid;
    place-items: center;
    border-radius: 1rem;
    overflow: hidden;
    background:
      linear-gradient(135deg, rgba(36, 24, 17, 0.92), rgba(72, 45, 27, 0.84)),
      #241811;
    box-shadow: 0 18px 42px rgba(65, 43, 29, 0.18);
  }

  .media {
    display: block;
    max-width: 100%;
    max-height: 72vh;
    object-fit: contain;
  }

  .panel {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(255, 252, 247, 0.86);
    border: 1px solid rgba(73, 44, 29, 0.12);
    border-radius: 0.9rem;
    box-shadow: 0 12px 32px rgba(65, 43, 29, 0.08);
    backdrop-filter: blur(12px);
  }

  .center-state {
    min-height: 45vh;
    display: grid;
    place-items: center;
    text-align: center;
    gap: 1rem;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .section-label {
    margin: 0 0 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.78rem;
    color: #9b4d20;
  }

  h1,
  p,
  dl,
  dd {
    margin: 0;
  }

  h1 {
    font-size: clamp(1.8rem, 8vw, 3rem);
    line-height: 0.95;
  }

  .meta-grid {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
    color: #5f4f42;
  }

  .meta-grid div {
    min-width: 0;
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: rgba(29, 24, 20, 0.06);
  }

  .meta-grid dt {
    margin-bottom: 0.25rem;
    color: #8a4a22;
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .meta-grid dd {
    overflow-wrap: anywhere;
    font-family: Consolas, monospace;
    font-size: 0.82rem;
  }

  .integrity {
    margin-top: 1rem;
    padding: 0.8rem;
    border-radius: 0.75rem;
    font-weight: 700;
  }

  .integrity.ok {
    background: #d7efe7;
    color: #0f5f56;
  }

  .integrity.warning {
    background: #f9e3c4;
    color: #9b4d20;
  }

  .error-text {
    color: #9a2e1b;
  }

  .spinner {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 999px;
    border: 4px solid rgba(36, 24, 17, 0.12);
    border-top-color: #d95f1f;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (min-width: 760px) {
    .detail-shell {
      padding: 1.5rem 1.5rem 3.5rem;
    }

    .meta-grid {
      grid-template-columns: 2fr 1fr 1fr;
    }
  }

  @media (max-width: 560px) {
    .section-heading,
    .top-bar {
      align-items: stretch;
      flex-direction: column;
    }

    .media-stage {
      min-height: 42vh;
    }
  }
</style>
