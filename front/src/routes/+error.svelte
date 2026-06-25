<script>
    export let error;
    export let status;

    const isMissingRoute = status === 404;
    const title = isMissingRoute ? 'Page not found' : 'Something went wrong';
    const message = isMissingRoute
        ? 'This route does not exist, or the link is outdated.'
        : (error?.message || 'The app hit an unexpected error while loading this page.');
</script>

<svelte:head>
    <title>{title} | The Horny Grail</title>
</svelte:head>

<div class="error-page">
    <div class="error-card">
        <p class="status">{status}</p>
        <h2>{title}</h2>
        <p class="message">{message}</p>

        <div class="actions">
            <a href="/">Back Home</a>
            <a href="/browse">Browse</a>
            <a href="/random">Random</a>
        </div>
    </div>
</div>

<style>
    .error-page {
        min-height: calc(100vh - 220px);
        display: grid;
        place-items: center;
        padding: 32px 0;
    }

    .error-card {
        width: min(680px, 100%);
        background: linear-gradient(180deg, #ffffff 0%, #f8f2ef 100%);
        border-radius: 16px;
        padding: 40px 28px;
        box-shadow: 0 18px 40px rgba(44, 62, 80, 0.12);
        text-align: center;
        border: 1px solid rgba(231, 76, 60, 0.12);
    }

    .status {
        margin: 0 0 10px;
        color: #e74c3c;
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: 0.24em;
        text-transform: uppercase;
    }

    h2 {
        margin: 0 0 14px;
        color: #2c3e50;
        font-size: clamp(2rem, 4vw, 3rem);
    }

    .message {
        margin: 0 auto;
        max-width: 34rem;
        color: #55606d;
        font-size: 1.08rem;
    }

    .actions {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 26px;
    }

    .actions a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 140px;
        padding: 12px 18px;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 600;
        transition: transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
    }

    .actions a:first-child {
        background-color: #e74c3c;
        color: white;
        box-shadow: 0 10px 20px rgba(231, 76, 60, 0.18);
    }

    .actions a:not(:first-child) {
        background-color: white;
        color: #2c3e50;
        border: 1px solid rgba(44, 62, 80, 0.16);
    }

    .actions a:hover {
        transform: translateY(-1px);
    }

    @media (max-width: 640px) {
        .error-card {
            padding: 32px 20px;
        }

        .actions a {
            width: 100%;
        }
    }
</style>
