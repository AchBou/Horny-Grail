<script>
    import { createEventDispatcher } from 'svelte';
    import { fly } from 'svelte/transition';

    const dispatch = createEventDispatcher();
    export let to = '';
    export let text;
    export let primary = true;
    export let size = 'medium'; // small, medium, large
</script>

{#if to}
    <a
        class="btn-container {primary ? 'primary' : 'secondary'} {size}"
        href="/{to}"
        in:fly={{ y: 20, duration: 300 }}
    >
        <span class="btn-text">{text}</span>
    </a>
{:else}
    <button
        class="btn-container {primary ? 'primary' : 'secondary'} {size}"
        type="button"
        on:click={(event) => {
            dispatch('click', event);
        }}
        in:fly={{ y: 20, duration: 300 }}
    >
        <span class="btn-text">{text}</span>
    </button>
{/if}

<style>
    .btn-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        margin: 10px;
        border-radius: 8px;
        cursor: pointer;
        text-align: center;
        font-weight: 600;
        font-family: 'Montserrat', sans-serif;
        color: white;
        transition: all 0.3s ease;
        box-shadow: 0 3px 10px rgba(0,0,0,0.15);
        position: relative;
        overflow: hidden;
        border: none;
        text-decoration: none;
    }

    .btn-container::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(255,255,255,0.1);
        opacity: 0;
        transition: opacity 0.3s;
    }

    .btn-container:hover::after {
        opacity: 1;
    }

    .btn-container:active {
        transform: translateY(2px);
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }

    .primary {
        background-color: #e74c3c;
    }

    .secondary {
        background-color: #7f8c8d;
    }

    .small {
        width: 100px;
        height: 32px;
        font-size: 14px;
        letter-spacing: 0.5px;
    }

    .medium {
        width: 150px;
        height: 42px;
        font-size: 16px;
        letter-spacing: 0.8px;
    }

    .large {
        width: 200px;
        height: 52px;
        font-size: 18px;
        letter-spacing: 1px;
        font-weight: 700;
    }

    .btn-container:focus-visible {
        outline: 3px solid rgba(255, 255, 255, 0.8);
        outline-offset: 3px;
    }

    .btn-text {
        display: inline-block;
        padding: 0 10px;
        text-transform: uppercase;
        font-weight: 600;
    }

</style>
