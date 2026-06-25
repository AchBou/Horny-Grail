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
  const STATUS_PROGRESS = {
    preparing: 6,
    queued: 10,
    hashing: 24,
    checking: 38,
    duplicate: 100,
    'uploading-original': 58,
    'repairing-original': 58,
    thumbnailing: 72,
    'uploading-thumbnail': 86,
    'repairing-thumbnail': 86,
    registering: 94,
    complete: 100,
    cancelled: 100,
    failed: 100
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
  let browseLoading = false;
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
  let homeMode = 'home';
  let hasBrowseIntent = false;
  let hasLoadedBrowse = false;

  $: activeUploadCount = uploadItems.filter((item) => CANCELLABLE_STATUSES.has(item.status)).length;
  $: finishedUploadCount = uploadItems.filter((item) => item.status === 'complete' || item.status === 'duplicate').length;
  $: failedUploadCount = uploadItems.filter((item) => item.status === 'failed').length;
  $: totalUploadCount = uploadItems.length;
  $: uploadQueueProgress = totalUploadCount > 0
    ? Math.round(uploadItems.reduce((sum, item) => sum + uploadProgress(item), 0) / totalUploadCount)
    : 0;
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
      hasLoadedBrowse = true;
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

  function uploadProgress(item) {
    return STATUS_PROGRESS[item.status] ?? 0;
  }

  function formatFileSize(size) {
    if (!Number.isFinite(size) || size <= 0) {
      return 'Unknown size';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function browseSummary() {
    if (browseLoading) {
      return 'Loading your next mix';
    }

    if (browseItems.length === 0) {
      return 'No saved items yet';
    }

    return `${browseItems.length} item${browseItems.length === 1 ? '' : 's'} in view`;
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
    homeMode = 'browse';
    hasBrowseIntent = true;
    loadBrowsePage(null);
  }

  function openPicker() {
    fileInput?.click();
  }

  function openBrowse() {
    homeMode = 'browse';
    hasBrowseIntent = true;
    if (!hasLoadedBrowse && !browseLoading && !browseLoadingMore) {
      loadBrowsePage(null);
    }
  }

  function openUpload() {
    homeMode = 'upload';
  }

  function goHome() {
    homeMode = 'home';
  }

  onMount(() => {
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

  $: if (hasBrowseIntent && !hasLoadedBrowse && !browseLoading && !browseLoadingMore) {
    loadBrowsePage(null);
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
      <h1>{homeMode === 'browse' ? 'Browse Grail' : homeMode === 'upload' ? 'Upload Media' : 'HornyGrail'}</h1>
    </div>
    {#if homeMode === 'home'}
      <span class="app-bar-note">Choose a path</span>
    {:else if homeMode === 'browse'}
      <div class="app-bar-actions">
        <button class="round-button" type="button" aria-label="Back to home" on:click={goHome}>
          Home
        </button>
      </div>
    {:else}
      <button class="round-button" type="button" aria-label="Back to home" on:click={goHome}>
        Home
      </button>
    {/if}
  </header>

  <main class="shell">
    {#if homeMode === 'home'}
      <section class="chooser-hero">
        <div class="chooser-copy">
          <p class="feature-label">Private vault</p>
          <h2>What do you want to do?</h2>
          <p>Browse your collection or add something new.</p>
          <div class="chooser-pills" aria-label="App modes">
            <span>Browse on demand</span>
            <span>Hash-safe uploads</span>
            <span>Native WebM covers</span>
          </div>
        </div>
        {#if uploadItems.length > 0}
          <div class="resume-banner">
            <span>{uploadSummary}</span>
            <button class="resume-button" type="button" on:click={openUpload}>Resume queue</button>
          </div>
        {/if}
      </section>

      <section class="path-grid">
        <button class="path-card browse-path" type="button" on:click={openBrowse}>
          <span class="path-kicker">Browse</span>
          <strong>Browse Grail</strong>
          <p>See what is already in your vault.</p>
          <span class="path-meta">Shuffle feed / Fullscreen detail view</span>
        </button>

        <button class="path-card upload-path" type="button" on:click={openUpload}>
          <span class="path-kicker">Upload</span>
          <strong>Upload Media</strong>
          <p>Add photos or clips from your device.</p>
          <span class="path-meta">Duplicate check / Repair-aware queue</span>
        </button>
      </section>
    {/if}

    {#if homeMode === 'upload'}
      <section class="feature-card">
        <div class="feature-copy">
          <p class="feature-label">Upload lane</p>
          <h2>Pick media. The app handles the boring parts.</h2>
          <p>Duplicates are skipped, incomplete assets are repaired, and WebM covers are generated on-device.</p>
          <div class="type-strip" aria-label="Supported upload types">
            <span>JPG</span>
            <span>PNG</span>
            <span>GIF</span>
            <span>WEBP</span>
            <span>WEBM</span>
          </div>
        </div>
        <div class="upload-cta">
          {#if uploadItems.length > 0}
            <div class="mini-stats" aria-label="Upload queue summary">
              <span><strong>{finishedUploadCount}</strong> done</span>
              <span><strong>{activeUploadCount}</strong> active</span>
              <span><strong>{failedUploadCount}</strong> issues</span>
            </div>
          {/if}
          <button class="primary-button" type="button" on:click={openPicker}>
            Add Media
          </button>
          <button class="secondary-button" type="button" on:click={goHome}>
            Back to Home
          </button>
        </div>
      </section>

      {#if uploadItems.length > 0}
        <section class={`upload-dock ${showUploadQueue ? 'expanded' : ''}`}>
          <button class="dock-summary" type="button" on:click={() => showUploadQueue = !showUploadQueue}>
            <span>
              <span class="dock-label">Uploads</span>
              <strong>{uploadSummary}</strong>
            </span>
            <span class="dock-progress">{uploadQueueProgress}%</span>
          </button>
          <div class="queue-meter" aria-hidden="true">
            <span style={`width: ${uploadQueueProgress}%`}></span>
          </div>

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
                        <p>{statusText(item)} / {formatFileSize(item.size)}</p>
                      </div>
                      <span class={`status-dot ${item.status}`}></span>
                    </div>
                    <div class="item-meter" aria-label={`${statusText(item)} progress`}>
                      <span style={`width: ${uploadProgress(item)}%`}></span>
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
    {/if}

    {#if homeMode === 'browse'}
      <section class="browse-hero">
        <div>
          <p class="feature-label">Browse mode</p>
          <h2>Your Grail</h2>
          <p>{browseSummary()}</p>
        </div>
        <div class="browse-hero-actions">
          <button class="secondary-button" type="button" on:click={() => { openUpload(); openPicker(); }}>
            Add Media
          </button>
        </div>
      </section>

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
    {/if}
  </main>

  {#if homeMode === 'browse'}
    <button class="floating-add" type="button" aria-label="Add media" on:click={() => { openUpload(); openPicker(); }}>
      +
    </button>
  {/if}

  <input
    bind:this={fileInput}
    class="hidden-input"
    type="file"
    accept={ACCEPTED_TYPES}
    multiple
    on:change={onFileInputChange}
  />
</div>

<style>
  :global(html) {
    min-height: 100%;
    background: #f4eadc;
  }

  :global(:root) {
    --bg-base: #f4eadc;
    --bg-panel: #fff8f0;
    --bg-panel-soft: #fffaf5;
    --bg-panel-strong: #f8efe4;
    --text-strong: #25170f;
    --text-body: #684d3b;
    --text-muted: #8e654d;
    --stroke-soft: rgba(68, 42, 27, 0.1);
    --stroke-strong: rgba(68, 42, 27, 0.16);
    --shadow-soft: 0 14px 30px rgba(68, 42, 27, 0.08);
    --shadow-panel: 0 20px 44px rgba(68, 42, 27, 0.1);
    --accent-warm: #d95f1f;
    --accent-cool: #0f766e;
  }

  :global(body) {
    margin: 0;
    min-height: 100dvh;
    background: var(--bg-base);
    color: var(--text-strong);
    font-family: 'Trebuchet MS', 'Avenir Next', sans-serif;
    text-rendering: geometricPrecision;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .page {
    position: relative;
    isolation: isolate;
    min-height: 100dvh;
    padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0px));
  }

  .page::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background:
      radial-gradient(circle at 15% 0%, rgba(255, 127, 80, 0.26), transparent 30%),
      radial-gradient(circle at 88% 12%, rgba(13, 148, 136, 0.24), transparent 28%),
      linear-gradient(145deg, #fff4e8 0%, var(--bg-base) 45%, #eadcca 100%);
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
    padding: calc(1rem + env(safe-area-inset-top, 0px)) 1rem 1rem;
    background: var(--bg-panel-strong);
    color: var(--text-strong);
    border-bottom: 1px solid var(--stroke-soft);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
  }

  .app-bar-actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .app-bar-note {
    color: var(--text-body);
    font-size: 0.82rem;
    font-weight: 800;
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
    color: var(--text-strong);
  }

  h2 {
    font-size: clamp(1.45rem, 7vw, 2.4rem);
    line-height: 0.98;
    letter-spacing: -0.045em;
    color: var(--text-strong);
  }

  h3 {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.95rem;
    color: #fff7ed;
  }

  .kicker,
  .feature-label {
    margin-bottom: 0.35rem;
    color: #9a4c24;
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
    min-height: 3.25rem;
    border: 0;
    border-radius: 999px;
    padding: 0.95rem 1.2rem;
    background: #23160f;
    color: #fff7ed;
    font-size: 0.92rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    box-shadow: 0 12px 26px rgba(35, 22, 15, 0.18);
    cursor: pointer;
  }

  .round-button {
    background: #fff8f0;
    color: #4b3122;
    border: 1px solid var(--stroke-soft);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  }

  .secondary-button {
    min-height: 3.1rem;
    border: 1px solid var(--stroke-strong);
    border-radius: 999px;
    padding: 0.88rem 1.15rem;
    background: var(--bg-panel);
    color: #342118;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }

  .hidden-input {
    display: none;
  }

  .feature-card {
    display: grid;
    gap: 1.1rem;
    margin-top: 0.35rem;
    padding: 1.2rem;
    border: 1px solid var(--stroke-soft);
    border-radius: 1.8rem;
    background:
      linear-gradient(135deg, #fffaf4, #fff2e4),
      radial-gradient(circle at 90% 0%, rgba(217, 95, 31, 0.1), transparent 38%);
    box-shadow: var(--shadow-panel);
  }

  .chooser-hero {
    display: grid;
    gap: 1rem;
    margin-top: 0.35rem;
    padding: 1.2rem;
    border: 1px solid var(--stroke-soft);
    border-radius: 1.8rem;
    background:
      linear-gradient(135deg, #fffaf4, #fff3e7),
      radial-gradient(circle at 85% 0%, rgba(217, 95, 31, 0.12), transparent 38%);
    box-shadow: var(--shadow-panel);
  }

  .chooser-copy {
    min-width: 0;
  }

  .chooser-hero p:not(.feature-label) {
    margin-top: 0.65rem;
    color: var(--text-body);
    line-height: 1.45;
  }

  .chooser-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 1rem;
  }

  .chooser-pills span {
    padding: 0.42rem 0.72rem;
    border: 1px solid rgba(154, 76, 36, 0.14);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.82);
    color: var(--text-muted);
    font-size: 0.72rem;
    font-weight: 800;
  }

  .resume-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.85rem 0.95rem;
    border-radius: 1rem;
    background: #fffdf9;
    color: #4b3122;
    font-weight: 800;
    border: 1px solid rgba(68, 42, 27, 0.08);
  }

  .resume-button {
    min-height: 2.6rem;
    border: 0;
    border-radius: 999px;
    padding: 0.72rem 0.95rem;
    background: #23160f;
    color: #fff7ed;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }

  .path-grid {
    display: grid;
    gap: 0.9rem;
    margin-top: 1rem;
  }

  .path-card {
    display: grid;
    gap: 0.45rem;
    width: 100%;
    padding: 1.15rem;
    border: 1px solid rgba(68, 42, 27, 0.1);
    border-radius: 1.6rem;
    text-align: left;
    font: inherit;
    cursor: pointer;
    box-shadow: var(--shadow-soft);
  }

  .browse-path {
    background:
      linear-gradient(135deg, #f0fcf8, #ffffff),
      radial-gradient(circle at 100% 0%, rgba(13, 148, 136, 0.12), transparent 35%);
  }

  .upload-path {
    background:
      linear-gradient(135deg, #fff7ef, #ffffff),
      radial-gradient(circle at 100% 0%, rgba(217, 95, 31, 0.12), transparent 35%);
  }

  .path-kicker {
    color: #a34d22;
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .path-card strong {
    font-size: 1.35rem;
    line-height: 1;
    letter-spacing: -0.04em;
    color: #25170f;
  }

  .path-card p {
    color: var(--text-body);
    line-height: 1.45;
  }

  .path-meta {
    color: var(--text-muted);
    font-size: 0.74rem;
    font-weight: 800;
  }

  .feature-copy {
    min-width: 0;
  }

  .feature-card p:not(.feature-label) {
    max-width: 28rem;
    margin-top: 0.65rem;
    color: var(--text-body);
    line-height: 1.45;
  }

  .type-strip,
  .mini-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .type-strip {
    margin-top: 1rem;
  }

  .type-strip span,
  .mini-stats span {
    border-radius: 999px;
    padding: 0.42rem 0.62rem;
    background: rgba(35, 22, 15, 0.06);
    color: #5f3d2a;
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.04em;
  }

  .upload-cta {
    display: grid;
    gap: 0.8rem;
  }

  .upload-cta .primary-button {
    width: 100%;
  }

  .mini-stats {
    justify-content: stretch;
  }

  .mini-stats span {
    flex: 1 1 5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.28rem;
    background: #fffaf4;
    letter-spacing: 0;
    border: 1px solid rgba(68, 42, 27, 0.08);
  }

  .mini-stats strong {
    font-size: 1rem;
  }

  .upload-dock {
    position: sticky;
    top: calc(5.25rem + env(safe-area-inset-top, 0px));
    z-index: 3;
    margin-top: 1rem;
    border-radius: 1.35rem;
    background: rgba(35, 22, 15, 0.94);
    color: #fff7ed;
    overflow: hidden;
    box-shadow: 0 16px 36px rgba(35, 22, 15, 0.18);
    border: 1px solid rgba(255, 247, 237, 0.06);
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

  .dock-summary > span:first-child {
    display: grid;
    gap: 0.18rem;
    text-align: left;
  }

  .dock-label {
    color: rgba(255, 247, 237, 0.72);
    font-size: 0.78rem;
    font-weight: 800;
  }

  .dock-progress {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 3.2rem;
    min-height: 2.15rem;
    border-radius: 999px;
    background: rgba(255, 247, 237, 0.12);
    color: #fff7ed;
    font-size: 0.82rem;
    font-weight: 900;
  }

  .queue-meter,
  .item-meter {
    overflow: hidden;
    background: rgba(255, 247, 237, 0.12);
  }

  .queue-meter {
    height: 0.28rem;
    margin: 0 1rem 0.9rem;
    border-radius: 999px;
  }

  .item-meter {
    height: 0.22rem;
    margin-top: 0.52rem;
    border-radius: 999px;
  }

  .queue-meter span,
  .item-meter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #f2b35e, #52d39c);
    transition: width 180ms ease;
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
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.08);
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
    margin: 1rem 0 0.8rem;
  }

  .link-button {
    color: var(--accent-cool);
    font-weight: 800;
  }

  .browse-hero {
    display: grid;
    gap: 1rem;
    margin-top: 0.35rem;
    padding: 1.2rem;
    border: 1px solid var(--stroke-soft);
    border-radius: 1.8rem;
    background:
      linear-gradient(135deg, #f2fbf8, #fffdfa),
      radial-gradient(circle at 100% 0%, rgba(13, 148, 136, 0.1), transparent 34%);
    box-shadow: var(--shadow-soft);
  }

  .browse-hero p:not(.feature-label) {
    margin-top: 0.65rem;
    color: var(--text-body);
    line-height: 1.45;
  }

  .browse-hero-actions {
    display: flex;
    align-items: center;
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
    background: rgba(255, 255, 255, 0.72);
    box-shadow: var(--shadow-soft);
    border: 1px solid rgba(68, 42, 27, 0.08);
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
    background: rgba(35, 22, 15, 0.92);
    color: #fff7ed;
    font-size: 0.72rem;
    font-weight: 800;
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
    background: rgba(255, 255, 255, 0.82);
    text-align: center;
    border: 1px solid rgba(68, 42, 27, 0.08);
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
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
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
      padding: calc(1.4rem + env(safe-area-inset-top, 0px)) 1.5rem 1.4rem;
    }

    .shell {
      padding: 0 1.5rem 3rem;
    }

    .feature-card {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      padding: 1.5rem;
    }

    .chooser-hero {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      padding: 1.5rem;
    }

    .browse-hero {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      padding: 1.5rem;
    }

    .upload-cta {
      min-width: 15rem;
    }

    .path-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .gallery-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
