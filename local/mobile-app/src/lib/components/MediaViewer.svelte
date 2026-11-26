<script module>
  // Sound stays as the user last set it, so unmuting once carries on to the next videos.
  const sound = $state({ muted: true });
</script>

<script>
  import { onMount } from 'svelte';

  /**
   * Full-screen viewer over the Browse grid. Swipe (or ‹ ›) moves through the grid's items,
   * tapping a tag filters by it, Back (the phone's or ✕) closes it where you left off.
   * @type {{
   *   item: { id: string, kind: 'image' | 'video', ext: string, tags: string[], fileUrl: string, thumbnailUrl: string, dateAdded?: string | null },
   *   position: string,
   *   hasPrev: boolean,
   *   hasNext: boolean,
   *   onPrev: () => void,
   *   onNext: () => void,
   *   onClose: () => void,
   *   onTag: (tag: string) => void
   * }}
   */
  let { item, position, hasPrev, hasNext, onPrev, onNext, onClose, onTag } = $props();

  let failed = $state(false);
  let showInfo = $state(false);
  let touchStart = null;

  $effect(() => {
    item.id;
    failed = false;
  });

  function formatDate(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function onTouchStart(event) {
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event) {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && hasNext) onNext();
    if (dx > 0 && hasPrev) onPrev();
  }

  function onKeydown(event) {
    if (event.key === 'ArrowRight' && hasNext) onNext();
    else if (event.key === 'ArrowLeft' && hasPrev) onPrev();
    else if (event.key === 'Escape') onClose();
  }

  onMount(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="viewer" role="dialog" aria-modal="true" aria-label="Viewer">
  <div class="stage" role="presentation" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
    {#key item.id}
      {#if failed}
        <p class="failed">This file could not be loaded.</p>
      {:else if item.kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          class="media"
          src={item.fileUrl}
          poster={item.thumbnailUrl}
          controls
          autoplay
          loop
          playsinline
          bind:muted={sound.muted}
          onerror={() => (failed = true)}
        ></video>
      {:else}
        <img class="media" src={item.fileUrl} alt="" onerror={() => (failed = true)} />
      {/if}
    {/key}
  </div>

  <div class="top-bar">
    <button class="round" type="button" onclick={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <span class="position">{position}</span>
    <button class="round" type="button" class:on={showInfo} aria-pressed={showInfo} onclick={() => (showInfo = !showInfo)} aria-label="Details">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5v5M12 7.5h.01" /></svg>
    </button>
  </div>

  {#if hasPrev}
    <button class="nav prev" type="button" onclick={onPrev} aria-label="Previous">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
  {/if}
  {#if hasNext}
    <button class="nav next" type="button" onclick={onNext} aria-label="Next">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
  {/if}

  <div class="bottom" class:raised={item.kind === 'video'}>
    {#if showInfo}
      <p class="details">
        {item.kind === 'video' ? 'Video' : 'Image'} · {item.ext?.toUpperCase()} · added {formatDate(item.dateAdded)}
      </p>
    {/if}
    {#if item.tags.length > 0}
      <div class="tags">
        {#each item.tags as tag (tag)}
          <button class="tag" type="button" onclick={() => onTag(tag)}>{tag}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #0b0a09;
    color: #f5efe8;
  }

  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: pan-y;
  }

  .media {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
  }

  .failed {
    color: #a8a29e;
  }

  button {
    font: inherit;
    cursor: pointer;
  }

  svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px;
    pointer-events: none;
  }

  .top-bar > * {
    pointer-events: auto;
  }

  .round,
  .nav {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    color: #f5efe8;
    background: rgba(0, 0, 0, 0.55);
  }

  .round {
    width: 44px;
    height: 44px;
    border-radius: 50%;
  }

  .round.on {
    background: rgba(255, 255, 255, 0.25);
  }

  .position {
    padding: 5px 12px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 64px;
    border-radius: 12px;
  }

  .prev {
    left: 8px;
  }

  .next {
    right: 8px;
  }

  /* Touch phones swipe; the side buttons would only cover the picture. */
  @media (hover: none) {
    .nav {
      display: none;
    }
  }

  .bottom {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }

  .bottom.raised {
    bottom: calc(env(safe-area-inset-bottom, 0px) + 64px);
  }

  .details {
    margin: 0;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.6);
    font-size: 0.85rem;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  .tag {
    pointer-events: auto;
    padding: 7px 14px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #f5efe8;
    font-size: 0.85rem;
    font-weight: 600;
  }
</style>
