<script>
  import { onDestroy, onMount } from 'svelte';
  import { buildApiUrl, getPrivateConfigSummary } from '$lib/config/privateConfig.js';
  import { fetchRandomBrowsePage, isAbortError } from '$lib/mobile/api.js';
  import { normalizeMediaViews } from '$lib/mobile/items.js';
  import { runUploadFlow } from '$lib/mobile/uploadFlow.js';

  const BROWSE_PAGE_SIZE = 18;
  const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.webm,image/*,video/webm';
  const STATUS_LABELS = {
    preparing: 'Preparing',
    queued: 'Queued',
    hashing: 'Hashing',
    checking: 'Checking integrity',
    duplicate: 'Already uploaded',
    'uploading-original': 'Uploading original',
    'repairing-original': 'Repairing original',
    thumbnailing: 'Generating thumbnail',
    'uploading-thumbnail': 'Uploading thumbnail',
    'repairing-thumbnail': 'Repairing thumbnail',
    registering: 'Registering metadata',
    complete: 'Complete',
    cancelled: 'Cancelled',
    failed: 'Failed'
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

  const configSummary = getPrivateConfigSummary();

  let browseItems = [];
  let browseCursor = null;
  let browseHasMore = false;
  let browseLoading = true;
  let browseLoadingMore = false;
  let browseError = null;
  let browseSentinel;
  let browseObserver;
  let browseAbortController = null;

  let uploadItems = [];
  let isProcessingQueue = false;
  let queueError = null;
  let fileInput;

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
      browseError = error?.message || 'Failed to load browse items';
    } finally {
      if (browseAbortController === controller) {
        browseLoading = false;
        browseLoadingMore = false;
      }
    }
  }

  function statusText(item) {
    if (!item.status) {
      return 'Pending';
    }

    return STATUS_LABELS[item.status] || item.status;
  }

  function outcomeText(outcome) {
    if (outcome === 'duplicate') {
      return 'Duplicate detected';
    }

    if (outcome === 'repaired') {
      return 'Repair completed';
    }

    if (outcome === 'uploaded') {
      return 'Upload completed';
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
    queueError = null;

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
              message: 'Upload cancelled between stages.'
            });
            continue;
          }

          console.error('Upload flow failed', error);
          updateUploadItem(nextItem.localId, {
            status: 'failed',
            error: error?.message || 'Upload failed',
            message: error?.message || 'Upload failed'
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
          error: 'Android could not read the selected file. Try selecting it from local device storage instead of a cloud or recent-file provider.',
          message: 'File read failed before upload.'
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
      message: 'Upload cancelled.'
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

  onMount(() => {
    loadBrowsePage(null);

    browseObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry?.isIntersecting || browseLoading || browseLoadingMore || !browseHasMore || !browseCursor) {
        return;
      }

      loadBrowsePage(browseCursor);
    }, { rootMargin: '240px 0px' });

    if (browseSentinel) {
      browseObserver.observe(browseSentinel);
    }
  });

  $: if (browseObserver && browseSentinel) {
    browseObserver.observe(browseSentinel);
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
  <title>HornyGrail Mobile</title>
  <meta
    name="description"
    content="Private HornyGrail mobile client for randomized browsing and direct uploads."
  />
</svelte:head>

<div class="page">
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">Private Mobile Client</p>
      <h1>Browse, upload, and repair from the phone.</h1>
      <p class="lede">
        This mobile client uses the same presigned upload contract as the desktop app:
        SHA-256 identifiers, duplicate detection, staged S3 uploads, and final integrity checks.
      </p>
    </section>

    <section class="panel config-panel">
      <div class="section-heading">
        <div>
          <p class="section-label">Configuration</p>
          <h2>Private build config</h2>
        </div>
        <span class="status-pill complete">Loaded</span>
      </div>

      <dl class="config-grid">
        <div>
          <dt>API base</dt>
          <dd>{configSummary.apiBaseUrl}</dd>
        </div>
        <div>
          <dt>CloudFront base</dt>
          <dd>{configSummary.cloudFrontBaseUrl}</dd>
        </div>
        <div>
          <dt>Write key</dt>
          <dd>{configSummary.writeApiKeyLoaded ? `Loaded (${configSummary.writeApiKeyLength} chars)` : 'Missing'}</dd>
        </div>
      </dl>

      <p class="panel-copy">
        Values are generated from <code>mobile.private.json</code> at build time. The write key is
        intentionally not displayed in the app UI.
      </p>
    </section>

    <section class="panel uploader">
      <div class="section-heading">
        <div>
          <p class="section-label">Uploader</p>
          <h2>Send originals and thumbnails</h2>
        </div>
        <button class="primary-button" type="button" on:click={() => fileInput?.click()}>
          Choose Files
        </button>
        <input
          bind:this={fileInput}
          class="hidden-input"
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          on:change={onFileInputChange}
        />
      </div>

      <p class="panel-copy">
        Supported originals: JPEG, PNG, GIF, WebP, BMP, TIFF, and WebM. WebM thumbnailing uses a
        native Capacitor bridge on mobile and a browser preview path only during local web testing.
      </p>

      {#if queueError}
        <p class="inline-error">{queueError}</p>
      {/if}

      {#if uploadItems.length === 0}
        <div class="empty-state">
          <p>No pending uploads yet.</p>
          <p class="muted">Selected files queue and upload one by one so retries stay predictable.</p>
        </div>
      {:else}
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
                <div class="upload-header">
                  <div>
                    <h3>{item.name}</h3>
                    <p class="meta">{Math.max(1, Math.round(item.size / 1024))} KB</p>
                  </div>
                  <span class={`status-pill ${item.status}`}>{statusText(item)}</span>
                </div>

                {#if item.id}
                  <p class="hash-line">{item.id}</p>
                {/if}

                {#if item.message}
                  <p class={`message ${item.status === 'failed' ? 'error-text' : item.status === 'cancelled' ? 'warning' : 'success'}`}>{item.message}</p>
                {/if}

                {#if item.error}
                  <p class="message error-text">{item.error}</p>
                {/if}

                {#if item.integrity?.repairRequired}
                  <p class="message warning">
                    Missing: {item.integrity.missing.join(', ')}
                  </p>
                {/if}

                <div class="upload-actions">
                  {#if canCancel(item)}
                    <button class="ghost-button" type="button" on:click={() => cancelUpload(item.localId)}>
                      Cancel
                    </button>
                  {/if}
                  {#if item.status === 'failed' || item.status === 'cancelled'}
                    <button class="secondary-button" type="button" on:click={() => retryUpload(item.localId)}>
                      Retry
                    </button>
                  {/if}
                  {#if item.id && (item.status === 'complete' || item.status === 'duplicate')}
                    <a class="secondary-link" href={detailUrlForUpload(item)}>Open</a>
                  {/if}
                  <button class="ghost-button" type="button" on:click={() => removeUpload(item.localId)}>
                    Remove
                  </button>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="panel browse">
      <div class="section-heading">
        <div>
          <p class="section-label">Shuffle</p>
          <h2>Randomized browse feed</h2>
        </div>
        <button class="secondary-button" type="button" on:click={retryBrowse}>
          Refresh
        </button>
      </div>

      {#if browseLoading}
        <div class="empty-state">
          <p>Loading browse feed...</p>
        </div>
      {:else if browseError}
        <div class="empty-state">
          <p>{browseError}</p>
          <button class="secondary-button" type="button" on:click={retryBrowse}>Try Again</button>
        </div>
      {:else}
        <div class="browse-grid">
          {#each browseItems as item (item.id)}
            <a class="browse-card" href={item.detailUrl}>
              <div class="browse-thumb">
                <img src={item.thumbnailUrl} alt={item.id} loading="lazy" />
              </div>
              <div class="browse-meta">
                <span>{item.kind === 'video' ? 'Video' : 'Image'}</span>
                <code>{item.id.slice(0, 12)}...</code>
              </div>
            </a>
          {/each}
        </div>

        {#if browseLoadingMore}
          <p class="footer-note">Loading more...</p>
        {:else if !browseHasMore}
          <p class="footer-note">End of this randomized pass.</p>
        {/if}

        <div bind:this={browseSentinel} class="scroll-sentinel" aria-hidden="true"></div>
      {/if}
    </section>

    <section class="panel contract">
      <div class="section-heading">
        <div>
          <p class="section-label">Contract</p>
          <h2>Current endpoint base</h2>
        </div>
      </div>
      <code class="endpoint">{buildApiUrl('/')}</code>
    </section>
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

  .shell {
    max-width: 68rem;
    margin: 0 auto;
    padding: 1.25rem 1rem 3rem;
  }

  .hero {
    padding: 1.5rem 0 1rem;
  }

  .eyebrow,
  .section-label {
    margin: 0 0 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.78rem;
    color: #9b4d20;
  }

  h1,
  h2,
  h3,
  p,
  dl,
  dd {
    margin: 0;
  }

  h1 {
    max-width: 13ch;
    font-size: clamp(2.45rem, 8vw, 4.4rem);
    line-height: 0.95;
  }

  h2 {
    font-size: 1.15rem;
  }

  h3 {
    font-size: 0.98rem;
    line-height: 1.3;
  }

  .lede,
  .panel-copy,
  .muted,
  .footer-note,
  .meta,
  .message,
  .hash-line,
  .browse-meta,
  .config-grid {
    color: #5f4f42;
    line-height: 1.5;
  }

  .lede {
    max-width: 43rem;
    margin-top: 0.85rem;
    font-size: 1rem;
  }

  .panel {
    background: rgba(255, 252, 247, 0.84);
    border: 1px solid rgba(73, 44, 29, 0.12);
    border-radius: 0.9rem;
    box-shadow: 0 12px 32px rgba(65, 43, 29, 0.08);
    padding: 1rem;
    margin-top: 1rem;
    backdrop-filter: blur(12px);
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .panel-copy {
    margin-top: 0.85rem;
    font-size: 0.95rem;
  }

  .config-grid {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .config-grid div {
    min-width: 0;
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: rgba(29, 24, 20, 0.06);
  }

  .config-grid dt {
    margin-bottom: 0.25rem;
    color: #8a4a22;
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .config-grid dd {
    overflow-wrap: anywhere;
    font-family: Consolas, monospace;
    font-size: 0.82rem;
  }

  .primary-button,
  .secondary-button,
  .ghost-button,
  .secondary-link {
    border: none;
    border-radius: 0.7rem;
    padding: 0.78rem 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .primary-button {
    background: #d95f1f;
    color: #fffaf4;
  }

  .secondary-button,
  .secondary-link {
    background: #0f766e;
    color: #f1fffd;
  }

  .ghost-button {
    background: transparent;
    color: #6c5443;
    border: 1px solid rgba(108, 84, 67, 0.22);
  }

  .hidden-input {
    display: none;
  }

  .empty-state {
    padding: 1.2rem 0 0.4rem;
    text-align: center;
  }

  .upload-list {
    display: grid;
    gap: 0.9rem;
    margin-top: 1rem;
  }

  .upload-card {
    display: grid;
    grid-template-columns: 6.25rem minmax(0, 1fr);
    gap: 0.85rem;
    padding: 0.85rem;
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.68);
    border: 1px solid rgba(73, 44, 29, 0.08);
  }

  .upload-thumb,
  .browse-thumb {
    overflow: hidden;
    border-radius: 0.65rem;
    background: #ddd4ca;
  }

  .upload-thumb {
    width: 6.25rem;
    height: 6.25rem;
  }

  .upload-thumb img,
  .upload-thumb video,
  .browse-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .upload-body {
    min-width: 0;
  }

  .upload-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .status-pill {
    flex: 0 0 auto;
    padding: 0.34rem 0.6rem;
    border-radius: 999px;
    font-size: 0.78rem;
    background: #eadfce;
    color: #5d4a3b;
  }

  .status-pill.complete,
  .status-pill.duplicate {
    background: #d7efe7;
    color: #0f5f56;
  }

  .status-pill.failed,
  .status-pill.cancelled {
    background: #f7d8d2;
    color: #8f3423;
  }

  .hash-line {
    margin-top: 0.55rem;
    font-family: Consolas, monospace;
    font-size: 0.72rem;
    word-break: break-all;
  }

  .message {
    margin-top: 0.45rem;
    font-size: 0.88rem;
  }

  .success {
    color: #0f5f56;
  }

  .warning {
    color: #9b4d20;
  }

  .error-text,
  .inline-error {
    color: #9a2e1b;
  }

  .upload-actions {
    display: flex;
    gap: 0.65rem;
    margin-top: 0.8rem;
    flex-wrap: wrap;
  }

  .browse-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem;
    margin-top: 1rem;
  }

  .browse-card {
    text-decoration: none;
    color: inherit;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(73, 44, 29, 0.08);
    border-radius: 0.8rem;
    overflow: hidden;
  }

  .browse-thumb {
    aspect-ratio: 1 / 1;
  }

  .browse-meta {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.7rem;
    font-size: 0.78rem;
  }

  .browse-meta code,
  .endpoint,
  .panel-copy code {
    font-family: Consolas, monospace;
  }

  .footer-note {
    margin-top: 0.8rem;
    text-align: center;
    font-size: 0.9rem;
  }

  .scroll-sentinel {
    width: 100%;
    height: 1px;
  }

  .contract {
    margin-bottom: 2rem;
  }

  .endpoint {
    display: block;
    margin-top: 1rem;
    padding: 0.8rem;
    border-radius: 0.75rem;
    background: rgba(29, 24, 20, 0.08);
    color: #3e3026;
    overflow-wrap: anywhere;
  }

  @media (min-width: 760px) {
    .shell {
      padding: 1.5rem 1.5rem 3.5rem;
    }

    .config-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .browse-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 520px) {
    .section-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .upload-card {
      grid-template-columns: 4.75rem minmax(0, 1fr);
    }

    .upload-thumb {
      width: 4.75rem;
      height: 4.75rem;
    }
  }
</style>
