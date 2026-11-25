<script lang="ts">
  import { parseTagInput } from "$lib/functions/tags.js";

  // A row of tag chips with a text box. Type a tag and press Enter (or a comma) to add it,
  // or click one of the bubbles below: your most used tags, narrowed by what you type.
  // The box keeps focus after each tag so you can keep going.
  let {
    tags = [],
    suggestions = [],
    onAdd,
    onRemove,
    disabled = false,
    placeholder = "Add tags…",
    compact = false,
    autofocus = false,
    quickCount = 12
  }: {
    tags?: string[];
    /** Tags in use, most used first. */
    suggestions?: string[];
    onAdd: (tags: string[]) => void;
    onRemove: (tag: string) => void;
    disabled?: boolean;
    placeholder?: string;
    compact?: boolean;
    autofocus?: boolean;
    /** How many bubbles to show; 0 hides them. */
    quickCount?: number;
  } = $props();

  let text = $state("");
  let error = $state("");
  let input: HTMLInputElement | undefined = $state();

  // Most used tags this item does not have yet. While typing, the ones that start with the
  // text come first, then the ones that contain it.
  const bubbles = $derived.by(() => {
    if (quickCount <= 0) return [];
    const typed = text.trim().toLowerCase();
    const available = suggestions.filter((tag) => !tags.includes(tag));
    if (!typed) return available.slice(0, quickCount);
    const starts = available.filter((tag) => tag.startsWith(typed));
    const contains = available.filter((tag) => !tag.startsWith(typed) && tag.includes(typed));
    return [...starts, ...contains].slice(0, quickCount);
  });

  $effect(() => {
    if (autofocus && input) input.focus();
  });

  function commit(): void {
    const { tags: parsed, rejected } = parseTagInput(text);
    const fresh = parsed.filter((tag) => !tags.includes(tag));
    error = rejected.length
      ? `Not added: ${rejected.join(", ")}. Use letters, digits, spaces, - or _ (max 32).`
      : "";
    if (fresh.length) onAdd(fresh);
    text = rejected.join(", ");
  }

  function addBubble(tag: string): void {
    onAdd([tag]);
    text = "";
    error = "";
    input?.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    // Arrow keys belong to the viewer when the box is empty.
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (text) event.stopPropagation();
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      commit();
    } else if (event.key === "Tab" && text.trim() && bubbles.length) {
      // Tab completes to the first bubble.
      event.preventDefault();
      addBubble(bubbles[0]);
    } else if (event.key === "Backspace" && !text && tags.length) {
      onRemove(tags[tags.length - 1]);
    }
  }
</script>

<div class="tag-editor" class:compact class:disabled>
  <div class="tag-line">
    {#each tags as tag (tag)}
      <span class="chip">
        {tag}
        <button
          type="button"
          class="chip-remove"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => { onRemove(tag); input?.focus(); }}
          {disabled}
          aria-label={`Remove tag ${tag}`}
        >×</button>
      </span>
    {/each}
    <input
      bind:this={input}
      bind:value={text}
      onkeydown={onKeydown}
      onblur={() => text.trim() && commit()}
      {placeholder}
      {disabled}
      maxlength="200"
      aria-label="Add tags"
    />
  </div>
  {#if bubbles.length && !disabled}
    <div class="bubbles" aria-label="Most used tags">
      {#each bubbles as tag (tag)}
        <button
          type="button"
          class="bubble"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => addBubble(tag)}
          title={`Add ${tag}`}
        >+ {tag}</button>
      {/each}
    </div>
  {/if}
  {#if error}
    <span class="tag-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .tag-editor {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .tag-line,
  .bubbles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.1rem 0.25rem 0.1rem 0.55rem;
    font-size: 0.8rem;
    color: #1e3a8a;
    background-color: #dbeafe;
    border: 1px solid #93c5fd;
    border-radius: 9999px;
    white-space: nowrap;
  }

  .chip-remove {
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    font-size: 0.9rem;
    line-height: 1;
    color: inherit;
    background: none;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
  }

  .chip-remove:hover:not(:disabled) {
    background-color: #bfdbfe;
  }

  .bubble {
    padding: 0.12rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 500;
    color: #334155;
    background-color: transparent;
    border: 1px dashed #94a3b8;
    border-radius: 9999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .bubble:hover {
    color: #1e3a8a;
    background-color: #dbeafe;
    border-style: solid;
    border-color: #93c5fd;
  }

  input {
    flex: 1 1 8rem;
    min-width: 6rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.85rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background-color: #fff;
    color: inherit;
  }

  .compact input {
    padding: 0.15rem 0.4rem;
    font-size: 0.8rem;
  }

  .compact .chip,
  .compact .bubble {
    font-size: 0.73rem;
  }

  .tag-error {
    font-size: 0.75rem;
    color: #b91c1c;
  }

  @media (prefers-color-scheme: dark) {
    .chip {
      color: #dbeafe;
      background-color: #1e3a8a;
      border-color: #3b82f6;
    }

    .chip-remove:hover:not(:disabled) {
      background-color: #1d4ed8;
    }

    .bubble {
      color: #cbd5e1;
      border-color: #64748b;
    }

    .bubble:hover {
      color: #dbeafe;
      background-color: #1e3a8a;
      border-color: #3b82f6;
    }

    input {
      background-color: #2a2a2a;
      border-color: #555;
      color: #eee;
    }

    .tag-error {
      color: #fca5a5;
    }
  }
</style>
