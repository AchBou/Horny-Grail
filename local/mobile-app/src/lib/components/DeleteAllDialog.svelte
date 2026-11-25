<script>
  /** @type {{ count: number, onCancel: () => void, onConfirm: () => void }} */
  let { count, onCancel, onConfirm } = $props();
</script>

<div class="dialog-backdrop" role="presentation" onclick={(event) => event.currentTarget === event.target && onCancel()}>
  <dialog open class="confirm-dialog" aria-labelledby="delete-all-title" aria-describedby="delete-all-copy">
    <div class="dialog-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
    </div>
    <p class="eyebrow">Phone storage</p>
    <h2 id="delete-all-title">Delete {count} files?</h2>
    <p id="delete-all-copy">These uploaded files will be removed from your phone. Your saved copies in the Grail will remain.</p>
    <div class="dialog-actions">
      <button class="secondary-button" type="button" onclick={onCancel}>Cancel</button>
      <button class="danger-button" type="button" onclick={onConfirm}>Delete files</button>
    </div>
  </dialog>
</div>

<style>
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
</style>
