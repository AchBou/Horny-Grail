# Agent Instructions

This repository contains the HornyGrail image app. Use this file as the first stop for agent context before changing code.

## Repository Layout

- `front/` is the public SvelteKit frontend for browsing images, viewing a single image, and loading a random image.
- `local/desktop-app/` is the Tauri 2 desktop uploader app. It watches a local folder, hashes image files, checks DynamoDB for duplicates, uploads originals to S3, and uploads thumbnails.
- `serverless/horny-grail-app/` is the AWS SAM backend. It defines Lambda handlers, API Gateway HTTP routes, DynamoDB access, sample events, and Jest tests.
- `docs/` contains project planning notes and improvement tasks.
- `.junie/` contains IDE/assistant-facing development guidelines.

Legacy backend folders such as root `functions/`, old root `serverless/template.yaml`, and old local Node scripts were removed in favor of `serverless/horny-grail-app/` and `local/desktop-app/`.

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

- DynamoDB items use `id` as the content hash. Some frontend normalization still accepts `hex` for backward compatibility.
- Original files are expected at CloudFront path `files/<hash>.<ext>`.
- Thumbnails are expected at CloudFront path `thumbnails/thumbnail-<hash>.jpeg`.
- The frontend currently calls the deployed API base `https://9k82wh6773.execute-api.us-east-1.amazonaws.com/api`.
- The current CloudFront base used in the frontend is `https://dqvs0hmo3wpp7.cloudfront.net`.
- The desktop uploader defaults to bucket `horny-grail-bucket` and table `horny-grail-table` unless Vite env vars override them.

## Environment And AWS Notes

Desktop app AWS config is centralized in `local/desktop-app/src/lib/config/awsEnv.js`.

Supported Vite env vars:

- `VITE_AWS_REGION`
- `VITE_AWS_ACCESS_KEY_ID`
- `VITE_AWS_SECRET_ACCESS_KEY`
- `VITE_AWS_SESSION_TOKEN`
- `VITE_BUCKET_NAME`
- `VITE_DYNAMO_TABLE`

Do not commit real AWS credentials, local `.env` files, generated SAM build folders, `node_modules`, or Tauri build output. If adding config examples, use placeholder values.

## Implementation Guidance

- Prefer existing SvelteKit and Svelte 5 patterns in each app. The desktop uploader uses Svelte runes such as `$state`.
- Keep frontend API response parsing compatible with both current object payloads and older string payloads where the code already does so.
- Keep desktop uploads hash-based. Duplicate detection depends on the uploaded DynamoDB `id` matching the SHA-256 content hash.
- Use Tauri commands for large local-file work when available. `compute_sha256_streaming` exists for memory-safe hashing.
- Be careful changing S3 object key formats. Frontend, desktop uploader, and serverless handlers all assume the current `files/` and `thumbnails/` layout.
- Keep SAM handlers compatible with HTTP API v2 events. Existing handlers read the method from either `event.httpMethod` or `event.requestContext.http.method`.
- Do not reintroduce deleted legacy backend scripts unless there is a specific migration reason.

## Verification Expectations

Choose checks based on the area changed:

- Frontend UI or routing: run `npm run build` in `front/`; run `npm run test` when behavior changes are testable.
- Desktop Svelte code: run `npm run check` in `local/desktop-app/`; run `npm run build` when dependencies or bundling change.
- Tauri Rust code: run `cargo check` in `local/desktop-app/src-tauri/`.
- Serverless handlers: run `npm run test` in `serverless/horny-grail-app/`; run `sam build` after template or dependency changes.

If dependencies are missing and installing them is outside the current task, report that verification was not run.

## Git And Change Hygiene

- Keep commits organized by subsystem: `front:`, `desktop-app:`, `serverless:`, or `docs:`.
- Do not mix unrelated frontend, desktop, backend, and documentation changes in the same commit.
- Check `git status --short --untracked-files=all` before finishing.
- Preserve user changes in a dirty worktree. Do not revert unrelated files unless explicitly asked.
