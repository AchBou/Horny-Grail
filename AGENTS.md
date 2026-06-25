# Agent Instructions

This repository contains the HornyGrail image app. Use this file as the first stop for agent context before changing code.

## Repository Layout

- `front/` is the public SvelteKit frontend for browsing images, viewing a single image, and loading a random image.
- `local/mobile-app/` is the private Capacitor + SvelteKit mobile client. It starts on a chooser-first home screen, then lets the user explicitly enter browse mode or upload mode.
- `local/desktop-app/` is the Tauri 2 desktop uploader app. It watches a local folder, hashes image files, checks backend metadata for duplicates, uploads originals and thumbnails through server-issued presigned URLs, and never talks to AWS directly.
- `serverless/horny-grail-app/` is the AWS SAM backend. It defines Lambda handlers, API Gateway HTTP routes, DynamoDB access, sample events, and Jest tests.
- `docs/` contains project planning notes and improvement tasks.
- `.junie/` contains IDE/assistant-facing development guidelines.

Legacy backend folders such as root `functions/`, old root `serverless/template.yaml`, and old local Node scripts were removed in favor of `serverless/horny-grail-app/`, `local/desktop-app/`, and `local/mobile-app/`.

## Common Commands

Run commands from the directory listed.

Frontend:

```bash
cd front
npm install
npm run dev
npm run build
npm run test
npm run lint
```

Desktop app:

```bash
cd local/desktop-app
npm install
npm run dev
npm run check
npm run tauri dev
npm run build
```

Mobile app:

```bash
cd local/mobile-app
npm install
npm run dev
npm run build
npm run check
npm run cap:sync
npm run cap:open:android
```

Serverless app:

```bash
cd serverless/horny-grail-app
npm install
npm run test
sam build
sam local start-api
sam deploy --guided
```

## Current Runtime Contracts

- DynamoDB items use `id` as the content hash. `id` is the only canonical identifier in current frontend and backend contracts.
- The SAM stack now owns the DynamoDB metadata table. The table uses `id` as the primary key and defines `RandomImageIndex` on `status` + `randomKey`.
- Original files are expected at CloudFront path `files/<hash>.<ext>`.
- Thumbnails are expected at CloudFront path `thumbnails/thumbnail-<hash>.jpeg`.
- The frontend requires `PUBLIC_API_BASE_URL` and `PUBLIC_CLOUDFRONT_BASE_URL` from public env.
- The serverless app requires `LOOKUP_TABLE`, `CLOUDFRONT_BASE_URL`, `BUCKET_NAME`, `BUCKET_REGION`, `WRITE_API_KEY`, and `CORS_ALLOWED_ORIGINS` from runtime env or SAM parameters.
- The mobile app requires private build-time config for `apiBaseUrl`, `cloudFrontBaseUrl`, and `writeApiKey` through `mobile.private.json`.
- The desktop uploader requires `VITE_API_BASE_URL` and `VITE_WRITE_API_KEY`.
- The desktop uploader fetches `src-tauri/binaries/ffmpeg.exe` on demand via `npm run ffmpeg:ensure` before Tauri dev/build. If the local binary cannot be resolved, the Rust command falls back to `ffmpeg` on `PATH`.
- The upload bucket is configured per environment through `BUCKET_NAME`/`BucketName` in `us-west-2`; browser uploads require S3 bucket CORS for `http://localhost:1420`.

## Environment And AWS Notes

Desktop app API config is centralized in `local/desktop-app/src/lib/config/apiEnv.js`.
Mobile app private config is generated into `local/mobile-app/src/lib/generated/privateConfig.js` from `local/mobile-app/mobile.private.json`.

Supported Vite env vars:

- `VITE_API_BASE_URL`
- `VITE_WRITE_API_KEY`

Frontend deployment is automated through `.github/workflows/front-deploy.yml`. It builds `front/`, syncs `front/build/` to the frontend S3 bucket, and invalidates the frontend CloudFront distribution using the GitHub OIDC role in `FRONTEND_DEPLOY_ROLE_ARN`.

Do not commit real AWS credentials, local `.env` files, generated SAM build folders, `node_modules`, or Tauri build output. If adding config examples, use placeholder values.

## Implementation Guidance

- Prefer existing SvelteKit and Svelte 5 patterns in each app. The desktop uploader uses Svelte runes such as `$state`.
- Keep frontend API response parsing compatible with both current object payloads and older string payloads where the code already does so.
- The frontend browse page now uses `GET /api/browse/random` with cursor-based infinite scroll. Preserve the cursor contract when iterating on browse.
- The mobile app home screen is chooser-first. Do not make browse or upload the implicit default on entry unless there is an explicit product decision to change that.
- The mobile app should load randomized browse content only after the user explicitly opens browse mode.
- The mobile app upload queue should stay explicit and understandable. Prefer clear per-file status and recovery actions over dense instructional copy.
- Keep desktop uploads hash-based. Duplicate detection depends on the uploaded DynamoDB `id` matching the SHA-256 content hash.
- New metadata writes should preserve `status` and `randomKey` so random-image and randomized-browse queries stay indexable.
- Use Tauri commands for large local-file work when available. `compute_sha256_streaming` exists for memory-safe hashing.
- Keep WebM thumbnail generation native when possible. `generate_video_thumbnail` uses the locally ensured ffmpeg binary and should remain the primary video path; browser/canvas generation is only a fallback.
- Be careful changing S3 object key formats. Frontend, desktop uploader, and serverless handlers all assume the current `files/` and `thumbnails/` layout.
- Keep SAM handlers compatible with HTTP API v2 events. Existing handlers read the method from either `event.httpMethod` or `event.requestContext.http.method`.
- Do not reintroduce deleted legacy backend scripts unless there is a specific migration reason.

## Verification Expectations

Choose checks based on the area changed:

- Frontend UI or routing: run `npm run build` in `front/`; run `npm run test` when behavior changes are testable.
- Mobile app UI or routing: run `npm run check` in `local/mobile-app/`; run `npm run cap:sync` when changing Capacitor-facing behavior or native plugin wiring.
- Desktop Svelte code: run `npm run check` in `local/desktop-app/`; run `npm run build` when dependencies or bundling change.
- Tauri Rust code: run `cargo check` in `local/desktop-app/src-tauri/`.
- Serverless handlers: run `npm run test` in `serverless/horny-grail-app/`; run `sam build` after template or dependency changes.

If dependencies are missing and installing them is outside the current task, report that verification was not run.

## Git And Change Hygiene

- Keep commits organized by subsystem: `front:`, `mobile-app:`, `desktop-app:`, `serverless:`, or `docs:`.
- Do not mix unrelated frontend, mobile, desktop, backend, and documentation changes in the same commit.
- Check `git status --short --untracked-files=all` before finishing.
- Preserve user changes in a dirty worktree. Do not revert unrelated files unless explicitly asked.
