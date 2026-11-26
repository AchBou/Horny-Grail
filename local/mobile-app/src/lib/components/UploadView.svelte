<script>
  import {
    canCancel,
    detailUrlForUpload,
    formatFileSize,
    isDeletableFromPhone,
    isVideoUpload,
    statusText,
    uploadProgress
  } from '$lib/mobile/uploadDisplay.js';

  /**
   * @type {{
   *   items: any[],
   *   activeCount: number,
   *   finishedCount: number,
   *   failedCount: number,
   *   summary: string,
   *   progress: number,
   *   deletableCount: number,
   *   copiedLocalId: string | null,
   *   showQueue: boolean,
   *   onPick: () => void,
   *   onBack: () => void,
   *   onRequestDeleteAll: () => void,
   *   onCopyName: (item: any) => void,
   *   onCancel: (localId: string) => void,
   *   onRetry: (localId: string) => void,
   *   onDeleteFromPhone: (localId: string) => void,
   *   onRemove: (localId: string) => void
   * }}
   */
  let {
    items,
    activeCount,
    finishedCount,
    failedCount,
    summary,
    progress,
    deletableCount,
    copiedLocalId,
    showQueue = $bindable(),
    onPick,
    onBack,
    onRequestDeleteAll,
    onCopyName,
    onCancel,
    onRetry,
    onDeleteFromPhone,
    onRemove
  } = $props();
</script>

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
    <button class="primary-button" type="button" onclick={onPick}>
      Choose Files
    </button>
    <button class="secondary-button" type="button" onclick={onBack}>
      Back
    </button>
  </div>

  {#if items.length > 0}
    <div class="mini-stats" aria-label="Upload queue summary">
      <span><strong>{finishedCount}</strong> done</span>
      <span><strong>{activeCount}</strong> active</span>
      <span><strong>{failedCount}</strong> issues</span>
    </div>
  {/if}
</section>

{#if items.length > 0}
  <section class={`upload-dock ${showQueue ? 'expanded' : ''} ${activeCount > 0 ? 'active' : ''}`}>
    <button class="dock-summary" type="button" onclick={() => showQueue = !showQueue}>
      <span>
        <span class="dock-label">Uploads</span>
        <strong>{summary}</strong>
      </span>
      <span class="dock-progress">{progress}%</span>
    </button>
    <div class="queue-meter" aria-hidden="true">
      <span style={`width: ${progress}%`}></span>
    </div>
    {#if deletableCount > 0}
      <div class="queue-actions">
        <button class="bulk-delete-button" type="button" onclick={onRequestDeleteAll}>
          <span class="bulk-delete-icon" aria-hidden="true"></span>
          <span class="bulk-delete-copy">
            <strong>Delete all from phone</strong>
            <small>Remove saved files from this device</small>
          </span>
          <span class="bulk-delete-count">{deletableCount}</span>
        </button>
      </div>
    {/if}

    {#if showQueue}
      <div class="upload-list">
        {#each items as item (item.localId)}
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
                    onclick={() => onCopyName(item)}
                  >
                    {item.name}
                  </button>
                  <div class="upload-meta">
                    <span class={`status-badge ${item.status}`}>{statusText(item)}</span>
                    <span>{formatFileSize(item.size)}</span>
                  </div>
                </div>
                {#if copiedLocalId === item.localId}
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
                  <button class="text-button" type="button" onclick={() => onCancel(item.localId)}>Cancel</button>
                {/if}
                {#if item.status === 'failed' || item.status === 'cancelled'}
                  <button class="text-button strong" type="button" onclick={() => onRetry(item.localId)}>Retry</button>
                {/if}
                {#if item.id && (item.status === 'complete' || item.status === 'duplicate')}
                  <a class="upload-action" href={detailUrlForUpload(item)} aria-label={`Open ${item.name}`} title="Open">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4 11 13M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" /></svg>
                  </a>
                {/if}
                {#if isDeletableFromPhone(item)}
                  <button class="upload-action danger" type="button" onclick={() => onDeleteFromPhone(item.localId)} aria-label={`Delete ${item.name} from phone`} title="Delete from phone">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
                  </button>
                {/if}
                <button class="upload-action" type="button" onclick={() => onRemove(item.localId)} aria-label={`Remove ${item.name} from queue`} title="Remove from queue">
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

<style>
  .upload-copy {
    color: var(--text-body);
    line-height: 1.38;
    font-size: 0.98rem;
  }

  .text-button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

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

  .upload-actions {
    display: grid;
    gap: 0.65rem;
  }

  .dock-label {
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  .type-strip,
  .mini-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .type-strip span,
  .mini-stats span {
    border-radius: 999px;
    padding: 0.42rem 0.68rem;
    background: rgba(255, 255, 255, 0.65);
    border: 1px solid var(--stroke-soft);
    font-size: 0.7rem;
    font-weight: 700;
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

  .upload-action svg {
    width: 1.05rem;
    height: 1.05rem;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  @media (min-width: 720px) {

    .upload-panel {
      padding: 1.2rem;
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
}
</style>
