<script>
  import { onDestroy, onMount } from 'svelte';
  import ReadAccessGate from '$lib/components/ReadAccessGate.svelte';
  import {
    createMobileReadSession,
    fetchRandomBrowsePage,
    isAbortError,
    isUnauthorizedError,
    fetchItemById
  } from '$lib/mobile/api.js';
  import { normalizeMediaViews } from '$lib/mobile/items.js';
  import { clearReadSession, getReadSession, saveReadSession } from '$lib/mobile/readSession.js';
  import { deleteNativeMedia, pickNativeMedia } from '$lib/mobile/media.js';
  import { runUploadFlow } from '$lib/mobile/uploadFlow.js';
  import { createUploadQueueProcessor } from '$lib/mobile/uploadQueueController.js';
  import { loadPersistedUploadQueue, persistUploadQueue } from '$lib/mobile/uploadQueueStore.js';

  const BROWSE_PAGE_SIZE = 24;
  const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.webm,.mp4,image/*,video/webm,video/mp4';
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
  let hasReadSession = false;
  let accessCode = '';
  let accessSubmitting = false;
  let accessError = '';

  let uploadItems = [];
  let fileInput;
  let showUploadQueue = false;
  let showDeleteAllDialog = false;
  let homeMode = 'home';
  let hasBrowseIntent = false;
  let hasLoadedBrowse = false;
  let hasRestoredUploadQueue = false;
  let queuePersistenceTimer = null;
  let copiedUploadLocalId = null;
  let copiedUploadTimeout = null;
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
  $: deletableUploadItems = uploadItems.filter((item) =>
    item.sourceUri && (item.status === 'complete' || item.status === 'duplicate')
  );

  function nextLocalId() {
    return `upload-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  function createUploadPreview(file) {
    return URL.createObjectURL(file);
  }

  async function copyPickerFile(file) {
    const buffer = await file.arrayBuffer();
    const copiedFile = new File([buffer], file.name, {
      type: file.type,
      lastModified: file.lastModified
    });
    Object.defineProperty(copiedFile, 'nativeSourcePath', { value: file.nativeSourcePath || null });
    Object.defineProperty(copiedFile, 'nativeSourceUri', { value: file.nativeSourceUri || null });
    return copiedFile;
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

  async function copyUploadFileName(item) {
    try {
      await navigator.clipboard.writeText(item.name);
      copiedUploadLocalId = item.localId;

      clearTimeout(copiedUploadTimeout);
      copiedUploadTimeout = setTimeout(() => {
        copiedUploadLocalId = null;
        copiedUploadTimeout = null;
      }, 1400);
    } catch (error) {
      console.error('Failed to copy filename', error);
      updateUploadItem(item.localId, {
        message: 'Filename could not be copied on this device.'
      });
    }
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

       if (isUnauthorizedError(error)) {
        clearReadSession();
        hasReadSession = false;
        accessError = 'Your access session expired. Enter the code again.';
        browseError = null;
        browseItems = [];
        browseCursor = null;
        browseHasMore = false;
        browseLoading = false;
        browseLoadingMore = false;
        homeMode = 'home';
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
    return item.file.type.startsWith('video/') || /\.(webm|mp4)$/i.test(item.name);
  }

  function canCancel(item) {
    return CANCELLABLE_STATUSES.has(item.status);
  }

  function detailUrlForUpload(item) {
    return item.id ? `/image/${item.id}` : '';
  }

  async function resolveUploadThumbnail(id) {
    if (!id) {
      return null;
    }

    try {
      const media = await fetchItemById(id);
      return typeof media?.thumbnailUrl === 'string' ? media.thumbnailUrl : null;
    } catch (error) {
      console.warn('Could not load uploaded thumbnail', error);
      return null;
    }
  }

  const uploadQueue = createUploadQueueProcessor({
    getItems: () => uploadItems,
    getItem: getUploadItem,
    updateItem: updateUploadItem,
    runFlow: runUploadFlow,
    resolveThumbnail: resolveUploadThumbnail,
    outcomeText,
    isAbortError
  });
  const processQueue = uploadQueue.process;

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
      thumbnailUrl: null,
      sourceUri: file.nativeSourceUri || null,
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

  async function deleteUploadFromPhone(localId) {
    const item = getUploadItem(localId);
    if (!item?.sourceUri) {
      return;
    }

    updateUploadItem(localId, { error: null, message: 'Waiting for Android confirmation' });
    try {
      const result = await deleteNativeMedia(item.sourceUri);
      if (result?.deleted) {
        updateUploadItem(localId, {
          sourceUri: null,
          message: 'Deleted from phone',
          error: null
        });
      } else {
        updateUploadItem(localId, { message: 'Kept on phone', error: null });
      }
    } catch (error) {
      console.error('Could not delete uploaded media from phone', error);
      updateUploadItem(localId, {
        error: error?.message || 'Could not delete this file from phone',
        message: 'Still on phone'
      });
    }
  }

  async function deleteAllUploadsFromPhone() {
    const items = [...deletableUploadItems];
    if (items.length === 0) {
      return;
    }

    for (const item of items) {
      updateUploadItem(item.localId, { error: null, message: 'Waiting for Android confirmation' });
    }

    const downloadItems = items.filter((item) => item.sourceUri.includes('com.android.providers.downloads.documents'));
    const mediaStoreItems = items.filter((item) => !item.sourceUri.includes('com.android.providers.downloads.documents'));

    for (const item of downloadItems) {
      try {
        const result = await deleteNativeMedia(item.sourceUri);
        updateUploadItem(item.localId, result?.deleted
          ? { sourceUri: null, message: 'Deleted from phone', error: null }
          : { message: 'Kept on phone', error: null });
      } catch (error) {
        console.error('Could not delete uploaded Downloads media', error);
        updateUploadItem(item.localId, {
          error: error?.message || 'Could not delete these files from phone',
          message: 'Still on phone'
        });
      }
    }

    if (mediaStoreItems.length === 0) {
      return;
    }

    try {
      const result = await deleteNativeMedia(mediaStoreItems.map((item) => item.sourceUri));
      for (const item of mediaStoreItems) {
        updateUploadItem(item.localId, result?.deleted
          ? { sourceUri: null, message: 'Deleted from phone', error: null }
          : { message: 'Kept on phone', error: null });
      }
    } catch (error) {
      console.error('Could not delete uploaded media from phone', error);
      for (const item of mediaStoreItems) {
        updateUploadItem(item.localId, {
          error: error?.message || 'Could not delete these files from phone',
          message: 'Still on phone'
        });
      }
    }
  }

  function requestDeleteAllUploads() {
    if (deletableUploadItems.length > 0) {
      showDeleteAllDialog = true;
    }
  }

  async function confirmDeleteAllUploads() {
    showDeleteAllDialog = false;
    await deleteAllUploadsFromPhone();
  }

  function retryBrowse() {
    homeMode = 'browse';
    hasBrowseIntent = true;
    loadBrowsePage(null);
  }

  async function openPicker() {
    try {
      const nativeFiles = await pickNativeMedia();
      if (nativeFiles !== null) {
        if (nativeFiles.length > 0) {
          enqueueFiles(nativeFiles);
        }
        return;
      }
    } catch (error) {
      console.error('Native media picker failed', error);
    }

    fileInput?.click();
  }

  function openBrowse() {
    if (!hasReadSession) {
      return;
    }

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

  async function unlockReadAccess() {
    accessSubmitting = true;
    accessError = '';

    try {
      const session = await createMobileReadSession(accessCode.trim());
      saveReadSession(session);
      hasReadSession = true;
      accessCode = '';
      if (hasBrowseIntent && !hasLoadedBrowse) {
        loadBrowsePage(null);
      }
    } catch (error) {
      console.error('Failed to create mobile read session', error);
      accessError = error?.status === 401 ? 'That code was not accepted.' : (error?.message || 'Could not unlock the app');
    } finally {
      accessSubmitting = false;
    }
  }

  onMount(() => {
    hasReadSession = Boolean(getReadSession());
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
    clearTimeout(copiedUploadTimeout);
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
    <div class="app-bar-brand">
      <img
        class="app-logo"
        src="/brand/horny-grail-mobile.svg"
        alt=""
        width="52"
        height="52"
      />
      <div class="app-bar-copy">
        <p class="kicker">Private Vault</p>
        <h1>{homeMode === 'browse' ? 'Collection' : homeMode === 'upload' ? 'Add Media' : 'HornyGrail'}</h1>
      </div>
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
    {#if !hasReadSession}
      <ReadAccessGate
        bind:code={accessCode}
        busy={accessSubmitting}
        error={accessError}
        title="Unlock HornyGrail"
        copy="Enter the shared access code before browsing or opening saved media on this device."
        submitLabel="Unlock"
        on:submit={unlockReadAccess}
      />
    {:else}
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
                  <img src={item.thumbnailUrl || item.previewUrl} alt={item.name} />
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
        <section class={`upload-dock ${showUploadQueue ? 'expanded' : ''} ${activeUploadCount > 0 ? 'active' : ''}`}>
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
          {#if deletableUploadItems.length > 0}
            <div class="queue-actions">
              <button class="bulk-delete-button" type="button" on:click={requestDeleteAllUploads}>
                <span class="bulk-delete-icon" aria-hidden="true"></span>
                <span class="bulk-delete-copy">
                  <strong>Delete all from phone</strong>
                  <small>Remove saved files from this device</small>
                </span>
                <span class="bulk-delete-count">{deletableUploadItems.length}</span>
              </button>
            </div>
          {/if}

          {#if showUploadQueue}
            <div class="upload-list">
              {#each uploadItems as item (item.localId)}
                <article class="upload-card">
                  <div class="upload-thumb">
                    {#if item.thumbnailUrl}
                      <img src={item.thumbnailUrl} alt={`${item.name} thumbnail`} />
                    {:else if isVideoUpload(item)}
                      <video src={item.previewUrl} muted playsinline preload="metadata"></video>
                    {:else}
                      <img src={item.previewUrl} alt={item.name} />
                    {/if}
                  </div>
                  <div class="upload-body">
                    <div class="upload-line">
                      <div class="upload-heading">
                        <button
                          class="upload-name-button"
                          type="button"
                          title={`Copy ${item.name}`}
                          on:click={() => copyUploadFileName(item)}
                        >
                          {item.name}
                        </button>
                        <div class="upload-meta">
                          <span class={`status-badge ${item.status}`}>{statusText(item)}</span>
                          <span>{formatFileSize(item.size)}</span>
                        </div>
                      </div>
                      {#if copiedUploadLocalId === item.localId}
                        <span class="copy-pill">Copied</span>
                      {/if}
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
                        <a class="upload-action" href={detailUrlForUpload(item)} aria-label={`Open ${item.name}`} title="Open">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4 11 13M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" /></svg>
                        </a>
                      {/if}
                      {#if item.sourceUri && (item.status === 'complete' || item.status === 'duplicate')}
                        <button class="upload-action danger" type="button" on:click={() => deleteUploadFromPhone(item.localId)} aria-label={`Delete ${item.name} from phone`} title="Delete from phone">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
                        </button>
                      {/if}
                      <button class="upload-action" type="button" on:click={() => removeUpload(item.localId)} aria-label={`Remove ${item.name} from queue`} title="Remove from queue">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                      </button>
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
    {/if}
  </main>

  {#if showDeleteAllDialog}
    <div class="dialog-backdrop" role="presentation" on:click={(event) => event.currentTarget === event.target && (showDeleteAllDialog = false)}>
      <dialog open class="confirm-dialog" aria-labelledby="delete-all-title" aria-describedby="delete-all-copy">
        <div class="dialog-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
        </div>
        <p class="eyebrow">Phone storage</p>
        <h2 id="delete-all-title">Delete {deletableUploadItems.length} files?</h2>
        <p id="delete-all-copy">These uploaded files will be removed from your phone. Your saved copies in the Grail will remain.</p>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" on:click={() => showDeleteAllDialog = false}>Cancel</button>
          <button class="danger-button" type="button" on:click={confirmDeleteAllUploads}>Delete files</button>
        </div>
      </dialog>
    </div>
  {/if}

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
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: calc(0.8rem + env(safe-area-inset-top, 0px)) 1rem 0.75rem;
    backdrop-filter: blur(14px);
    background: rgba(243, 238, 230, 0.72);
    border-bottom: 1px solid rgba(40, 29, 22, 0.05);
  }

  .app-bar-brand {
    display: flex;
    align-items: center;
    gap: 0.72rem;
    min-width: 0;
  }

  .app-logo {
    width: 3.25rem;
    height: 3.25rem;
    flex: 0 0 auto;
    filter: drop-shadow(0 7px 14px rgba(40, 29, 22, 0.12));
  }

  .app-bar-copy {
    min-width: 0;
  }

  .app-bar-copy h1 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    position: static;
    z-index: 4;
    border-radius: 1.15rem;
    background: rgba(26, 20, 16, 0.94);
    color: #fff9f3;
    overflow: hidden;
    box-shadow: 0 16px 36px rgba(22, 17, 13, 0.18);
  }

  .upload-dock.active {
    position: sticky;
    top: calc(4.85rem + env(safe-area-inset-top, 0px));
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

  .queue-actions {
    padding: 0.1rem 0.75rem 0.8rem;
  }

  .bulk-delete-button {
    display: flex;
    width: 100%;
    min-height: 3.15rem;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid rgba(255, 124, 102, 0.36);
    border-radius: 0.85rem;
    background: linear-gradient(135deg, rgba(117, 42, 35, 0.72), rgba(71, 31, 29, 0.9));
    color: #ffe8e2;
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
  }

  .bulk-delete-button:hover,
  .bulk-delete-button:focus-visible {
    border-color: rgba(255, 157, 139, 0.72);
    background: linear-gradient(135deg, rgba(139, 49, 40, 0.82), rgba(82, 35, 32, 0.96));
  }

  .bulk-delete-button:active {
    transform: translateY(1px);
  }

  .bulk-delete-icon {
    position: relative;
    flex: 0 0 auto;
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid rgba(255, 232, 226, 0.35);
    border-radius: 0.55rem;
    background: rgba(255, 232, 226, 0.1);
  }

  .bulk-delete-icon::before {
    position: absolute;
    top: 0.48rem;
    left: 0.48rem;
    width: 0.78rem;
    height: 0.85rem;
    border: 1.5px solid #ffe8e2;
    border-top: 0;
    border-radius: 0 0 0.18rem 0.18rem;
    content: '';
  }

  .bulk-delete-icon::after {
    position: absolute;
    top: 0.31rem;
    left: 0.39rem;
    width: 0.96rem;
    height: 0.12rem;
    border-radius: 999px;
    background: #ffe8e2;
    box-shadow: 0.23rem -0.16rem 0 -0.03rem #ffe8e2;
    content: '';
  }

  .bulk-delete-copy {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .bulk-delete-copy strong {
    color: #fff4f1;
    font-size: 0.82rem;
    font-weight: 800;
  }

  .bulk-delete-copy small {
    overflow: hidden;
    color: rgba(255, 232, 226, 0.66);
    font-size: 0.68rem;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bulk-delete-count {
    display: inline-flex;
    min-width: 1.8rem;
    min-height: 1.8rem;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    padding: 0 0.42rem;
    border-radius: 999px;
    background: #ff8e79;
    color: #3e1714;
    font-size: 0.75rem;
    font-weight: 900;
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

  .upload-heading {
    display: grid;
    min-width: 0;
    gap: 0.28rem;
  }

  .upload-name-button {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #fff9f3;
    font-family: var(--font-ui);
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.2;
    text-align: left;
    padding: 0;
    background: transparent;
    border: 0;
  }

  .copy-pill {
    flex: 0 0 auto;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    color: #14231d;
    background: #a4e4cd;
    font-size: 0.68rem;
    font-weight: 800;
  }

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

  .upload-meta {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    color: rgba(255, 249, 243, 0.58);
    font-size: 0.68rem;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    min-height: 1.25rem;
    padding: 0.1rem 0.42rem;
    border: 1px solid rgba(237, 184, 103, 0.3);
    border-radius: 999px;
    background: rgba(237, 184, 103, 0.12);
    color: #ffd395;
    font-size: 0.64rem;
    font-weight: 800;
  }

  .status-badge.complete,
  .status-badge.duplicate {
    border-color: rgba(92, 200, 160, 0.32);
    background: rgba(92, 200, 160, 0.13);
    color: #a4e4cd;
  }

  .status-badge.failed,
  .status-badge.cancelled {
    border-color: rgba(255, 124, 102, 0.34);
    background: rgba(255, 124, 102, 0.14);
    color: #ffbcaf;
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
    align-items: center;
    gap: 0.42rem;
    margin-top: 0.45rem;
    flex-wrap: wrap;
  }

  .upload-action {
    display: inline-flex;
    width: 2.15rem;
    height: 2.15rem;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 249, 243, 0.14);
    border-radius: 0.65rem;
    background: rgba(255, 249, 243, 0.07);
    color: rgba(255, 249, 243, 0.82);
    cursor: pointer;
    text-decoration: none;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
  }

  .upload-action:hover,
  .upload-action:focus-visible {
    border-color: rgba(255, 249, 243, 0.34);
    background: rgba(255, 249, 243, 0.15);
    color: #fff9f3;
  }

  .upload-action.danger:hover,
  .upload-action.danger:focus-visible {
    border-color: rgba(255, 124, 102, 0.55);
    background: rgba(255, 124, 102, 0.17);
    color: #ffbcaf;
  }

  .upload-action svg,
  .dialog-icon svg {
    width: 1.05rem;
    height: 1.05rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: rgba(18, 13, 10, 0.62);
    backdrop-filter: blur(8px);
  }

  .confirm-dialog {
    width: min(100%, 23rem);
    padding: 1.25rem;
    border: 1px solid rgba(255, 249, 243, 0.14);
    border-radius: 1.2rem;
    background: #241b17;
    color: #fff9f3;
    box-shadow: 0 24px 70px rgba(12, 8, 5, 0.42);
  }

  .dialog-icon {
    display: grid;
    width: 2.8rem;
    height: 2.8rem;
    place-items: center;
    margin-bottom: 1rem;
    border: 1px solid rgba(255, 124, 102, 0.34);
    border-radius: 0.8rem;
    background: rgba(255, 124, 102, 0.14);
    color: #ffbcaf;
  }

  .confirm-dialog h2 {
    margin: 0.35rem 0 0.55rem;
    font-family: var(--font-display);
    font-size: 1.55rem;
    line-height: 1;
  }

  .confirm-dialog > p:not(.eyebrow) {
    margin: 0;
    color: rgba(255, 249, 243, 0.7);
    font-size: 0.84rem;
    line-height: 1.5;
  }

  .dialog-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
    margin-top: 1.25rem;
  }

  .danger-button {
    min-height: 3rem;
    border: 1px solid rgba(255, 124, 102, 0.45);
    border-radius: 999px;
    background: #ff806b;
    color: #3e1714;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
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
