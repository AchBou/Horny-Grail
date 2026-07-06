<script>
  import { createEventDispatcher } from 'svelte';

  export let code = '';
  export let busy = false;
  export let error = '';
  export let title = 'Unlock HornyGrail';
  export let copy = 'Enter the access code to browse your private collection.';
  export let submitLabel = 'Continue';

  const dispatch = createEventDispatcher();

  function submit() {
    dispatch('submit');
  }
</script>

<section class="gate-shell">
  <div class="gate-card">
    <p class="eyebrow">Private Access</p>
    <h1>{title}</h1>
    <p class="copy">{copy}</p>

    <form class="gate-form" on:submit|preventDefault={submit}>
      <label class="field">
        <span>Access code</span>
        <input
          bind:value={code}
          autocomplete="one-time-code"
          inputmode="text"
          autocapitalize="none"
          spellcheck="false"
          placeholder="Enter code"
          disabled={busy}
        />
      </label>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button class="submit" type="submit" disabled={busy || code.trim().length === 0}>
        {busy ? 'Checking...' : submitLabel}
      </button>
    </form>
  </div>
</section>

<style>
  :global(:root) {
    --gate-bg: #f3eee6;
    --gate-surface: rgba(255, 255, 255, 0.72);
    --gate-stroke: rgba(40, 29, 22, 0.08);
    --gate-text: #221813;
    --gate-body: #6b5d51;
    --gate-accent: #17110d;
    --gate-accent-soft: #1d7a6d;
    --gate-error: #b64834;
    --gate-ui: 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    --gate-display: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
  }

  .gate-shell {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background:
      radial-gradient(circle at 14% 0%, rgba(213, 102, 42, 0.12), transparent 28%),
      radial-gradient(circle at 90% 10%, rgba(29, 122, 109, 0.12), transparent 24%),
      linear-gradient(180deg, #f7f2ea 0%, #f3eee6 42%, #efe8de 100%);
  }

  .gate-card {
    width: min(26rem, 100%);
    display: grid;
    gap: 0.9rem;
    padding: 1.2rem;
    border: 1px solid var(--gate-stroke);
    border-radius: 1.4rem;
    background: var(--gate-surface);
    box-shadow: 0 16px 36px rgba(40, 29, 22, 0.08);
    backdrop-filter: blur(16px);
    color: var(--gate-text);
    font-family: var(--gate-ui);
  }

  .eyebrow {
    margin: 0;
    color: #9a5d3a;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: clamp(1.8rem, 7vw, 2.5rem);
    line-height: 0.96;
    letter-spacing: -0.06em;
    font-family: var(--gate-display);
  }

  .copy {
    margin: 0;
    color: var(--gate-body);
    line-height: 1.42;
  }

  .gate-form {
    display: grid;
    gap: 0.85rem;
  }

  .field {
    display: grid;
    gap: 0.45rem;
    font-size: 0.88rem;
    font-weight: 700;
  }

  .field span {
    color: #4b3e35;
  }

  .field input {
    width: 100%;
    min-height: 3rem;
    border: 1px solid rgba(40, 29, 22, 0.12);
    border-radius: 1rem;
    padding: 0.85rem 0.95rem;
    background: rgba(255, 255, 255, 0.82);
    color: var(--gate-text);
    font: inherit;
  }

  .field input:focus-visible {
    outline: 2px solid rgba(29, 122, 109, 0.8);
    outline-offset: 2px;
  }

  .error {
    margin: 0;
    color: var(--gate-error);
    font-size: 0.84rem;
    line-height: 1.35;
  }

  .submit {
    min-height: 3rem;
    border: 0;
    border-radius: 999px;
    padding: 0.85rem 1rem;
    background: var(--gate-accent);
    color: #fffaf5;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .submit:disabled {
    cursor: default;
    opacity: 0.68;
  }
 </style>
