<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import TagEditor from "./TagEditor.svelte";
  import { fetchTagSummary, fetchWatchPage, updateItemTags } from "$lib/functions/tags.js";
  import { deleteFromGrail, fetchDeletedItems, restoreToGrail } from "$lib/functions/grailItems.js";
  import type { DeletedItem } from "$lib/functions/grailItems.js";

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

  // Delete from the Grail. Deleted items leave the feed at once; an Undo bar offers to bring
  // the last one back, and the Deleted view lists everything still restorable (30 days).
  // The server's item list can lag a minute, so items deleted here stay hidden this session.
  const hiddenIds = new Set<string>();
  let undo = $state<{ item: WatchItem; index: number } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let deleting = $state(false);
  let showDeleted = $state(false);
  let deletedItems = $state<DeletedItem[]>([]);
  let deletedLoading = $state(false);
  let restoring = $state<{ [id: string]: boolean }>({});
  let noticeMessage = $state("");
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
      items = [...items, ...page.items.filter((item: WatchItem) => !known.has(item.id) && !hiddenIds.has(item.id))];
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
    showDeleted = false;
    untaggedOnly = false;
    filterTags = filterTags.includes(tag) ? filterTags.filter((value) => value !== tag) : [...filterTags, tag];
    void restart();
  }

  function showAll(): void {
    showDeleted = false;
    untaggedOnly = false;
    filterTags = [];
    void restart();
  }

  function showUntagged(): void {
    showDeleted = false;
    untaggedOnly = true;
    filterTags = [];
    void restart();
  }

  function clearUndo(): void {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    undo = null;
  }

  /** Deletes the open item, moves the viewer to the next one, and offers Undo for a while. */
  async function deleteOpenItem(): Promise<void> {
    if (openIndex == null || deleting) return;
    const index = openIndex;
    const item = items[index];
    if (!item) return;

    deleting = true;
    errorMessage = "";
    try {
      await deleteFromGrail(item.id);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Deleting failed";
      deleting = false;
      return;
    }
    deleting = false;

    hiddenIds.add(item.id);
    items = items.filter((entry) => entry.id !== item.id);
    totalCount = Math.max(0, totalCount - 1);
    if (items.length === 0) {
      openIndex = null;
    } else {
      openIndex = Math.min(index, items.length - 1);
      if (openIndex >= items.length - 3 && hasMore) void loadMore();
    }

    clearUndo();
    undo = { item, index };
    undoTimer = setTimeout(clearUndo, 10000);
  }

  async function undoDelete(): Promise<void> {
    if (!undo) return;
    const { item, index } = undo;
    clearUndo();
    try {
      await restoreToGrail(item.id);
      hiddenIds.delete(item.id);
      const at = Math.min(index, items.length);
      items = [...items.slice(0, at), item, ...items.slice(at)];
      totalCount += 1;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Restoring failed";
    }
  }

  async function openDeletedView(): Promise<void> {
    showDeleted = true;
    openIndex = null;
    deletedLoading = true;
    errorMessage = "";
    try {
      deletedItems = await fetchDeletedItems();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Loading deleted items failed";
    } finally {
      deletedLoading = false;
    }
  }

  async function restoreDeleted(item: DeletedItem): Promise<void> {
    restoring[item.id] = true;
    errorMessage = "";
    try {
      await restoreToGrail(item.id);
      hiddenIds.delete(item.id);
      deletedItems = deletedItems.filter((entry) => entry.id !== item.id);
      totalCount += 1;
      noticeMessage = "Restored. It is back in the feed.";
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Restoring failed";
    } finally {
      restoring[item.id] = false;
    }
  }

  function closeDeletedView(): void {
    showDeleted = false;
  }

  function formatDate(value: string | null): string {
    return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "unknown";
  }

  function daysLeft(value: string | null): string {
    if (!value) return "";
    const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
    if (days <= 1) return "Last day";
    return `${days} days left`;
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
    if (undoTimer) clearTimeout(undoTimer);
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet trashIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
{/snippet}

{#snippet closeIcon()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
{/snippet}

<section class="watch">
  {#if showDeleted}
    <div class="deleted-header">
      <button class="back-button" onclick={closeDeletedView}>‹ Back to the feed</button>
      <h2>Recently deleted</h2>
      <span class="deleted-sub">Restore brings an item back with its tags. After 30 days it is gone for good.</span>
    </div>
  {:else}
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
      <div class="watch-actions">
        <button class="quiet-button" onclick={openDeletedView} title="Items deleted in the last 30 days">
          {@render trashIcon()} Recently deleted
        </button>
        <button class="reshuffle" onclick={restart} title="New shuffle (also refreshes expired links)">🔀 Reshuffle</button>
      </div>
    </div>
  {/if}

  {#if errorMessage}
    <p class="watch-error" role="alert">⚠️ {errorMessage}</p>
  {/if}
  {#if noticeMessage}
    <p class="watch-notice" role="status">{noticeMessage} <button class="link-button" onclick={() => noticeMessage = ""}>OK</button></p>
  {/if}

  {#if showDeleted}
    <div class="watch-grid-wrap">
      {#if deletedLoading}
        <p class="watch-empty">Loading…</p>
      {:else if deletedItems.length === 0}
        <p class="watch-empty">Nothing deleted in the last 30 days.</p>
      {:else}
        <ul class="deleted-grid">
          {#each deletedItems as item (item.id)}
            <li class="deleted-card">
              <div class="tile" title={item.tags.length ? item.tags.join(', ') : 'No tags'}>
                {#if item.thumbnailUrl}<img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" />{/if}
                {#if item.ext === 'mp4' || item.ext === 'webm'}<span class="tile-video">▶</span>{/if}
              </div>
              <div class="deleted-meta">
                <span class="days-left" title="Deleted {formatDate(item.deletedAt)}, gone for good on {formatDate(item.restorableUntil)}">
                  {daysLeft(item.restorableUntil)}
                </span>
                <button class="restore-button" onclick={() => restoreDeleted(item)} disabled={restoring[item.id]}>
                  {restoring[item.id] ? 'Restoring…' : 'Restore'}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if undo}
    <div class="toast" role="status">
      <span>Deleted from the Grail</span>
      <button class="toast-undo" onclick={undoDelete}>Undo</button>
      <button class="toast-close" onclick={clearUndo} aria-label="Dismiss">{@render closeIcon()}</button>
    </div>
  {/if}

  <div class="watch-grid-wrap" class:hidden={showDeleted}>
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
        <div class="viewer-toolbar">
          <button
            class="icon-button danger"
            onclick={deleteOpenItem}
            disabled={deleting}
            title="Delete from the Grail (restorable for 30 days)"
            aria-label="Delete from the Grail"
          >{@render trashIcon()}</button>
          <button class="icon-button" onclick={() => openIndex = null} title="Close (Esc)" aria-label="Close viewer">{@render closeIcon()}</button>
        </div>
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

  .viewer-nav {
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

  .viewer-toolbar {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    display: flex;
    gap: 0.4rem;
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    padding: 0;
    color: #e5e7eb;
    background-color: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 9999px;
    box-shadow: none;
  }

  .icon-button:hover:not(:disabled) {
    color: #fff;
    background-color: rgba(255, 255, 255, 0.2);
  }

  .icon-button.danger:hover:not(:disabled) {
    color: #fff;
    background-color: #dc2626;
  }

  .icon-button:disabled {
    opacity: 0.4;
  }

  /* One Undo toast for the feed and the viewer, above both. */
  .toast {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.4rem 0.35rem 1rem;
    font-size: 0.88rem;
    color: #f9fafb;
    background-color: #111827;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    animation: toast-in 0.15s ease-out;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, -6px);
    }
  }

  .toast-undo {
    padding: 0.25rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: #93c5fd;
    background: none;
    border: none;
    box-shadow: none;
  }

  .toast-undo:hover {
    color: #bfdbfe;
    background-color: rgba(255, 255, 255, 0.08);
  }

  .toast-close {
    display: inline-flex;
    padding: 0.25rem;
    color: #9ca3af;
    background: none;
    border: none;
    box-shadow: none;
  }

  .toast-close:hover {
    color: #fff;
    background-color: rgba(255, 255, 255, 0.08);
  }

  .link-button {
    padding: 0 0.3rem;
    font-size: 0.82rem;
    color: inherit;
    background: none;
    border: none;
    text-decoration: underline;
  }

  .link-button:hover {
    background: none;
  }

  .watch-actions {
    margin-left: auto;
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }

  .watch-actions .reshuffle {
    margin-left: 0;
  }

  .quiet-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.7rem;
    font-size: 0.82rem;
    color: #6b7280;
    background: none;
    border: none;
    box-shadow: none;
  }

  .quiet-button:hover {
    color: inherit;
    background-color: rgba(127, 127, 127, 0.12);
  }

  .quiet-button svg {
    width: 16px;
    height: 16px;
  }

  .deleted-header {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.4rem 0.9rem;
  }

  .deleted-header h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .deleted-sub {
    font-size: 0.82rem;
    color: #6b7280;
  }

  .back-button {
    padding: 0.25rem 0.7rem;
    font-size: 0.82rem;
  }

  .hidden {
    display: none;
  }

  .watch-notice {
    margin: 0;
    font-size: 0.85rem;
    color: #047857;
  }

  .deleted-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 0.8rem;
  }

  .deleted-card {
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 8px;
    overflow: hidden;
  }

  .deleted-card .tile {
    border-radius: 0;
  }

  .deleted-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.45rem 0.55rem;
  }

  .days-left {
    font-size: 0.8rem;
    color: #6b7280;
  }

  .restore-button {
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: #2563eb;
    background: none;
    border: 1px solid currentColor;
    border-radius: 9999px;
    box-shadow: none;
  }

  .restore-button:hover:not(:disabled) {
    color: white;
    background-color: #2563eb;
    border-color: #2563eb;
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

    .quiet-button,
    .deleted-sub,
    .days-left {
      color: #9ca3af;
    }

    .restore-button {
      color: #60a5fa;
    }

    .restore-button:hover:not(:disabled) {
      color: white;
    }
  }
</style>
