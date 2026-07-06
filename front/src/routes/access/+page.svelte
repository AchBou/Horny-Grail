<script>
    import { onMount } from 'svelte';

    let next = '/';
    let hasError = false;

    onMount(() => {
        const params = new URLSearchParams(window.location.search);
        const explicitNext = params.get('next');
        const currentPath = window.location.pathname + window.location.search;

        if (explicitNext && explicitNext.startsWith('/') && !explicitNext.startsWith('//')) {
            next = explicitNext;
        } else if (window.location.pathname !== '/access') {
            next = currentPath;
        }

        hasError = params.has('error');
    });
</script>

<svelte:head>
    <title>Access | The Horny Grail</title>
</svelte:head>

<main class="access-shell">
    <section class="access-card">
        <h1>The Horny Grail</h1>
        <p>Enter the access code to continue.</p>

        <form method="post" action="/auth/session" class="access-form">
            <input type="hidden" name="next" value={next} />

            <label for="code">Access code</label>
            <input
                id="code"
                name="code"
                type="password"
                autocomplete="current-password"
                required
            />

            {#if hasError}
                <p class="error">That code did not work.</p>
            {/if}

            <button type="submit">Enter</button>
        </form>
    </section>
</main>

<style>
    :global(body) {
        background:
            linear-gradient(135deg, rgba(231, 76, 60, 0.12), rgba(44, 62, 80, 0.08)),
            #f6f3ee;
    }

    .access-shell {
        min-height: calc(100vh - 160px);
        display: grid;
        place-items: center;
        padding: 24px 0;
    }

    .access-card {
        box-sizing: border-box;
        width: min(420px, 100%);
        padding: 24px;
        border: 1px solid rgba(31, 43, 55, 0.14);
        border-radius: 8px;
        background: #fffdf9;
        box-shadow: 0 18px 50px rgba(31, 43, 55, 0.16);
    }

    h1 {
        margin: 0 0 8px;
        color: #e74c3c;
        font-size: clamp(2rem, 8vw, 3.2rem);
        font-weight: 800;
        letter-spacing: 0;
        line-height: 1;
        text-transform: uppercase;
    }

    p {
        margin: 0 0 24px;
        color: #5b6570;
        line-height: 1.5;
    }

    .access-form {
        display: grid;
        gap: 12px;
    }

    label {
        color: #1f2b37;
        font-weight: 700;
    }

    input {
        box-sizing: border-box;
        width: 100%;
        min-height: 48px;
        padding: 12px 14px;
        border: 1px solid rgba(31, 43, 55, 0.14);
        border-radius: 6px;
        background: #ffffff;
        color: #1f2b37;
        font: inherit;
    }

    input:focus {
        outline: 3px solid rgba(231, 76, 60, 0.2);
        border-color: #e74c3c;
    }

    button {
        min-height: 48px;
        border: 0;
        border-radius: 6px;
        background: #e74c3c;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        text-transform: uppercase;
    }

    button:hover {
        background: #c63e31;
    }

    .error {
        margin: 0;
        color: #a52a20;
        font-weight: 700;
    }
</style>
