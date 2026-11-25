<script>
  /**
   * @type {{
   *   summary: string,
   *   loading: boolean,
   *   error: string | null,
   *   items: any[],
   *   loadingMore: boolean,
   *   hasMore: boolean,
   *   sentinel?: HTMLElement,
   *   onRefresh: () => void,
   *   onAdd: () => void
   * }}
   */
  let { summary, loading, error, items, loadingMore, hasMore, sentinel = $bindable(), onRefresh, onAdd } = $props();
</script>

<section class="browse-top">
  <div>
    <p class="eyebrow">Browse</p>
    <h2>Your collection</h2>
    <p class="section-copy">{summary}</p>
  </div>

  <div class="browse-actions">
    <button class="toggle-chip active" type="button" aria-pressed="true">
      Shuffle
    </button>
    <button class="soft-button" type="button" onclick={onRefresh}>
      Refresh
    </button>
  </div>
</section>

{#if loading}
  <section class="gallery-grid skeleton-grid" aria-label="Loading gallery">
    {#each Array(8) as _}
      <div class="skeleton-card"></div>
    {/each}
  </section>
{:else if error}
  <section class="empty-state">
    <h2>Could not load the gallery.</h2>
    <p>{error}</p>
    <button class="primary-button" type="button" onclick={onRefresh}>Try Again</button>
  </section>
{:else if items.length === 0}
  <section class="empty-state">
    <h2>Your Grail is empty.</h2>
    <p>Add a few files from your phone and they will appear here.</p>
    <button class="primary-button" type="button" onclick={onAdd}>
      Add Media
    </button>
  </section>
{:else}
  <section class="gallery-grid" aria-label="Randomized gallery">
    {#each items as item (item.id)}
      <a class="gallery-card" href={item.detailUrl}>
        <img src={item.thumbnailUrl} alt={item.kind === 'video' ? 'Video thumbnail' : 'Image thumbnail'} loading="lazy" />
        {#if item.kind === 'video'}
          <span class="media-badge">Clip</span>
        {/if}
      </a>
    {/each}
  </section>

  {#if loadingMore}
    <p class="footer-note">Loading more...</p>
  {:else if !hasMore}
    <p class="footer-note">End of this mix.</p>
  {/if}

  <div bind:this={sentinel} class="scroll-sentinel" aria-hidden="true"></div>
{/if}

<style>
  .section-copy,
  .footer-note,
  .empty-state p {
    color: var(--text-body);
    line-height: 1.38;
    font-size: 0.98rem;
  }

  .toggle-chip {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .gallery-card,
  .skeleton-card {
    position: relative;
    overflow: hidden;
    border-radius: 1rem;
    border: 1px solid var(--stroke-soft);
    background: var(--bg-surface-strong);
    box-shadow: var(--shadow-soft);
  }

  .gallery-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .browse-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

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

  .gallery-card:active img {
    transform: scale(0.985);
  }

  .gallery-card img {
    transition: transform 160ms ease;
  }

  .skeleton-grid {
    pointer-events: none;
  }

  .skeleton-card {
    background: linear-gradient(110deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.4));
    background-size: 220% 100%;
    animation: shimmer 1.4s linear infinite;
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

  @media (min-width: 720px) {

    .gallery-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .browse-top {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }
}

  @keyframes shimmer {
    to {
      background-position: -220% 0;
    }
  }
</style>
