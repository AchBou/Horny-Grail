<script>
  import { onDestroy, onMount } from 'svelte';
  import ReadAccessGate from '$lib/components/ReadAccessGate.svelte';
  import { fly } from 'svelte/transition';
  import {
    createMobileReadSession,
    fetchMobileAssetIntegrity,
    fetchItemById,
    fetchRandomBrowsePage,
    isAbortError,
    isUnauthorizedError
  } from '$lib/mobile/api.js';
  import { createMediaView, normalizeMediaViews } from '$lib/mobile/items.js';
  import { clearReadSession, getReadSession, saveReadSession } from '$lib/mobile/readSession.js';

  const NEXT_MEDIA_PAGE_SIZE = 6;
  const NEXT_MEDIA_ATTEMPTS = 3;
  const SWIPE_THRESHOLD_PX = 56;
  const SWIPE_MAX_VERTICAL_DRIFT_PX = 88;
  const SWIPE_TRANSITION_OFFSET_PX = 42;

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
  let randomController = null;
  let gestureStartX = 0;
  let gestureStartY = 0;
  let gestureDeltaX = 0;
  let gestureDeltaY = 0;
  let isTrackingGesture = false;
  let isAdvancing = false;
  let isTransitioning = false;
  let swipeDirection = 1;
  let viewerNotice = '';
  let viewerNoticeTimer = null;
  let hasReadSession = false;
  let accessCode = '';
  let accessSubmitting = false;
  let accessError = '';

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

  function showNotice(message) {
    clearTimeout(viewerNoticeTimer);
    viewerNotice = message;
    viewerNoticeTimer = window.setTimeout(() => {
      viewerNotice = '';
    }, 1800);
  }

  async function loadMedia(nextId = getRouteId(), { preserveMedia = false } = {}) {
    controller?.abort();
    const activeController = new AbortController();
    controller = activeController;
    isLoading = !preserveMedia;
    isTransitioning = preserveMedia;
    error = null;

    if (!preserveMedia) {
      media = null;
      integrity = null;
      videoControlsEnabled = false;
      showDetails = false;
      showChrome = true;
    }

    try {
      if (!nextId) {
        throw new Error('Missing media id in the URL');
      }

      const payload = await fetchItemById(nextId, { signal: activeController.signal });
      const nextMedia = createDetailMedia(payload, nextId);
      if (!nextMedia) {
        throw new Error('Media was not found');
      }

      const nextIntegrity = await fetchMobileAssetIntegrity(nextId, { signal: activeController.signal });
      id = nextId;
      media = nextMedia;
      integrity = nextIntegrity;
      videoControlsEnabled = false;
      return true;
    } catch (loadError) {
      if (isAbortError(loadError)) {
        return false;
      }

      if (isUnauthorizedError(loadError)) {
        clearReadSession();
        hasReadSession = false;
        accessError = 'Your access session expired. Enter the code again.';
        error = null;
        return false;
      }

      console.error('Failed to load media detail', loadError);
      if (preserveMedia) {
        showNotice(loadError?.message || 'Could not load another item');
      } else {
        error = loadError?.message || 'Could not open this item';
      }
      return false;
    } finally {
      if (controller === activeController && !activeController.signal.aborted) {
        isLoading = false;
        isTransitioning = false;
      }
    }
  }

  async function findRandomNextMedia(excludeId, signal) {
    for (let attempt = 0; attempt < NEXT_MEDIA_ATTEMPTS; attempt += 1) {
      const payload = await fetchRandomBrowsePage(null, NEXT_MEDIA_PAGE_SIZE, { signal });
      const candidate = normalizeMediaViews(payload).find((item) => item.id && item.id !== excludeId);

      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  async function loadRandomNextMedia(direction = 1) {
    if (!media || isLoading || isAdvancing || videoControlsEnabled) {
      return;
    }

    randomController?.abort();
    const activeRandomController = new AbortController();
    randomController = activeRandomController;
    isAdvancing = true;
    swipeDirection = direction >= 0 ? 1 : -1;

    try {
      const nextMedia = await findRandomNextMedia(media.id, activeRandomController.signal);
      if (!nextMedia) {
        showNotice('No other saved items yet');
        return;
      }

      const didLoad = await loadMedia(nextMedia.id, { preserveMedia: true });
      if (didLoad) {
        window.history.pushState({}, '', nextMedia.detailUrl);
      }
    } catch (loadError) {
      if (isAbortError(loadError)) {
        return;
      }

      console.error('Failed to load next random media', loadError);
      showNotice('Could not load another item');
    } finally {
      if (randomController === activeRandomController) {
        randomController = null;
        isAdvancing = false;
      }
    }
  }

  function resetGesture() {
    gestureStartX = 0;
    gestureStartY = 0;
    gestureDeltaX = 0;
    gestureDeltaY = 0;
    isTrackingGesture = false;
  }

  function handleTouchStart(event) {
    if (event.touches.length !== 1 || isLoading || isAdvancing || videoControlsEnabled) {
      resetGesture();
      return;
    }

    const touch = event.touches[0];
    gestureStartX = touch.clientX;
    gestureStartY = touch.clientY;
    gestureDeltaX = 0;
    gestureDeltaY = 0;
    isTrackingGesture = true;
  }

  function handleTouchMove(event) {
    if (!isTrackingGesture || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    gestureDeltaX = touch.clientX - gestureStartX;
    gestureDeltaY = touch.clientY - gestureStartY;

    if (Math.abs(gestureDeltaX) > Math.abs(gestureDeltaY) && event.cancelable) {
      event.preventDefault();
    }
  }

  async function handleTouchEnd() {
    if (!isTrackingGesture) {
      return;
    }

    const deltaX = gestureDeltaX;
    const deltaY = gestureDeltaY;
    resetGesture();

    if (
      Math.abs(deltaX) < SWIPE_THRESHOLD_PX ||
      Math.abs(deltaY) > SWIPE_MAX_VERTICAL_DRIFT_PX ||
      Math.abs(deltaX) <= Math.abs(deltaY)
    ) {
      return;
    }

    await loadRandomNextMedia(deltaX >= 0 ? 1 : -1);
  }

  function handleTouchCancel() {
    resetGesture();
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
    hasReadSession = Boolean(getReadSession());
    const handlePopState = () => {
      loadMedia(getRouteId(), { preserveMedia: Boolean(media) });
    };

    window.addEventListener('popstate', handlePopState);
    if (hasReadSession) {
      loadMedia();
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  });

  async function unlockReadAccess() {
    accessSubmitting = true;
    accessError = '';

    try {
      const session = await createMobileReadSession(accessCode.trim());
      saveReadSession(session);
      hasReadSession = true;
      accessCode = '';
      await loadMedia();
    } catch (unlockError) {
      console.error('Failed to unlock mobile detail view', unlockError);
      accessError = unlockError?.status === 401 ? 'That code was not accepted.' : (unlockError?.message || 'Could not unlock this view');
    } finally {
      accessSubmitting = false;
    }
  }

  onDestroy(() => {
    controller?.abort();
    randomController?.abort();
    clearTimeout(viewerNoticeTimer);
  });
</script>

<svelte:head>
  <title>{media ? `${media.kind === 'video' ? 'Clip' : 'Image'} | HornyGrail` : 'HornyGrail'}</title>
  <meta name="description" content="HornyGrail private mobile media viewer." />
</svelte:head>

<div class="viewer">
  {#if !hasReadSession}
    <ReadAccessGate
      bind:code={accessCode}
      busy={accessSubmitting}
      error={accessError}
      title="Unlock This View"
      copy="Enter the access code to open this item and the rest of your collection."
      submitLabel="Open item"
      on:submit={unlockReadAccess}
    />
  {:else if isLoading}
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
    <main
      class={`stage ${showChrome && !videoControlsEnabled ? 'with-info' : ''} ${showDetails ? 'with-details' : ''} ${isTransitioning ? 'busy' : ''}`}
      on:touchstart={handleTouchStart}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
      on:touchcancel={handleTouchCancel}
    >
      {#key media.id}
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
            in:fly={{ x: swipeDirection * SWIPE_TRANSITION_OFFSET_PX, duration: 180, opacity: 0.22 }}
            out:fly={{ x: swipeDirection * -SWIPE_TRANSITION_OFFSET_PX, duration: 160, opacity: 0.1 }}
          ></video>
        {:else}
          <img
            class="media"
            src={media.fileUrl}
            alt="Saved media"
            in:fly={{ x: swipeDirection * SWIPE_TRANSITION_OFFSET_PX, duration: 180, opacity: 0.22 }}
            out:fly={{ x: swipeDirection * -SWIPE_TRANSITION_OFFSET_PX, duration: 160, opacity: 0.1 }}
          />
        {/if}
      {/key}

      {#if media.kind !== 'video' || !videoControlsEnabled}
        <button class="media-toggle" type="button" aria-label="Toggle viewer controls" on:click={toggleChrome}></button>
      {/if}

      {#if isTransitioning}
        <div class="media-loading" aria-hidden="true">
          <div class="spinner small"></div>
        </div>
      {/if}
    </main>

    <nav class={`top-bar ${showChrome ? 'visible' : ''}`} aria-label="Detail navigation">
      <a class="pill" href="/">Back</a>
      <div class="top-actions">
        <button class="pill" type="button" disabled={isLoading || isAdvancing || videoControlsEnabled} on:click={loadRandomNextMedia}>
          {isAdvancing ? 'Loading' : 'Next'}
        </button>
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
        <p class="swipe-copy">Swipe for another</p>
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

    {#if viewerNotice}
      <aside class="viewer-notice" aria-live="polite">{viewerNotice}</aside>
    {/if}
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
    touch-action: pan-y pinch-zoom;
  }

  .stage.with-info {
    padding-bottom: 7rem;
  }

  .stage.with-info.with-details {
    padding-bottom: 10.5rem;
  }

  .stage.busy .media {
    opacity: 0.78;
    transform: scale(0.992);
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
    transition: opacity 160ms ease, transform 160ms ease;
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

  .media-loading {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    pointer-events: none;
    background: linear-gradient(180deg, rgba(18, 15, 13, 0.08), rgba(18, 15, 13, 0.18));
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

  .pill:disabled {
    opacity: 0.56;
    cursor: default;
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

  .swipe-copy {
    color: rgba(255, 249, 243, 0.72);
    font-size: 0.76rem;
    line-height: 1.2;
    text-align: right;
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

  .viewer-notice {
    position: fixed;
    left: 50%;
    bottom: calc(5.6rem + env(safe-area-inset-bottom, 0px));
    z-index: 4;
    transform: translateX(-50%);
    max-width: min(22rem, calc(100vw - 2rem));
    padding: 0.72rem 0.9rem;
    border: 1px solid rgba(255, 249, 243, 0.14);
    border-radius: 999px;
    background: rgba(22, 17, 13, 0.86);
    color: #fff9f3;
    font-size: 0.82rem;
    line-height: 1.2;
    text-align: center;
    backdrop-filter: blur(18px);
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

  .spinner.small {
    width: 2rem;
    height: 2rem;
    border-width: 3px;
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
