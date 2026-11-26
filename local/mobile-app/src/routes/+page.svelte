<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import BrowseView from '$lib/components/BrowseView.svelte';
  import DeleteAllDialog from '$lib/components/DeleteAllDialog.svelte';
  import HomeView from '$lib/components/HomeView.svelte';
  import ReadAccessGate from '$lib/components/ReadAccessGate.svelte';
  import UploadView from '$lib/components/UploadView.svelte';
  import {
    createMobileReadSession,
    describeAccessError,
    fetchRandomBrowsePage,
    fetchTagSummary,
    isAbortError,
    isUnauthorizedError,
    fetchItemById
  } from '$lib/mobile/api.js';
  import { getBrowseFilter, setBrowseFilter, toggleBrowseTag } from '$lib/mobile/browseFilter.js';
  import { normalizeMediaViews } from '$lib/mobile/items.js';
  import { clearReadSession, getReadSession, saveReadSession } from '$lib/mobile/readSession.js';
  import { deleteNativeMedia, pickNativeMedia } from '$lib/mobile/media.js';
  import { allowNextBackground, onAppLock, startAppLock } from '$lib/mobile/appLock.js';
  import { runUploadFlow } from '$lib/mobile/uploadFlow.js';
  import { CANCELLABLE_STATUSES, isDeletableFromPhone, uploadProgress } from '$lib/mobile/uploadDisplay.js';
  import { createUploadQueueProcessor } from '$lib/mobile/uploadQueueController.js';
  import { loadPersistedUploadQueue, persistUploadQueue } from '$lib/mobile/uploadQueueStore.js';

  const BROWSE_PAGE_SIZE = 24;
  const BROWSE_PRELOAD_MARGIN_PX = 260;
  const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.webm,.mp4,image/*,video/webm,video/mp4';

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
  let browseFilter = getBrowseFilter();
  let tagSummary = null;
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
  $: deletableUploadItems = uploadItems.filter(isDeletableFromPhone);

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
      void loadTagSummary();
    } else {
      browseLoadingMore = true;
    }

    try {
      const payload = await fetchRandomBrowsePage(cursor, BROWSE_PAGE_SIZE, {
        signal: controller.signal,
        filter: browseFilter
      });
      appendBrowseItems(payload?.items || []);
      browseCursor = payload?.cursor || null;
      browseHasMore = Boolean(payload?.hasMore);
      hasLoadedBrowse = true;
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      if (isUnauthorizedError(error)) {
        lockVault('Your access session expired. Enter the code again.');
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

    if (browseAbortController === controller && !browseError) {
      await loadMoreBrowseIfSentinelVisible();
    }
  }

  async function loadTagSummary() {
    try {
      tagSummary = await fetchTagSummary();
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn('Failed to load tags', error);
      }
    }
  }

  // Changing the tag filter starts a new shuffle limited to the matching items.
  function applyBrowseFilter(next) {
    browseFilter = next;
    loadBrowsePage(null);
  }

  // IntersectionObserver only fires when visibility changes. If the sentinel is still on
  // screen after a page renders, load the next page instead of waiting for a scroll.
  async function loadMoreBrowseIfSentinelVisible() {
    await tick();
    if (!browseSentinel || !hasReadSession || browseLoading || browseLoadingMore || !browseHasMore || !browseCursor) {
      return;
    }

    if (browseSentinel.getBoundingClientRect().top <= window.innerHeight + BROWSE_PRELOAD_MARGIN_PX) {
      await loadBrowsePage(browseCursor);
    }
  }

  /**
   * Drops the read session and everything browse loaded, so no private media stays on
   * screen or in memory behind the unlock gate. Uploads keep running.
   */
  function lockVault(message) {
    clearReadSession();
    browseAbortController?.abort();
    hasReadSession = false;
    accessError = message;
    browseError = null;
    browseItems = [];
    tagSummary = null;
    browseCursor = null;
    browseHasMore = false;
    browseLoading = false;
    browseLoadingMore = false;
    hasLoadedBrowse = false;
    hasBrowseIntent = false;
    if (homeMode === 'browse') {
      homeMode = 'home';
    }
  }




  // Reactive statements, not template function calls: a call like {browseSummary()} only
  // re-ran when its own name changed, so the text went stale (e.g. "Loading" after load).
  $: browseSummaryText = browseLoading
    ? 'Loading your collection'
    : browseItems.length === 0
      ? 'No saved items yet'
      : `${browseItems.length} item${browseItems.length === 1 ? '' : 's'} in view`;

  $: homeSummaryText = activeUploadCount > 0
    ? `${activeUploadCount} file${activeUploadCount === 1 ? '' : 's'} saving now`
    : finishedUploadCount > 0
      ? `${finishedUploadCount} file${finishedUploadCount === 1 ? '' : 's'} saved recently`
      : hasLoadedBrowse && browseItems.length > 0
        ? `${browseItems.length} saved item${browseItems.length === 1 ? '' : 's'} ready to browse`
        : 'Browse when you want, add when you need to.';

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
    isAbortError,
    isUnauthorizedError,
    // Uploads use the passphrase session, so they wait while the vault is locked.
    canProcess: () => hasReadSession
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

    allowNextBackground();
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
      // Resume any uploads that paused while the vault was locked.
      processQueue();
    } catch (error) {
      console.error('Failed to create mobile read session', error);
      accessError = describeAccessError(error, 'Could not unlock the app');
    } finally {
      accessSubmitting = false;
    }
  }

  onMount(() => {
    startAppLock();
    const stopListeningForLock = onAppLock(() => {
      lockVault('Locked after you left the app. Enter the code to continue.');
    });
    hasReadSession = Boolean(getReadSession());
    // A tag tapped on the detail page comes back here as /?browse=1 with the filter set.
    if (new URLSearchParams(window.location.search).get('browse') === '1') {
      homeMode = 'browse';
      hasBrowseIntent = true;
    }
    browseObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry?.isIntersecting || browseLoading || browseLoadingMore || !browseHasMore || !browseCursor) {
        return;
      }

      loadBrowsePage(browseCursor);
    }, { rootMargin: `${BROWSE_PRELOAD_MARGIN_PX}px 0px` });

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

    return stopListeningForLock;
  });

  $: if (browseObserver && browseSentinel) {
    observeBrowseSentinel();
  }

  $: if (hasReadSession && hasBrowseIntent && !hasLoadedBrowse && !browseLoading && !browseLoadingMore) {
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
      <div class="vault-view">
        <HomeView
          summary={homeSummaryText}
          uploadCount={uploadItems.length}
          {uploadSummary}
          uploadProgress={uploadQueueProgress}
          previewItems={homePreviewItems}
          canOpenBrowse={hasLoadedBrowse && browseItems.length > 0}
          onBrowse={openBrowse}
          onUpload={openUpload}
        />
      </div>
    {/if}

    {#if homeMode === 'upload'}
      <div class="vault-view">
        <UploadView
          items={uploadItems}
          activeCount={activeUploadCount}
          finishedCount={finishedUploadCount}
          failedCount={failedUploadCount}
          summary={uploadSummary}
          progress={uploadQueueProgress}
          deletableCount={deletableUploadItems.length}
          copiedLocalId={copiedUploadLocalId}
          bind:showQueue={showUploadQueue}
          onPick={openPicker}
          onBack={goHome}
          onRequestDeleteAll={requestDeleteAllUploads}
          onCopyName={copyUploadFileName}
          onCancel={cancelUpload}
          onRetry={retryUpload}
          onDeleteFromPhone={deleteUploadFromPhone}
          onRemove={removeUpload}
        />
      </div>
    {/if}

    {#if homeMode === 'browse'}
      <div class="vault-view">
        <BrowseView
          summary={browseSummaryText}
          loading={browseLoading}
          error={browseError}
          items={browseItems}
          loadingMore={browseLoadingMore}
          hasMore={browseHasMore}
          bind:sentinel={browseSentinel}
          {tagSummary}
          filter={browseFilter}
          onToggleTag={(tag) => applyBrowseFilter(toggleBrowseTag(tag))}
          onShowAll={() => applyBrowseFilter(setBrowseFilter({}))}
          onShowUntagged={() => applyBrowseFilter(setBrowseFilter({ untagged: true }))}
          onRefresh={retryBrowse}
          onAdd={() => { openUpload(); openPicker(); }}
        />
      </div>
    {/if}
    {/if}
  </main>

  {#if showDeleteAllDialog}
    <div class="vault-view">
      <DeleteAllDialog
        count={deletableUploadItems.length}
        onCancel={() => showDeleteAllDialog = false}
        onConfirm={confirmDeleteAllUploads}
      />
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

  /* View wrappers only give shared styles a hook; their sections stay direct grid items. */
  .vault-view {
    display: contents;
  }

  h1,
  p {
    margin: 0;
  }

  :where(.vault-view) :global(h1),
  :where(.vault-view) :global(h2),
  :where(.vault-view) :global(h3),
  :where(.vault-view) :global(p),
  :where(.vault-view) :global(strong) {
    margin: 0;
  }

  h1 {
    font-size: clamp(1.85rem, 9vw, 3.3rem);
    line-height: 0.94;
    letter-spacing: -0.07em;
    font-family: var(--font-display);
    font-weight: 700;
  }

  :where(.vault-view) :global(h1) {
    font-size: clamp(1.85rem, 9vw, 3.3rem);
    line-height: 0.94;
    letter-spacing: -0.07em;
    font-family: var(--font-display);
    font-weight: 700;
  }

  :where(.vault-view) :global(h2) {
    font-size: clamp(1.45rem, 6.5vw, 2.05rem);
    line-height: 1;
    letter-spacing: -0.05em;
    font-family: var(--font-display);
    font-weight: 700;
  }

  :where(.vault-view) :global(h3) {
    font-size: 1rem;
    line-height: 1.08;
    letter-spacing: -0.025em;
    font-family: var(--font-ui);
    font-weight: 700;
  }

  .kicker {
    color: #9a5d3a;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .vault-view :global(.eyebrow) {
    color: #9a5d3a;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .kicker {
    margin-bottom: 0.28rem;
  }

  .vault-view :global(.eyebrow) {
    margin-bottom: 0.45rem;
  }

  .hidden-input {
    display: none;
  }

  .soft-button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .vault-view :global(.primary-button),
  .vault-view :global(.secondary-button),
  .vault-view :global(.soft-button) {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .icon-button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .soft-button {
    min-height: 3rem;
    border-radius: 999px;
    padding: 0.82rem 1.05rem;
    font-weight: 700;
    letter-spacing: -0.015em;
  }

  .vault-view :global(.primary-button),
  .vault-view :global(.secondary-button),
  .vault-view :global(.soft-button) {
    min-height: 3rem;
    border-radius: 999px;
    padding: 0.82rem 1.05rem;
    font-weight: 700;
    letter-spacing: -0.015em;
  }

  .icon-button {
    min-height: 3rem;
    border-radius: 999px;
    padding: 0.82rem 1.05rem;
    font-weight: 700;
    letter-spacing: -0.015em;
  }

  .vault-view :global(.primary-button) {
    background: var(--accent-strong);
    color: #fffaf5;
    box-shadow: 0 10px 22px rgba(23, 17, 13, 0.13);
  }

  .soft-button {
    border: 1px solid var(--stroke-strong);
    background: rgba(255, 255, 255, 0.54);
    color: #33261f;
  }

  .vault-view :global(.secondary-button),
  .vault-view :global(.soft-button) {
    border: 1px solid var(--stroke-strong);
    background: rgba(255, 255, 255, 0.54);
    color: #33261f;
  }

  .icon-button {
    border: 1px solid var(--stroke-strong);
    background: rgba(255, 255, 255, 0.54);
    color: #33261f;
  }

  .icon-button {
    min-width: 3.2rem;
    padding-inline: 0.95rem;
  }

  .vault-view :global(.section-heading) {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .vault-view :global(.media-badge) {
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
}

</style>
