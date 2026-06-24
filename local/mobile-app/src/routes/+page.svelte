<script>
  import {
    apiBaseUrl,
    buildApiUrl,
    cloudFrontBaseUrl
  } from '$lib/config/privateConfig.js';

  const nextSteps = [
    'Add Capacitor Android platform files and open the project in Android Studio.',
    'Implement native file picking and SHA-256 hashing for local files.',
    'Add the GET /assets/{id}/integrity duplicate-check step.',
    'Bridge native ffmpeg-backed WebM thumbnail generation into the web layer.',
    'Implement presigned upload and metadata registration flow.'
  ];

  const capabilities = [
    'Random browse and single-item viewing through the existing API.',
    'Private build-time config for API, CloudFront, and write key values.',
    'Static SvelteKit build output compatible with Capacitor web assets.',
    'A native-first direction for WebM thumbnail generation.'
  ];
</script>

<svelte:head>
  <title>HornyGrail Mobile</title>
  <meta
    name="description"
    content="Private HornyGrail mobile client scaffold built with Capacitor and SvelteKit."
  />
</svelte:head>

<div class="page">
  <div class="backdrop backdrop-a"></div>
  <div class="backdrop backdrop-b"></div>

  <main class="shell">
    <section class="hero">
      <p class="eyebrow">Private Mobile Client</p>
      <h1>Capacitor + SvelteKit is the chosen stack.</h1>
      <p class="lede">
        This scaffold keeps the existing JavaScript client logic reusable while leaving
        WebM thumbnail generation in the native layer, where it belongs.
      </p>
    </section>

    <section class="panel">
      <h2>Build Config</h2>
      <dl class="kv">
        <div>
          <dt>API Base URL</dt>
          <dd>{apiBaseUrl}</dd>
        </div>
        <div>
          <dt>CloudFront Base URL</dt>
          <dd>{cloudFrontBaseUrl}</dd>
        </div>
        <div>
          <dt>Random Browse Endpoint</dt>
          <dd>{buildApiUrl('/browse/random')}</dd>
        </div>
      </dl>
    </section>

    <section class="grid">
      <article class="panel">
        <h2>Scaffold Covers</h2>
        <ul>
          {#each capabilities as capability}
            <li>{capability}</li>
          {/each}
        </ul>
      </article>

      <article class="panel">
        <h2>Immediate Next Steps</h2>
        <ol>
          {#each nextSteps as step}
            <li>{step}</li>
          {/each}
        </ol>
      </article>
    </section>
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(255, 133, 76, 0.22), transparent 30%),
      radial-gradient(circle at bottom right, rgba(0, 171, 169, 0.22), transparent 24%),
      linear-gradient(160deg, #140f1b 0%, #23182a 46%, #100f16 100%);
    color: #f7efe9;
    font-family: "Segoe UI", system-ui, sans-serif;
  }

  .page {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
  }

  .backdrop {
    position: absolute;
    border-radius: 999px;
    filter: blur(48px);
    opacity: 0.8;
  }

  .backdrop-a {
    top: -4rem;
    right: -3rem;
    width: 15rem;
    height: 15rem;
    background: rgba(255, 111, 0, 0.3);
  }

  .backdrop-b {
    bottom: -5rem;
    left: -5rem;
    width: 18rem;
    height: 18rem;
    background: rgba(0, 201, 167, 0.24);
  }

  .shell {
    position: relative;
    z-index: 1;
    max-width: 64rem;
    margin: 0 auto;
    padding: 3rem 1.25rem 4rem;
  }

  .hero {
    margin-bottom: 1.5rem;
  }

  .eyebrow {
    margin: 0 0 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.72rem;
    color: #f8b36e;
  }

  h1,
  h2 {
    margin: 0;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  h1 {
    max-width: 12ch;
    font-size: clamp(2.4rem, 8vw, 4.6rem);
    line-height: 0.95;
  }

  h2 {
    font-size: 1.1rem;
    margin-bottom: 1rem;
  }

  .lede {
    max-width: 42rem;
    margin: 1rem 0 0;
    color: #ddcfc2;
    line-height: 1.55;
    font-size: 1rem;
  }

  .panel {
    background: rgba(20, 17, 25, 0.68);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1.3rem;
    padding: 1.25rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(16px);
  }

  .grid {
    display: grid;
    gap: 1rem;
    margin-top: 1rem;
  }

  .kv {
    display: grid;
    gap: 0.9rem;
    margin: 0;
  }

  .kv div {
    display: grid;
    gap: 0.35rem;
  }

  dt {
    color: #f8b36e;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  dd {
    margin: 0;
    word-break: break-word;
    color: #f8efe7;
  }

  ul,
  ol {
    margin: 0;
    padding-left: 1.2rem;
    color: #e4d8cc;
    line-height: 1.6;
  }

  li + li {
    margin-top: 0.45rem;
  }

  @media (min-width: 780px) {
    .shell {
      padding-top: 4rem;
    }

    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .panel {
      padding: 1.5rem;
    }
  }
</style>
