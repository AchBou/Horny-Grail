<script>
  /**
   * @type {{
   *   summary: string,
   *   uploadCount: number,
   *   uploadSummary: string,
   *   uploadProgress: number,
   *   previewItems: any[],
   *   canOpenBrowse: boolean,
   *   onBrowse: () => void,
   *   onUpload: () => void
   * }}
   */
  let { summary, uploadCount, uploadSummary, uploadProgress, previewItems, canOpenBrowse, onBrowse, onUpload } = $props();
</script>

<section class="home-panel">
  <div class="home-copy">
    <h2>Your private collection, without the clutter.</h2>
    <p>{summary}</p>
  </div>

  <div class="home-actions">
    <button class="primary-button" type="button" onclick={onBrowse}>
      Browse
    </button>
    <button class="secondary-button" type="button" onclick={onUpload}>
      Add Media
    </button>
  </div>

  {#if uploadCount > 0}
    <button class="queue-banner" type="button" onclick={onUpload}>
      <span class="queue-banner-copy">
        <span class="queue-banner-label">Upload queue</span>
        <strong>{uploadSummary}</strong>
      </span>
      <span class="queue-banner-meter">{uploadProgress}%</span>
    </button>
  {/if}
</section>

<section class="preview-panel">
  <div class="section-heading">
    <div>
      <p class="eyebrow">Quick Start</p>
      <h3>{previewItems.length > 0 ? 'Recent preview' : 'Two simple paths'}</h3>
    </div>
    {#if canOpenBrowse}
      <button class="plain-button" type="button" onclick={onBrowse}>Open</button>
    {/if}
  </div>

  {#if previewItems.length > 0}
    <div class="preview-grid" aria-label="Preview items">
      {#each previewItems as item}
        {#if item.localId}
          <button class="preview-card" type="button" onclick={onUpload}>
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
      <button class="starter-card" type="button" onclick={onBrowse}>
        <p class="eyebrow">Browse</p>
        <strong>Open the vault</strong>
        <span>Load a fresh mix only when you ask for it.</span>
      </button>
      <button class="starter-card" type="button" onclick={onUpload}>
        <p class="eyebrow">Add</p>
        <strong>Save new media</strong>
        <span>Pick files and let the queue do the heavy lifting.</span>
      </button>
    </div>
  {/if}
</section>

<style>
  .home-copy p {
    color: var(--text-body);
    line-height: 1.38;
    font-size: 0.98rem;
  }

  .plain-button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .plain-button {
    color: var(--accent);
    font-weight: 700;
  }

  .home-panel,
  .preview-panel {
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

  .home-actions {
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

  .queue-banner-label {
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

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .preview-card,
  .starter-card {
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

  .preview-card img {
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

  .preview-card:active img {
    transform: scale(0.985);
  }

  .preview-card img {
    transition: transform 160ms ease;
  }

  @media (min-width: 720px) {

    .home-panel,
    .preview-panel {
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

    .preview-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
}
</style>
