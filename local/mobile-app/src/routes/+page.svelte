<script>
  import { onDestroy, onMount } from 'svelte';
  import { fetchRandomBrowsePage, isAbortError } from '$lib/mobile/api.js';
  import { normalizeMediaViews } from '$lib/mobile/items.js';
  import { runUploadFlow } from '$lib/mobile/uploadFlow.js';
  import { loadPersistedUploadQueue, persistUploadQueue } from '$lib/mobile/uploadQueueStore.js';

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
  let hasRestoredUploadQueue = false;
  let queuePersistenceTimer = null;
  let queuePersistenceSequence = Promise.resolve();

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
  $: recentUploads = uploadItems
    .filter((item) => item.previewUrl)
    .slice(-4)
    .reverse();
  $: homePreviewItems = recentUploads.length > 0 ? recentUploads : browseItems.slice(0, 4);

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

  function sanitizeUploadItemsForState(items) {
    return items.map((item) => ({
      ...item,
      controller: item.controller instanceof AbortController ? item.controller : new AbortController(),
      previewUrl: item.previewUrl || createUploadPreview(item.file)
    }));
  }

  function scheduleUploadQueuePersistence() {
    if (!hasRestoredUploadQueue) {
      return;
    }

    clearTimeout(queuePersistenceTimer);
    queuePersistenceTimer = setTimeout(() => {
      const snapshot = uploadItems.map((item) => ({
        ...item,
        controller: null,
        previewUrl: null
      }));

      queuePersistenceSequence = queuePersistenceSequence
        .catch(() => {})
        .then(() => persistUploadQueue(snapshot))
        .catch((error) => {
          console.error('Failed to persist upload queue', error);
        });
    }, 80);
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
      return 'Loading your collection';
    }

    if (browseItems.length === 0) {
      return 'No saved items yet';
    }

    return `${browseItems.length} item${browseItems.length === 1 ? '' : 's'} in view`;
  }

  function homeSummary() {
    if (activeUploadCount > 0) {
      return `${activeUploadCount} file${activeUploadCount === 1 ? '' : 's'} saving now`;
    }

    if (finishedUploadCount > 0) {
      return `${finishedUploadCount} file${finishedUploadCount === 1 ? '' : 's'} saved recently`;
    }

    if (hasLoadedBrowse && browseItems.length > 0) {
      return `${browseItems.length} saved item${browseItems.length === 1 ? '' : 's'} ready to browse`;
    }

    return 'Browse when you want, add when you need to.';
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

    loadPersistedUploadQueue()
      .then((items) => {
        const restoredItems = sanitizeUploadItemsForState(items);
        const hasInterruptedItems = restoredItems.some((item) => item.wasInterrupted);

        uploadItems = restoredItems.map(({ wasInterrupted, ...item }) => item);
        hasRestoredUploadQueue = true;

        if (hasInterruptedItems) {
          showUploadQueue = true;
          homeMode = 'upload';
          processQueue();
          return;
        }

        if (uploadItems.length > 0) {
          showUploadQueue = true;
        }
      })
      .catch((error) => {
        hasRestoredUploadQueue = true;
        console.error('Failed to restore upload queue', error);
      });
  });

  $: if (browseObserver && browseSentinel) {
    observeBrowseSentinel();
  }

  $: if (hasBrowseIntent && !hasLoadedBrowse && !browseLoading && !browseLoadingMore) {
    loadBrowsePage(null);
  }

  $: if (hasRestoredUploadQueue) {
    scheduleUploadQueuePersistence();
  }

  onDestroy(() => {
    browseAbortController?.abort();
    browseObserver?.disconnect();
    clearTimeout(queuePersistenceTimer);
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
    <div class="app-bar-copy">
      <p class="kicker">Private Vault</p>
      <h1>{homeMode === 'browse' ? 'Collection' : homeMode === 'upload' ? 'Add Media' : 'HornyGrail'}</h1>
    </div>

    {#if homeMode === 'home'}
      <button class="icon-button" type="button" aria-label="Open upload" on:click={openUpload}>
        Add
      </button>
    {:else}
      <button class="soft-button" type="button" aria-label="Back to home" on:click={goHome}>
        Home
      </button>
    {/if}
  </header>

  <main class="shell">
    {#if homeMode === 'home'}
      <section class="home-panel">
        <div class="home-copy">
          <h2>Your private collection, without the clutter.</h2>
          <p>{homeSummary()}</p>
        </div>

        <div class="home-actions">
          <button class="primary-button" type="button" on:click={openBrowse}>
            Browse
          </button>
          <button class="secondary-button" type="button" on:click={openUpload}>
            Add Media
          </button>
        </div>

        {#if uploadItems.length > 0}
          <button class="queue-banner" type="button" on:click={openUpload}>
            <span class="queue-banner-copy">
              <span class="queue-banner-label">Upload queue</span>
              <strong>{uploadSummary}</strong>
            </span>
            <span class="queue-banner-meter">{uploadQueueProgress}%</span>
          </button>
        {/if}
      </section>

      <section class="preview-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Quick Start</p>
            <h3>{homePreviewItems.length > 0 ? 'Recent preview' : 'Two simple paths'}</h3>
          </div>
          {#if hasLoadedBrowse && browseItems.length > 0}
            <button class="plain-button" type="button" on:click={openBrowse}>Open</button>
          {/if}
        </div>

        {#if homePreviewItems.length > 0}
          <div class="preview-grid" aria-label="Preview items">
            {#each homePreviewItems as item}
              {#if item.localId}
                <button class="preview-card" type="button" on:click={openUpload}>
                  <img src={item.previewUrl} alt={item.name} />
                </button>
              {:else}
                <a class="preview-card" href={item.detailUrl}>
                  <img src={item.thumbnailUrl} alt={item.kind === 'video' ? 'Video thumbnail' : 'Image thumbnail'} loading="lazy" />
                  {#if item.kind === 'video'}
                    <span class="media-badge">Clip</span>
                  {/if}
                </a>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="starter-grid">
            <button class="starter-card" type="button" on:click={openBrowse}>
              <p class="eyebrow">Browse</p>
              <strong>Open the vault</strong>
              <span>Load a fresh mix only when you ask for it.</span>
            </button>
            <button class="starter-card" type="button" on:click={openUpload}>
              <p class="eyebrow">Add</p>
              <strong>Save new media</strong>
              <span>Pick files and let the queue do the heavy lifting.</span>
            </button>
          </div>
        {/if}
      </section>
    {/if}

    {#if homeMode === 'upload'}
      <section class="upload-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Add Media</p>
            <h2>Pick files and keep moving.</h2>
          </div>
        </div>

        <p class="upload-copy">The queue handles duplicates, cover generation, and retries in the background.</p>

        <div class="type-strip" aria-label="Supported upload types">
          <span>JPG</span>
          <span>PNG</span>
          <span>GIF</span>
          <span>WEBP</span>
          <span>WEBM</span>
        </div>

        <div class="upload-actions">
          <button class="primary-button" type="button" on:click={openPicker}>
            Choose Files
          </button>
          <button class="secondary-button" type="button" on:click={goHome}>
            Back
          </button>
        </div>

        {#if uploadItems.length > 0}
          <div class="mini-stats" aria-label="Upload queue summary">
            <span><strong>{finishedUploadCount}</strong> done</span>
            <span><strong>{activeUploadCount}</strong> active</span>
            <span><strong>{failedUploadCount}</strong> issues</span>
          </div>
        {/if}
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

                    <div class="upload-card-actions">
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
      <section class="browse-top">
        <div>
          <p class="eyebrow">Browse</p>
          <h2>Your collection</h2>
          <p class="section-copy">{browseSummary()}</p>
        </div>

        <div class="browse-actions">
          <button class="toggle-chip active" type="button" aria-pressed="true">
            Shuffle
          </button>
          <button class="soft-button" type="button" on:click={retryBrowse}>
            Refresh
          </button>
        </div>
      </section>

      {#if browseLoading}
        <section class="gallery-grid skeleton-grid" aria-label="Loading gallery">
          {#each Array(8) as _}
            <div class="skeleton-card"></div>
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
          <button class="primary-button" type="button" on:click={() => { openUpload(); openPicker(); }}>
            Add Media
          </button>
        </section>
      {:else}
        <section class="gallery-grid" aria-label="Randomized gallery">
          {#each browseItems as item (item.id)}
            <a class="gallery-card" href={item.detailUrl}>
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
          <p class="footer-note">End of this mix.</p>
        {/if}

        <div bind:this={browseSentinel} class="scroll-sentinel" aria-hidden="true"></div>
      {/if}
    {/if}
  </main>

  {#if homeMode === 'browse'}
    <button class="floating-add" type="button" aria-label="Add media" on:click={() => { openUpload(); openPicker(); }}>
      Add
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
    background: #f3eee6;
  }

  :global(:root) {
    --bg-base: #f3eee6;
    --bg-surface: rgba(255, 255, 255, 0.68);
    --bg-surface-strong: #fffdf9;
    --bg-tint: rgba(255, 255, 255, 0.46);
    --text-strong: #221813;
    --text-body: #65574c;
    --text-muted: #93867b;
    --stroke-soft: rgba(40, 29, 22, 0.07);
    --stroke-strong: rgba(40, 29, 22, 0.12);
    --shadow-soft: 0 8px 24px rgba(40, 29, 22, 0.045);
    --shadow-panel: 0 14px 32px rgba(40, 29, 22, 0.06);
    --accent: #1d7a6d;
    --accent-strong: #17110d;
    --accent-warm: #d5662a;
    --font-ui: 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    --font-display: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
  }

  :global(body) {
    margin: 0;
    min-height: 100dvh;
    background: var(--bg-base);
    color: var(--text-strong);
    font-family: var(--font-ui);
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
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
    outline: 2px solid rgba(29, 122, 109, 0.8);
    outline-offset: 2px;
  }

  .page {
    position: relative;
    isolation: isolate;
    min-height: 100dvh;
    padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0px));
    background:
      radial-gradient(circle at 12% 0%, rgba(213, 102, 42, 0.12), transparent 28%),
      radial-gradient(circle at 90% 10%, rgba(29, 122, 109, 0.14), transparent 24%),
      linear-gradient(180deg, #f7f2ea 0%, #f3eee6 42%, #efe8de 100%);
  }

  .app-bar,
  .shell {
    width: min(68rem, 100%);
    margin: 0 auto;
  }

  .app-bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: calc(0.8rem + env(safe-area-inset-top, 0px)) 1rem 0.75rem;
    backdrop-filter: blur(14px);
    background: rgba(243, 238, 230, 0.72);
    border-bottom: 1px solid rgba(40, 29, 22, 0.05);
  }

  .app-bar-copy {
    min-width: 0;
  }

  .shell {
    display: grid;
    gap: 0.85rem;
    padding: 0 1rem 1.75rem;
  }

  h1,
  h2,
  h3,
  p,
  strong {
    margin: 0;
  }

  h1 {
    font-size: clamp(1.85rem, 9vw, 3.3rem);
    line-height: 0.94;
    letter-spacing: -0.07em;
    font-family: var(--font-display);
    font-weight: 700;
  }

  h2 {
    font-size: clamp(1.45rem, 6.5vw, 2.05rem);
    line-height: 1;
    letter-spacing: -0.05em;
    font-family: var(--font-display);
    font-weight: 700;
  }

  h3 {
    font-size: 1rem;
    line-height: 1.08;
    letter-spacing: -0.025em;
    font-family: var(--font-ui);
    font-weight: 700;
  }

  .kicker,
  .eyebrow {
    color: #9a5d3a;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .kicker {
    margin-bottom: 0.28rem;
  }

  .eyebrow {
    margin-bottom: 0.45rem;
  }

  .section-copy,
  .home-copy p,
  .upload-copy,
  .footer-note,
  .empty-state p {
    color: var(--text-body);
    line-height: 1.38;
    font-size: 0.98rem;
  }

  .hidden-input {
    display: none;
  }

  .primary-button,
  .secondary-button,
  .soft-button,
  .icon-button,
  .toggle-chip,
  .plain-button,
  .text-button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .primary-button,
  .secondary-button,
  .soft-button,
  .icon-button {
    min-height: 3rem;
    border-radius: 999px;
    padding: 0.82rem 1.05rem;
    font-weight: 700;
    letter-spacing: -0.015em;
  }

  .primary-button {
    background: var(--accent-strong);
    color: #fffaf5;
    box-shadow: 0 10px 22px rgba(23, 17, 13, 0.13);
  }

  .secondary-button,
  .soft-button,
  .icon-button {
    border: 1px solid var(--stroke-strong);
    background: rgba(255, 255, 255, 0.54);
    color: #33261f;
  }

  .icon-button {
    min-width: 3.2rem;
    padding-inline: 0.95rem;
  }

  .plain-button {
    color: var(--accent);
    font-weight: 700;
  }

  .home-panel,
  .preview-panel,
  .upload-panel {
    display: grid;
    gap: 0.9rem;
    padding: 1rem;
    border: 1px solid var(--stroke-soft);
    border-radius: 1.35rem;
    background: var(--bg-surface);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(14px);
  }

  .home-panel {
    margin-top: 0.2rem;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.66)),
      radial-gradient(circle at 100% 0%, rgba(29, 122, 109, 0.08), transparent 34%);
  }

  .home-copy {
    display: grid;
    gap: 0.5rem;
  }

  .home-actions,
  .upload-actions {
    display: grid;
    gap: 0.65rem;
  }

  .queue-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.85rem;
    width: 100%;
    padding: 0.85rem 0.95rem;
    border: 1px solid rgba(29, 122, 109, 0.12);
    border-radius: 1rem;
    background: rgba(29, 122, 109, 0.08);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .queue-banner-copy {
    display: grid;
    gap: 0.15rem;
  }

  .queue-banner-label,
  .dock-label {
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  .queue-banner-meter {
    min-width: 3rem;
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.7);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .section-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .preview-grid,
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .preview-card,
  .starter-card,
  .gallery-card,
  .skeleton-card {
    position: relative;
    overflow: hidden;
    border-radius: 1rem;
    border: 1px solid var(--stroke-soft);
    background: var(--bg-surface-strong);
    box-shadow: var(--shadow-soft);
  }

  .preview-card {
    aspect-ratio: 1 / 1;
    padding: 0;
    color: inherit;
    text-decoration: none;
  }

  .preview-card img,
  .gallery-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .starter-grid {
    display: grid;
    gap: 0.7rem;
  }

  .starter-card {
    display: grid;
    gap: 0.38rem;
    width: 100%;
    padding: 0.9rem;
    text-align: left;
    font: inherit;
    background: rgba(255, 255, 255, 0.72);
  }

  .starter-card strong {
    font-size: 1.02rem;
    letter-spacing: -0.02em;
    font-family: var(--font-display);
    font-weight: 700;
  }

  .starter-card span {
    color: var(--text-body);
    line-height: 1.34;
    font-size: 0.96rem;
  }

  .type-strip,
  .mini-stats,
  .browse-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .type-strip span,
  .mini-stats span,
  .toggle-chip {
    border-radius: 999px;
    padding: 0.42rem 0.68rem;
    background: rgba(255, 255, 255, 0.65);
    border: 1px solid var(--stroke-soft);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .toggle-chip.active {
    background: rgba(29, 122, 109, 0.12);
    border-color: rgba(29, 122, 109, 0.2);
    color: var(--accent);
  }

  .mini-stats span {
    color: #4a3b31;
  }

  .mini-stats strong {
    font-size: 0.94rem;
    font-weight: 700;
  }

  .upload-dock {
    position: sticky;
    top: calc(4.85rem + env(safe-area-inset-top, 0px));
    z-index: 4;
    border-radius: 1.15rem;
    background: rgba(26, 20, 16, 0.94);
    color: #fff9f3;
    overflow: hidden;
    box-shadow: 0 16px 36px rgba(22, 17, 13, 0.18);
  }

  .dock-summary {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    border: 0;
    padding: 0.9rem;
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

  .dock-progress {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 3rem;
    min-height: 2rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .queue-meter,
  .item-meter {
    overflow: hidden;
    background: rgba(255, 255, 255, 0.1);
  }

  .queue-meter {
    height: 0.24rem;
    margin: 0 0.9rem 0.8rem;
    border-radius: 999px;
  }

  .item-meter {
    height: 0.2rem;
    margin-top: 0.45rem;
    border-radius: 999px;
  }

  .queue-meter span,
  .item-meter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #edb867, #5cc8a0);
    transition: width 180ms ease;
  }

  .upload-list {
    display: grid;
    gap: 0.55rem;
    padding: 0 0.7rem 0.8rem;
  }

  .upload-card {
    display: grid;
    grid-template-columns: 4.25rem minmax(0, 1fr);
    gap: 0.65rem;
    padding: 0.58rem;
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .upload-thumb {
    width: 4rem;
    height: 4rem;
    overflow: hidden;
    border-radius: 0.75rem;
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
    gap: 0.6rem;
  }

  .upload-line h3 {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #fff9f3;
    font-family: var(--font-ui);
    font-weight: 700;
  }

  .upload-line p,
  .message,
  .text-button {
    color: rgba(255, 249, 243, 0.72);
    font-size: 0.78rem;
    line-height: 1.3;
  }

  .message {
    margin-top: 0.35rem;
  }

  .text-button {
    padding: 0;
    text-decoration: none;
  }

  .text-button.strong {
    color: #fff9f3;
    font-weight: 700;
  }

  .success {
    color: #a4e4cd;
  }

  .warning {
    color: #ffd395;
  }

  .error-text {
    color: #ffbcaf;
  }

  .status-dot {
    width: 0.72rem;
    height: 0.72rem;
    margin-top: 0.28rem;
    border-radius: 999px;
    background: #edb867;
    box-shadow: 0 0 0 4px rgba(237, 184, 103, 0.14);
  }

  .status-dot.complete,
  .status-dot.duplicate {
    background: #5cc8a0;
    box-shadow: 0 0 0 4px rgba(92, 200, 160, 0.16);
  }

  .status-dot.failed,
  .status-dot.cancelled {
    background: #ff7c66;
    box-shadow: 0 0 0 4px rgba(255, 124, 102, 0.16);
  }

  .upload-card-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.45rem;
    flex-wrap: wrap;
  }

  .browse-top {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.1rem;
  }

  .gallery-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gallery-card,
  .skeleton-card {
    aspect-ratio: 0.84 / 1;
  }

  .gallery-card {
    text-decoration: none;
  }

  .gallery-card:active img,
  .preview-card:active img {
    transform: scale(0.985);
  }

  .gallery-card img,
  .preview-card img {
    transition: transform 160ms ease;
  }

  .media-badge {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    border-radius: 999px;
    padding: 0.28rem 0.5rem;
    background: rgba(23, 17, 13, 0.88);
    color: #fff9f3;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .skeleton-grid {
    pointer-events: none;
  }

  .skeleton-card {
    background: linear-gradient(110deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.4));
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
    gap: 0.7rem;
    min-height: 14rem;
    padding: 1.7rem 1rem;
    border-radius: 1.25rem;
    background: rgba(255, 255, 255, 0.7);
    text-align: center;
    border: 1px solid var(--stroke-soft);
  }

  .footer-note {
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
    z-index: 6;
    min-width: 3.9rem;
    height: 3.7rem;
    border: 0;
    border-radius: 999px;
    padding: 0 1rem;
    background: var(--accent-warm);
    color: #fff9f3;
    font: inherit;
    font-weight: 800;
    box-shadow: 0 14px 28px rgba(213, 102, 42, 0.24);
    cursor: pointer;
  }

  @media (min-width: 720px) {
    .app-bar {
      padding: calc(1.1rem + env(safe-area-inset-top, 0px)) 1.5rem 0.9rem;
    }

    .shell {
      padding: 0 1.5rem 2.6rem;
    }

    .home-panel,
    .preview-panel,
    .upload-panel {
      padding: 1.2rem;
    }

    .home-panel {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }

    .home-actions {
      min-width: 14rem;
    }

    .queue-banner {
      grid-column: 1 / -1;
    }

    .starter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .preview-grid,
    .gallery-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .upload-panel {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }

    .upload-copy,
    .type-strip,
    .mini-stats {
      grid-column: 1 / -1;
    }

    .browse-top {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }
  }
</style>
