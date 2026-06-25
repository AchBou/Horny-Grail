<script>
  import { onDestroy, onMount } from 'svelte';
  import { fetchRandomBrowsePage, isAbortError } from '$lib/mobile/api.js';
  import { normalizeMediaViews } from '$lib/mobile/items.js';
  import { runUploadFlow } from '$lib/mobile/uploadFlow.js';

  const BROWSE_PAGE_SIZE = 24;
  const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.webm,image/*,video/webm';
  const STATUS_LABELS = {
    preparing: 'Preparing',
    queued: 'Queued',
    hashing: 'Reading',
    checking: 'Checking',
    duplicate: 'Already saved',
    'uploading-original': 'Saving original',
    'repairing-original': 'Fixing original',
    thumbnailing: 'Making cover',
    'uploading-thumbnail': 'Saving cover',
    'repairing-thumbnail': 'Fixing cover',
    registering: 'Finishing',
    complete: 'Saved',
    cancelled: 'Cancelled',
    failed: 'Needs attention'
  };
  const CANCELLABLE_STATUSES = new Set([
    'preparing',
    'queued',
    'hashing',
    'checking',
    'uploading-original',
    'repairing-original',
    'thumbnailing',
    'uploading-thumbnail',
    'repairing-thumbnail',
    'registering'
  ]);

  let browseItems = [];
  let browseCursor = null;
  let browseHasMore = false;
  let browseLoading = true;
  let browseLoadingMore = false;
  let browseError = null;
  let browseSentinel;
  let browseObserver;
  let observedBrowseSentinel = null;
  let browseAbortController = null;

  let uploadItems = [];
  let isProcessingQueue = false;
  let fileInput;
  let showUploadQueue = false;

  $: activeUploadCount = uploadItems.filter((item) => CANCELLABLE_STATUSES.has(item.status)).length;
  $: finishedUploadCount = uploadItems.filter((item) => item.status === 'complete' || item.status === 'duplicate').length;
  $: failedUploadCount = uploadItems.filter((item) => item.status === 'failed').length;
  $: uploadSummary = activeUploadCount > 0
    ? `${activeUploadCount} saving`
    : failedUploadCount > 0
      ? `${failedUploadCount} need attention`
      : finishedUploadCount > 0
        ? `${finishedUploadCount} saved`
        : 'Ready';

  function nextLocalId() {
    return `upload-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  function createUploadPreview(file) {
    return URL.createObjectURL(file);
  }

  async function copyPickerFile(file) {
    const buffer = await file.arrayBuffer();
    return new File([buffer], file.name, {
      type: file.type,
      lastModified: file.lastModified
    });
  }

  function releasePreview(url) {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }

  function getUploadItem(localId) {
    return uploadItems.find((item) => item.localId === localId);
  }

  function updateUploadItem(localId, patch) {
    uploadItems = uploadItems.map((item) => item.localId === localId ? { ...item, ...patch } : item);
  }

  function appendBrowseItems(items) {
    const seen = new Set(browseItems.map((item) => item.id));
    const nextItems = normalizeMediaViews(items).filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }

      seen.add(item.id);
      return true;
    });

    browseItems = browseItems.concat(nextItems);
  }

  function observeBrowseSentinel() {
    if (!browseObserver || !browseSentinel || observedBrowseSentinel === browseSentinel) {
      return;
    }

    if (observedBrowseSentinel) {
      browseObserver.unobserve(observedBrowseSentinel);
    }

    browseObserver.observe(browseSentinel);
    observedBrowseSentinel = browseSentinel;
  }

  async function loadBrowsePage(cursor = null) {
    const controller = new AbortController();

    browseAbortController?.abort();
    browseAbortController = controller;

    if (!cursor) {
      browseLoading = true;
      browseError = null;
      browseItems = [];
      browseCursor = null;
      browseHasMore = false;
    } else {
      browseLoadingMore = true;
    }

    try {
      const payload = await fetchRandomBrowsePage(cursor, BROWSE_PAGE_SIZE, { signal: controller.signal });
      appendBrowseItems(payload?.items || []);
      browseCursor = payload?.cursor || null;
      browseHasMore = Boolean(payload?.hasMore);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      console.error('Failed to load browse page', error);
      browseError = error?.message || 'Could not load your Grail';
    } finally {
      if (browseAbortController === controller) {
        browseLoading = false;
        browseLoadingMore = false;
      }
    }
  }

  function statusText(item) {
    return STATUS_LABELS[item.status] || item.status || 'Pending';
  }

  function outcomeText(outcome) {
    if (outcome === 'duplicate') {
      return 'Already in your Grail';
    }

    if (outcome === 'repaired') {
      return 'Saved and repaired';
    }

    if (outcome === 'uploaded') {
      return 'Saved to your Grail';
    }

    return '';
  }

  function isVideoUpload(item) {
    return item.file.type.startsWith('video/') || item.name.toLowerCase().endsWith('.webm');
  }

  function canCancel(item) {
    return CANCELLABLE_STATUSES.has(item.status);
  }

  function detailUrlForUpload(item) {
    return item.id ? `/image/${item.id}` : '';
  }

  async function processQueue() {
    if (isProcessingQueue) {
      return;
    }

    isProcessingQueue = true;

    try {
      while (true) {
        const nextItem = uploadItems.find((item) => item.status === 'queued');
        if (!nextItem) {
          break;
        }

        const controller = nextItem.controller || new AbortController();
        updateUploadItem(nextItem.localId, {
          controller,
          status: 'hashing',
          error: null,
          message: ''
        });

        try {
          const result = await runUploadFlow(nextItem.file, (status, detail = null) => {
            updateUploadItem(nextItem.localId, {
              status,
              id: detail?.id || getUploadItem(nextItem.localId)?.id || null,
              integrity: detail?.integrity || getUploadItem(nextItem.localId)?.integrity || null
            });
          }, { signal: controller.signal });

          updateUploadItem(nextItem.localId, {
            status: result.outcome === 'duplicate' ? 'duplicate' : 'complete',
            id: result.id,
            ext: result.ext,
            outcome: result.outcome,
            integrity: result.integrity,
            message: outcomeText(result.outcome)
          });
        } catch (error) {
          if (isAbortError(error)) {
            updateUploadItem(nextItem.localId, {
              status: 'cancelled',
              error: null,
              message: 'Cancelled'
            });
            continue;
          }

          console.error('Upload flow failed', error);
          updateUploadItem(nextItem.localId, {
            status: 'failed',
            error: error?.message || 'Upload failed',
            message: 'Could not save this file'
          });
        }
      }
    } finally {
      isProcessingQueue = false;

      if (uploadItems.some((item) => item.status === 'queued')) {
        processQueue();
      }
    }
  }

  async function enqueueFiles(fileList) {
    const pickerFiles = Array.from(fileList || []);
    const placeholderItems = pickerFiles.map((file) => ({
      localId: nextLocalId(),
      file,
      name: file.name,
      size: file.size,
      previewUrl: createUploadPreview(file),
      status: 'preparing',
      message: '',
      error: null,
      id: null,
      ext: null,
      outcome: null,
      integrity: null,
      controller: new AbortController()
    }));

    if (placeholderItems.length === 0) {
      return;
    }

    showUploadQueue = true;
    uploadItems = uploadItems.concat(placeholderItems);

    for (const item of placeholderItems) {
      const current = getUploadItem(item.localId);
      if (!current || current.status === 'cancelled') {
        continue;
      }

      try {
        const copiedFile = await copyPickerFile(item.file);
        const latest = getUploadItem(item.localId);
        if (!latest || latest.status === 'cancelled') {
          continue;
        }

        const previewUrl = createUploadPreview(copiedFile);
        releasePreview(item.previewUrl);
        updateUploadItem(item.localId, {
          file: copiedFile,
          size: copiedFile.size,
          previewUrl,
          status: 'queued'
        });
      } catch (error) {
        console.error('Failed to copy selected file', error);
        updateUploadItem(item.localId, {
          status: 'failed',
          error: 'Try choosing the file from device storage instead of a cloud or recent-file provider.',
          message: 'Could not read this file'
        });
      }
    }

    processQueue();
  }

  function onFileInputChange(event) {
    const files = event.currentTarget?.files;
    if (!files?.length) {
      return;
    }

    enqueueFiles(files);
    event.currentTarget.value = '';
  }

  function retryUpload(localId) {
    updateUploadItem(localId, {
      status: 'queued',
      error: null,
      message: '',
      outcome: null,
      controller: new AbortController()
    });
    processQueue();
  }

  function cancelUpload(localId) {
    const item = getUploadItem(localId);
    item?.controller?.abort();
    updateUploadItem(localId, {
      status: 'cancelled',
      error: null,
      message: 'Cancelled'
    });
  }

  function removeUpload(localId) {
    const item = getUploadItem(localId);
    item?.controller?.abort();
    releasePreview(item?.previewUrl);
    uploadItems = uploadItems.filter((entry) => entry.localId !== localId);
  }

  function retryBrowse() {
    loadBrowsePage(null);
  }

  function openPicker() {
    fileInput?.click();
  }

  onMount(() => {
    loadBrowsePage(null);

    browseObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry?.isIntersecting || browseLoading || browseLoadingMore || !browseHasMore || !browseCursor) {
        return;
      }

      loadBrowsePage(browseCursor);
    }, { rootMargin: '260px 0px' });

    observeBrowseSentinel();
  });

  $: if (browseObserver && browseSentinel) {
    observeBrowseSentinel();
  }

  onDestroy(() => {
    browseAbortController?.abort();
    browseObserver?.disconnect();
    for (const item of uploadItems) {
      item.controller?.abort();
      releasePreview(item.previewUrl);
    }
  });
</script>

<svelte:head>
  <title>HornyGrail</title>
  <meta
    name="description"
    content="Private HornyGrail mobile gallery for browsing and uploading media."
  />
</svelte:head>

<div class="page">
  <header class="app-bar">
    <div>
      <p class="kicker">Private Vault</p>
      <h1>HornyGrail</h1>
    </div>
    <button class="round-button" type="button" aria-label="Refresh gallery" on:click={retryBrowse}>
      Refresh
    </button>
  </header>

  <main class="shell">
    <section class="feature-card">
      <div>
        <p class="feature-label">Drop something new</p>
        <h2>Save from your phone in one tap.</h2>
        <p>Images and WebM clips are checked, thumbnailed, and added to the gallery automatically.</p>
      </div>
      <button class="primary-button" type="button" on:click={openPicker}>
        Add Media
      </button>
      <input
        bind:this={fileInput}
        class="hidden-input"
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        on:change={onFileInputChange}
      />
    </section>

    {#if uploadItems.length > 0}
      <section class={`upload-dock ${showUploadQueue ? 'expanded' : ''}`}>
        <button class="dock-summary" type="button" on:click={() => showUploadQueue = !showUploadQueue}>
          <span>Uploads</span>
          <strong>{uploadSummary}</strong>
        </button>

        {#if showUploadQueue}
          <div class="upload-list">
            {#each uploadItems as item (item.localId)}
              <article class="upload-card">
                <div class="upload-thumb">
                  {#if isVideoUpload(item)}
                    <video src={item.previewUrl} muted playsinline preload="metadata"></video>
                  {:else}
                    <img src={item.previewUrl} alt={item.name} />
                  {/if}
                </div>
                <div class="upload-body">
                  <div class="upload-line">
                    <div>
                      <h3>{item.name}</h3>
                      <p>{statusText(item)}</p>
                    </div>
                    <span class={`status-dot ${item.status}`}></span>
                  </div>

                  {#if item.message}
                    <p class={`message ${item.status === 'failed' ? 'error-text' : item.status === 'cancelled' ? 'warning' : 'success'}`}>{item.message}</p>
                  {/if}

                  {#if item.error}
                    <p class="message error-text">{item.error}</p>
                  {/if}

                  <div class="upload-actions">
                    {#if canCancel(item)}
                      <button class="text-button" type="button" on:click={() => cancelUpload(item.localId)}>Cancel</button>
                    {/if}
                    {#if item.status === 'failed' || item.status === 'cancelled'}
                      <button class="text-button strong" type="button" on:click={() => retryUpload(item.localId)}>Retry</button>
                    {/if}
                    {#if item.id && (item.status === 'complete' || item.status === 'duplicate')}
                      <a class="text-button strong" href={detailUrlForUpload(item)}>Open</a>
                    {/if}
                    <button class="text-button" type="button" on:click={() => removeUpload(item.localId)}>Remove</button>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <section class="gallery-heading">
      <div>
        <p class="kicker">Shuffle</p>
        <h2>Your Grail</h2>
      </div>
      <button class="link-button" type="button" on:click={retryBrowse}>New mix</button>
    </section>

    {#if browseLoading}
      <section class="gallery-grid skeleton-grid" aria-label="Loading gallery">
        {#each Array(8) as _, index}
          <div class={`skeleton-card card-${index % 5}`}></div>
        {/each}
      </section>
    {:else if browseError}
      <section class="empty-state">
        <h2>Could not load the gallery.</h2>
        <p>{browseError}</p>
        <button class="primary-button" type="button" on:click={retryBrowse}>Try Again</button>
      </section>
    {:else if browseItems.length === 0}
      <section class="empty-state">
        <h2>Your Grail is empty.</h2>
        <p>Add a few files from your phone and they will appear here.</p>
        <button class="primary-button" type="button" on:click={openPicker}>Add Media</button>
      </section>
    {:else}
      <section class="gallery-grid" aria-label="Randomized gallery">
        {#each browseItems as item, index (item.id)}
          <a class={`gallery-card card-${index % 5}`} href={item.detailUrl}>
            <img src={item.thumbnailUrl} alt={item.kind === 'video' ? 'Video thumbnail' : 'Image thumbnail'} loading="lazy" />
            {#if item.kind === 'video'}
              <span class="media-badge">Clip</span>
            {/if}
          </a>
        {/each}
      </section>

      {#if browseLoadingMore}
        <p class="footer-note">Loading more...</p>
      {:else if !browseHasMore}
        <p class="footer-note">End of this shuffle.</p>
      {/if}

      <div bind:this={browseSentinel} class="scroll-sentinel" aria-hidden="true"></div>
    {/if}
  </main>

  <button class="floating-add" type="button" aria-label="Add media" on:click={openPicker}>
    +
  </button>
</div>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at 15% 0%, rgba(255, 127, 80, 0.26), transparent 30%),
      radial-gradient(circle at 88% 12%, rgba(13, 148, 136, 0.24), transparent 28%),
      linear-gradient(145deg, #fff4e8 0%, #f4eadc 45%, #eadcca 100%);
    color: #25170f;
    font-family: 'Trebuchet MS', 'Avenir Next', sans-serif;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .page {
    min-height: 100vh;
    padding-bottom: 6rem;
  }

  .app-bar,
  .shell {
    width: min(68rem, 100%);
    margin: 0 auto;
  }

  .app-bar {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background: linear-gradient(180deg, rgba(255, 244, 232, 0.96), rgba(255, 244, 232, 0.74));
    backdrop-filter: blur(18px);
  }

  .shell {
    padding: 0 1rem 2rem;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    font-size: clamp(2rem, 10vw, 4rem);
    line-height: 0.88;
    letter-spacing: -0.08em;
  }

  h2 {
    font-size: clamp(1.45rem, 7vw, 2.4rem);
    line-height: 0.98;
    letter-spacing: -0.045em;
  }

  h3 {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.95rem;
  }

  .kicker,
  .feature-label {
    margin-bottom: 0.35rem;
    color: #a34d22;
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .round-button,
  .link-button,
  .text-button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .round-button,
  .primary-button {
    min-height: 2.9rem;
    border: 0;
    border-radius: 999px;
    padding: 0.85rem 1.1rem;
    background: #23160f;
    color: #fff7ed;
    font-size: 0.92rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    box-shadow: 0 12px 26px rgba(35, 22, 15, 0.18);
    cursor: pointer;
  }

  .round-button {
    background: rgba(255, 255, 255, 0.64);
    color: #4b3122;
    box-shadow: none;
  }

  .hidden-input {
    display: none;
  }

  .feature-card {
    display: grid;
    gap: 1.1rem;
    margin-top: 0.35rem;
    padding: 1.2rem;
    border: 1px solid rgba(68, 42, 27, 0.1);
    border-radius: 1.8rem;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.78), rgba(255, 246, 235, 0.52)),
      radial-gradient(circle at 90% 0%, rgba(217, 95, 31, 0.16), transparent 38%);
    box-shadow: 0 18px 42px rgba(68, 42, 27, 0.1);
  }

  .feature-card p:not(.feature-label) {
    max-width: 28rem;
    margin-top: 0.65rem;
    color: #684d3b;
    line-height: 1.45;
  }

  .upload-dock {
    margin-top: 1rem;
    border-radius: 1.35rem;
    background: rgba(35, 22, 15, 0.94);
    color: #fff7ed;
    overflow: hidden;
    box-shadow: 0 16px 36px rgba(35, 22, 15, 0.18);
  }

  .dock-summary {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    border: 0;
    padding: 1rem;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .dock-summary span {
    color: rgba(255, 247, 237, 0.72);
  }

  .upload-list {
    display: grid;
    gap: 0.65rem;
    padding: 0 0.75rem 0.85rem;
  }

  .upload-card {
    display: grid;
    grid-template-columns: 4.25rem minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.65rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.08);
  }

  .upload-thumb {
    width: 4.25rem;
    height: 4.25rem;
    overflow: hidden;
    border-radius: 0.85rem;
    background: rgba(255, 255, 255, 0.1);
  }

  .upload-thumb img,
  .upload-thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .upload-body {
    min-width: 0;
  }

  .upload-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .upload-line p,
  .message {
    color: rgba(255, 247, 237, 0.7);
    font-size: 0.82rem;
    line-height: 1.35;
  }

  .message {
    margin-top: 0.35rem;
  }

  .success {
    color: #9ee6c9;
  }

  .warning {
    color: #ffd18a;
  }

  .error-text {
    color: #ffb4a5;
  }

  .status-dot {
    width: 0.72rem;
    height: 0.72rem;
    margin-top: 0.28rem;
    border-radius: 999px;
    background: #f2b35e;
    box-shadow: 0 0 0 4px rgba(242, 179, 94, 0.14);
  }

  .status-dot.complete,
  .status-dot.duplicate {
    background: #52d39c;
    box-shadow: 0 0 0 4px rgba(82, 211, 156, 0.16);
  }

  .status-dot.failed,
  .status-dot.cancelled {
    background: #ff765f;
    box-shadow: 0 0 0 4px rgba(255, 118, 95, 0.16);
  }

  .upload-actions {
    display: flex;
    gap: 0.85rem;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }

  .text-button {
    padding: 0;
    color: rgba(255, 247, 237, 0.72);
    font-size: 0.82rem;
    text-decoration: none;
  }

  .text-button.strong {
    color: #fff7ed;
    font-weight: 800;
  }

  .gallery-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    margin: 1.45rem 0 0.8rem;
  }

  .link-button {
    color: #0f766e;
    font-weight: 800;
  }

  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: dense;
    gap: 0.72rem;
  }

  .gallery-card,
  .skeleton-card {
    position: relative;
    min-height: 10rem;
    overflow: hidden;
    border-radius: 1.1rem;
    background: rgba(255, 255, 255, 0.52);
    box-shadow: 0 12px 28px rgba(68, 42, 27, 0.1);
  }

  .gallery-card img {
    width: 100%;
    height: 100%;
    min-height: inherit;
    object-fit: cover;
    display: block;
    transition: transform 180ms ease;
  }

  .gallery-card:active img {
    transform: scale(0.98);
  }

  .card-1,
  .card-4 {
    min-height: 13.5rem;
  }

  .card-2 {
    grid-row: span 2;
    min-height: 21rem;
  }

  .media-badge {
    position: absolute;
    top: 0.65rem;
    right: 0.65rem;
    border-radius: 999px;
    padding: 0.32rem 0.55rem;
    background: rgba(35, 22, 15, 0.74);
    color: #fff7ed;
    font-size: 0.72rem;
    font-weight: 800;
    backdrop-filter: blur(12px);
  }

  .skeleton-grid {
    pointer-events: none;
  }

  .skeleton-card {
    background: linear-gradient(110deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.35));
    background-size: 220% 100%;
    animation: shimmer 1.4s linear infinite;
  }

  @keyframes shimmer {
    to {
      background-position: -220% 0;
    }
  }

  .empty-state {
    display: grid;
    place-items: center;
    gap: 0.8rem;
    min-height: 16rem;
    padding: 2rem 1rem;
    border-radius: 1.5rem;
    background: rgba(255, 255, 255, 0.52);
    text-align: center;
  }

  .empty-state p,
  .footer-note {
    color: #684d3b;
  }

  .footer-note {
    margin: 1.2rem 0;
    text-align: center;
  }

  .scroll-sentinel {
    width: 100%;
    height: 1px;
  }

  .floating-add {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 5;
    width: 4rem;
    height: 4rem;
    border: 0;
    border-radius: 999px;
    background: #d95f1f;
    color: #fff7ed;
    font-size: 2.1rem;
    line-height: 1;
    box-shadow: 0 18px 38px rgba(217, 95, 31, 0.36);
    cursor: pointer;
  }

  @media (min-width: 720px) {
    .app-bar {
      padding: 1.4rem 1.5rem;
    }

    .shell {
      padding: 0 1.5rem 3rem;
    }

    .feature-card {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      padding: 1.5rem;
    }

    .gallery-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
