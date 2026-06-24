<script>
  import { onDestroy, onMount } from 'svelte';
  import {
    buildApiUrl,
    buildCloudFrontFileUrl,
    buildCloudFrontThumbnailUrl
  } from '$lib/config/privateConfig.js';
  import { fetchRandomBrowsePage } from '$lib/mobile/api.js';
  import { runUploadFlow } from '$lib/mobile/uploadFlow.js';

  const BROWSE_PAGE_SIZE = 18;
  const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.webm,image/*,video/webm';
  const STATUS_LABELS = {
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
    failed: 'Failed'
  };

  let browseItems = [];
  let browseCursor = null;
  let browseHasMore = false;
  let browseLoading = true;
  let browseLoadingMore = false;
  let browseError = null;
  let browseSentinel;
  let browseObserver;

  let uploadItems = [];
  let isProcessingQueue = false;
  let queueError = null;
  let fileInput;

  function nextLocalId() {
    return `upload-${crypto.randomUUID()}`;
  }

  function createUploadPreview(file) {
    return URL.createObjectURL(file);
  }

  function releasePreview(url) {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }

  function updateUploadItem(localId, patch) {
    uploadItems = uploadItems.map((item) => item.localId === localId ? { ...item, ...patch } : item);
  }

  function normalizeBrowseItem(item) {
    if (!item?.id || !item?.ext) {
      return null;
    }

    return {
      id: item.id,
      ext: item.ext,
      thumbnailUrl: buildCloudFrontThumbnailUrl(item.id),
      fileUrl: buildCloudFrontFileUrl(item.id, item.ext),
      isVideo: item.ext.toLowerCase() === 'webm'
    };
  }

  function appendBrowseItems(items) {
    const seen = new Set(browseItems.map((item) => item.id));
    const nextItems = items
      .map(normalizeBrowseItem)
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item.id)) {
          return false;
        }

        seen.add(item.id);
        return true;
      });

    browseItems = browseItems.concat(nextItems);
  }

  async function loadBrowsePage(cursor = null) {
    if (cursor) {
      browseLoadingMore = true;
    } else {
      browseLoading = true;
      browseError = null;
      browseItems = [];
      browseCursor = null;
      browseHasMore = false;
    }

    try {
      const payload = await fetchRandomBrowsePage(cursor, BROWSE_PAGE_SIZE);
      appendBrowseItems(payload?.items || []);
      browseCursor = payload?.cursor || null;
      browseHasMore = Boolean(payload?.hasMore);
    } catch (error) {
      console.error('Failed to load browse page', error);
      browseError = error?.message || 'Failed to load browse items';
    } finally {
      browseLoading = false;
      browseLoadingMore = false;
    }
  }

  function browseStatusText(item) {
    if (!item.status) {
      return 'Pending';
    }

    return STATUS_LABELS[item.status] || item.status;
  }

  function browseOutcomeText(item) {
    if (item.outcome === 'duplicate') {
      return 'Duplicate detected';
    }

    if (item.outcome === 'repaired') {
      return 'Repair completed';
    }

    if (item.outcome === 'uploaded') {
      return 'Upload completed';
    }

    return '';
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

        updateUploadItem(nextItem.localId, {
          status: 'hashing',
          error: null,
          message: ''
        });

        try {
          const result = await runUploadFlow(nextItem.file, (status, detail = null) => {
            updateUploadItem(nextItem.localId, {
              status,
              id: detail?.id || nextItem.id,
              integrity: detail?.integrity || nextItem.integrity
            });
          });

          updateUploadItem(nextItem.localId, {
            status: result.outcome === 'duplicate' ? 'duplicate' : 'complete',
            id: result.id,
            ext: result.ext,
            outcome: result.outcome,
            integrity: result.integrity,
            message: browseOutcomeText({ outcome: result.outcome })
          });
        } catch (error) {
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
    }
  }

  function enqueueFiles(fileList) {
    const nextItems = Array.from(fileList || []).map((file) => ({
      localId: nextLocalId(),
      file,
      name: file.name,
      size: file.size,
      previewUrl: createUploadPreview(file),
      status: 'queued',
      message: '',
      error: null,
      id: null,
      ext: null,
      outcome: null,
      integrity: null
    }));

    uploadItems = uploadItems.concat(nextItems);
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
      outcome: null
    });
    processQueue();
  }

  function removeUpload(localId) {
    const item = uploadItems.find((entry) => entry.localId === localId);
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
    browseObserver?.disconnect();
    for (const item of uploadItems) {
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
      <h1>Browse and upload from the phone.</h1>
      <p class="lede">
        This mobile client uses the same presigned upload contract as the desktop app, including
        duplicate detection, repair checks, and retry handling between stages.
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
        Supported originals: JPEG, PNG, GIF, WebP, BMP, TIFF, and WebM. The client hashes the
        original, checks integrity, uploads missing assets, and only registers metadata when both
        objects exist.
      </p>

      {#if queueError}
        <p class="inline-error">{queueError}</p>
      {/if}

      {#if uploadItems.length === 0}
        <div class="empty-state">
          <p>No pending uploads yet.</p>
          <p class="muted">Selected files will queue and upload one by one.</p>
        </div>
      {:else}
        <div class="upload-list">
          {#each uploadItems as item (item.localId)}
            <article class="upload-card">
              <div class="upload-thumb">
                {#if item.file.type.startsWith('video/')}
                  <video src={item.previewUrl} muted playsinline preload="metadata"></video>
                {:else}
                  <img src={item.previewUrl} alt={item.name} />
                {/if}
              </div>
              <div class="upload-body">
                <div class="upload-header">
                  <div>
                    <h3>{item.name}</h3>
                    <p class="meta">{Math.round(item.size / 1024)} KB</p>
                  </div>
                  <span class={`status-pill ${item.status}`}>{browseStatusText(item)}</span>
                </div>

                {#if item.id}
                  <p class="hash-line">{item.id}</p>
                {/if}

                {#if item.message}
                  <p class="message success">{item.message}</p>
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
                  {#if item.status === 'failed'}
                    <button class="secondary-button" type="button" on:click={() => retryUpload(item.localId)}>
                      Retry
                    </button>
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
            <a class="browse-card" href={item.fileUrl} target="_blank" rel="noreferrer">
              <div class="browse-thumb">
                <img src={item.thumbnailUrl} alt={item.id} loading="lazy" />
              </div>
              <div class="browse-meta">
                <span>{item.isVideo ? 'Video' : 'Image'}</span>
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
  p {
    margin: 0;
  }

  h1 {
    max-width: 11ch;
    font-size: clamp(2.5rem, 8vw, 4.4rem);
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
  .browse-meta {
    color: #5f4f42;
    line-height: 1.5;
  }

  .lede {
    max-width: 40rem;
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

  .primary-button,
  .secondary-button,
  .ghost-button {
    border: none;
    border-radius: 0.7rem;
    padding: 0.78rem 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  .primary-button {
    background: #d95f1f;
    color: #fffaf4;
  }

  .secondary-button {
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

  .status-pill.failed {
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
  .endpoint {
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

    .browse-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
