<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import TagEditor from "./TagEditor.svelte";
  import { fetchTagSummary, fetchWatchPage, updateItemTags } from "$lib/functions/tags.js";

  // The Watch tab: a shuffled feed of everything in the Grail. Open an item to view it full
  // size and tag it on the spot; ←/→ move through the feed, Esc closes the viewer.
  let {
    tagSuggestions = [],
    onTagsSaved
  }: {
    tagSuggestions?: string[];
    onTagsSaved: (tags: string[]) => void;
  } = $props();

  type WatchItem = {
    id: string;
    ext: string;
    tags?: string[];
    fileUrl: string;
    thumbnailUrl: string;
  };
  type TagCount = { tag: string; count: number };

  let items = $state<WatchItem[]>([]);
  let cursor = $state<string | null>(null);
  let hasMore = $state(true);
  let loading = $state(false);
  let errorMessage = $state("");
  let generation = 0;

  // Filter: everything, only untagged items, or items carrying every selected tag.
  let untaggedOnly = $state(false);
  let filterTags = $state<string[]>([]);
  let tagCounts = $state<TagCount[]>([]);
  let totalCount = $state(0);
  let untaggedCount = $state(0);

  let openIndex = $state<number | null>(null);
  let pendingSaves = $state(0);
  let sentinel: HTMLElement | undefined = $state();
  const openItem = $derived(openIndex == null ? null : items[openIndex] ?? null);

  function isVideo(item: WatchItem): boolean {
    return item.ext === "mp4" || item.ext === "webm";
  }

  async function loadSummary(): Promise<void> {
    try {
      const summary = await fetchTagSummary();
      tagCounts = summary.tags;
      totalCount = summary.total;
      untaggedCount = summary.untagged;
    } catch (error) {
      console.warn("Could not load tag counts", error);
    }
  }

  /** Starts a new shuffle with the current filter. */
  async function restart(): Promise<void> {
    // A page still loading for the old filter is discarded when it lands (generation check),
    // so it must not keep this new load from starting.
    generation += 1;
    loading = false;
    items = [];
    cursor = null;
    hasMore = true;
    openIndex = null;
    errorMessage = "";
    await loadMore();
    void loadSummary();
  }

  async function loadMore(): Promise<void> {
    if (loading || !hasMore) return;
    const current = generation;
    loading = true;
    try {
      const page = await fetchWatchPage({ cursor, tags: filterTags, untagged: untaggedOnly });
      if (current !== generation) return;
      const known = new Set(items.map((item) => item.id));
      items = [...items, ...page.items.filter((item: WatchItem) => !known.has(item.id))];
      cursor = page.cursor;
      hasMore = page.hasMore;
    } catch (error) {
      if (current === generation) {
        errorMessage = error instanceof Error ? error.message : "Loading the feed failed";
      }
    } finally {
      if (current === generation) loading = false;
    }
  }

  function toggleFilterTag(tag: string): void {
    untaggedOnly = false;
    filterTags = filterTags.includes(tag) ? filterTags.filter((value) => value !== tag) : [...filterTags, tag];
    void restart();
  }

  function showAll(): void {
    untaggedOnly = false;
    filterTags = [];
    void restart();
  }

  function showUntagged(): void {
    untaggedOnly = true;
    filterTags = [];
    void restart();
  }

  function setItemTags(id: string, tags: string[]): void {
    items = items.map((entry) => (entry.id === id ? { ...entry, tags } : entry));
  }

  // Tags show at once; the save runs in the background (in order per item) and its result,
  // or the previous tags if it fails, replaces what is shown.
  async function changeTags(item: WatchItem, change: { add?: string[]; remove?: string[] }): Promise<void> {
    const before = items.find((entry) => entry.id === item.id)?.tags || [];
    const removed = new Set(change.remove || []);
    const optimistic = [...before.filter((tag) => !removed.has(tag)), ...(change.add || []).filter((tag) => !before.includes(tag))];
    setItemTags(item.id, optimistic);
    if (change.add?.length) onTagsSaved(change.add);

    pendingSaves += 1;
    errorMessage = "";
    try {
      setItemTags(item.id, await updateItemTags(item.id, change));
    } catch (error) {
      setItemTags(item.id, before);
      errorMessage = error instanceof Error ? error.message : "Saving tags failed";
    } finally {
      pendingSaves -= 1;
    }
  }

  async function step(delta: number): Promise<void> {
    if (openIndex == null) return;
    const next = openIndex + delta;
    if (next < 0) return;
    if (next >= items.length - 3 && hasMore) await loadMore();
    if (next < items.length) {
      openIndex = next;
      await tick();
      document.querySelector(`[data-watch-id="${items[next].id}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (openIndex == null) return;
    if (event.key === "Escape") {
      openIndex = null;
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      void step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      void step(-1);
    }
  }

  // Load the next page when the end of the grid comes into view.
  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  void restart();

  onDestroy(() => {
    generation += 1;
  });
</script>

<svelte:window onkeydown={onKeydown} />

<section class="watch">
  <div class="watch-filters" aria-label="Filter the feed">
    <button class="filter-chip" class:selected={!untaggedOnly && filterTags.length === 0} onclick={showAll}>
      All <span class="count">{totalCount || ''}</span>
    </button>
    <button class="filter-chip untagged" class:selected={untaggedOnly} onclick={showUntagged} title="Items with no tags yet">
      Untagged <span class="count">{untaggedCount}</span>
    </button>
    {#each tagCounts as entry (entry.tag)}
      <button class="filter-chip" class:selected={filterTags.includes(entry.tag)} onclick={() => toggleFilterTag(entry.tag)}>
        {entry.tag} <span class="count">{entry.count}</span>
      </button>
    {/each}
    <button class="reshuffle" onclick={restart} title="New shuffle (also refreshes expired links)">🔀 Reshuffle</button>
  </div>

  {#if errorMessage}
    <p class="watch-error" role="alert">⚠️ {errorMessage}</p>
  {/if}

  <div class="watch-grid-wrap">
    {#if items.length === 0 && !loading}
      <p class="watch-empty">
        {untaggedOnly ? 'Everything is tagged. 🎉' : filterTags.length ? 'No items have all of these tags.' : 'Nothing in the Grail yet.'}
      </p>
    {/if}
    <ul class="watch-grid">
      {#each items as item, index (item.id)}
        <li data-watch-id={item.id} class:current={openIndex === index}>
          <button class="tile" onclick={() => openIndex = index} title={(item.tags || []).join(', ') || 'No tags yet'}>
            <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" />
            {#if isVideo(item)}<span class="tile-video">▶</span>{/if}
            {#if item.tags?.length}<span class="tile-tags">{item.tags.length} 🏷</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
    <div bind:this={sentinel} class="sentinel"></div>
    {#if loading}<p class="watch-empty">Loading…</p>{/if}
  </div>

  {#if openItem}
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Viewer">
      <div class="viewer-media">
        <button class="viewer-nav prev" onclick={() => step(-1)} disabled={openIndex === 0} aria-label="Previous">‹</button>
        {#key openItem.id}
          {#if isVideo(openItem)}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={openItem.fileUrl} controls autoplay loop></video>
          {:else}
            <img src={openItem.fileUrl} alt="" />
          {/if}
        {/key}
        <button class="viewer-nav next" onclick={() => step(1)} disabled={openIndex === items.length - 1 && !hasMore} aria-label="Next">›</button>
        <button class="viewer-close" onclick={() => openIndex = null} aria-label="Close viewer">✕</button>
      </div>
      <div class="viewer-tags">
        {#key openItem.id}
          <TagEditor
            tags={openItem.tags || []}
            suggestions={tagSuggestions}
            placeholder="Type a tag and press Enter — saved right away"
            onAdd={(tags) => changeTags(openItem, { add: tags })}
            onRemove={(tag) => changeTags(openItem, { remove: [tag] })}
            quickCount={16}
            autofocus
          />
        {/key}
        <span class="viewer-hint">
          {pendingSaves > 0 ? 'Saving…' : 'Saved'} · Enter add · Tab complete · ← → next · Esc close
        </span>
      </div>
    </div>
  {/if}
</section>

<style>
  .watch {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .watch-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    max-height: 6.5rem;
    overflow-y: auto;
  }

  .filter-chip {
    padding: 0.2rem 0.7rem;
    font-size: 0.82rem;
    border-radius: 9999px;
    background-color: transparent;
    color: inherit;
    border: 1px solid #cbd5e1;
  }

  .filter-chip.selected {
    background-color: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }

  .filter-chip.untagged:not(.selected) {
    border-style: dashed;
  }

  .count {
    opacity: 0.7;
    font-size: 0.75rem;
  }

  .reshuffle {
    margin-left: auto;
    padding: 0.25rem 0.8rem;
    font-size: 0.82rem;
  }

  .watch-error {
    margin: 0;
    color: #b91c1c;
    font-size: 0.85rem;
  }

  .watch-grid-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .watch-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.4rem;
  }

  .watch-grid li.current .tile {
    outline: 3px solid #3b82f6;
  }

  .tile {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: 6px;
    overflow: hidden;
    background-color: #e5e7eb;
  }

  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .tile-video,
  .tile-tags {
    position: absolute;
    padding: 0.05rem 0.35rem;
    font-size: 0.72rem;
    color: white;
    background-color: rgba(0, 0, 0, 0.6);
    border-radius: 4px;
  }

  .tile-video {
    top: 0.3rem;
    left: 0.3rem;
  }

  .tile-tags {
    bottom: 0.3rem;
    right: 0.3rem;
  }

  .watch-empty {
    text-align: center;
    color: #666;
    font-size: 0.9rem;
  }

  .sentinel {
    height: 1px;
  }

  .viewer {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    background-color: rgba(10, 10, 12, 0.96);
    color: #eee;
  }

  .viewer-media {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .viewer-media img,
  .viewer-media video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .viewer-nav,
  .viewer-close {
    position: absolute;
    border: none;
    color: white;
    background-color: rgba(255, 255, 255, 0.12);
  }

  .viewer-nav {
    top: 50%;
    transform: translateY(-50%);
    width: 2.6rem;
    height: 4rem;
    padding: 0;
    font-size: 2rem;
  }

  .viewer-nav:disabled {
    opacity: 0.25;
  }

  .prev {
    left: 0.6rem;
  }

  .next {
    right: 0.6rem;
  }

  .viewer-close {
    top: 0.6rem;
    right: 0.6rem;
    width: 2.4rem;
    height: 2.4rem;
    padding: 0;
    font-size: 1.1rem;
    border-radius: 9999px;
  }

  .viewer-tags {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.7rem 1rem 0.9rem;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }

  .viewer-tags :global(.tag-editor) {
    flex: 1;
  }

  .viewer-tags :global(input) {
    background-color: #1f2937;
    border-color: #4b5563;
    color: #f9fafb;
  }

  .viewer-tags :global(.bubble) {
    color: #e5e7eb;
    border-color: #6b7280;
  }

  .viewer-tags :global(.bubble:hover) {
    color: #fff;
    background-color: #1e3a8a;
    border-color: #3b82f6;
  }

  .viewer-tags :global(.chip) {
    color: #dbeafe;
    background-color: #1e3a8a;
    border-color: #3b82f6;
  }

  .viewer-hint {
    font-size: 0.75rem;
    opacity: 0.6;
    white-space: nowrap;
  }

  @media (prefers-color-scheme: dark) {
    .tile {
      background-color: #3f3f46;
    }

    .watch-empty {
      color: #9ca3af;
    }

    .watch-error {
      color: #fca5a5;
    }
  }
</style>
