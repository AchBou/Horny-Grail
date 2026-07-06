# HornyGrail

HornyGrail is a hash-based media library with three clients and one shared backend:

- `front/`: public SvelteKit frontend for browsing, random discovery, and single-item viewing
- `local/mobile-app/`: private Capacitor + SvelteKit mobile client for browse plus upload
- `local/desktop-app/`: private Tauri desktop uploader for folder watching, duplicate detection, repair, and thumbnail generation
- `serverless/horny-grail-app/`: AWS SAM backend for metadata, random browse, asset integrity, and presigned uploads

## Current State

The current implementation is centered on SHA-256 content hashes:

- DynamoDB metadata uses `id` as the canonical identifier.
- Original media lives at `files/<hash>.<ext>`.
- JPEG thumbnails live at `thumbnails/thumbnail-<hash>.jpeg`.
- Random discovery is backed by a DynamoDB `RandomImageIndex` on `status` and `randomKey`.
- Upload clients never use AWS credentials directly; they request backend-issued presigned S3 URLs.

Implemented user-facing flows:

- Public frontend browse at `/browse` with cursor-based randomized infinite scroll
- Public frontend random item view at `/random`
- Public frontend single-item detail at `/image/[id]`
- Mobile chooser-first home screen with explicit browse and upload modes
- Mobile duplicate-aware upload queue with retry, cancel, and repair behavior
- Desktop folder watch flow with duplicate detection, repair, and manual thumbnail regeneration
- Backend asset integrity endpoint for checking metadata, original, and thumbnail presence

## Repository Layout

```text
front/
local/mobile-app/
local/desktop-app/
serverless/horny-grail-app/
docs/
```

Legacy backend folders and older local scripts have been removed in favor of the current `serverless/horny-grail-app/`, `local/mobile-app/`, and `local/desktop-app/` structure.

## Quick Start

Frontend:

```bash
cd front
npm install
npm run dev
```

Desktop uploader:

```bash
cd local/desktop-app
npm install
npm run ffmpeg:ensure
npm run dev
npm run tauri -- dev
```

Mobile app:

```bash
cd local/mobile-app
npm install
npm run dev
npm run cap:sync
```

Backend:

```bash
cd serverless/horny-grail-app
npm install
npm run test
sam build
sam local start-api
```

## Runtime Configuration

Frontend public env, optional same-origin overrides:

- `PUBLIC_API_BASE_URL`
- `PUBLIC_CLOUDFRONT_BASE_URL`

Desktop app env:

- `VITE_API_BASE_URL`
- `VITE_WRITE_API_KEY`

Mobile private config:

- `apiBaseUrl`
- `cloudFrontBaseUrl`
- `writeApiKey`

Backend runtime env or SAM parameters:

- `LOOKUP_TABLE`
- `CLOUDFRONT_BASE_URL`
- `BUCKET_NAME`
- `BUCKET_REGION`
- `WRITE_API_KEY`
- `CORS_ALLOWED_ORIGINS`

## Verification

Use checks that match the area changed:

- `front/`: `npm run build`, `npm run test`
- `local/mobile-app/`: `npm run check`, `npm run cap:sync`
- `local/desktop-app/`: `npm run check`, `npm run build`, `npm run tauri -- build`
- `local/desktop-app/src-tauri/`: `cargo check`
- `serverless/horny-grail-app/`: `npm run test`, `sam build`

## Documentation Map

- [AGENTS.md](AGENTS.md): repository instructions for coding agents
- [front/README.md](front/README.md): public frontend behavior and deployment
- [local/mobile-app/README.md](local/mobile-app/README.md): private mobile client behavior and setup
- [local/desktop-app/README.md](local/desktop-app/README.md): desktop uploader behavior and setup
- [serverless/horny-grail-app/README.md](serverless/horny-grail-app/README.md): backend routes, config, and deployment
- [docs/upload-contract.md](docs/upload-contract.md): shared upload rules for desktop and mobile
- [docs/mobile-api-reference.md](docs/mobile-api-reference.md): mobile-facing API reference
- [docs/security.md](docs/security.md): current security and S3 notes
- [docs/tasks.md](docs/tasks.md): current status and remaining backlog
