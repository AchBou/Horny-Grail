# HornyGrail Backend

AWS SAM backend for HornyGrail metadata, randomized browse, asset integrity checks, and presigned uploads.

## Current Responsibilities

- Store image and video metadata in DynamoDB using SHA-256 `id` as the primary key
- Maintain `status` and `randomKey` fields for random discovery
- Serve public read endpoints for item lookup, random item lookup, and randomized browse
- Validate upload requests and issue presigned S3 URLs for originals and thumbnails
- Check whether metadata, originals, and thumbnails exist for repair flows

## Project Layout

- `src/handlers/`: Lambda handlers grouped by feature
- `src/lib/`: shared validation, auth, and HTTP helpers
- `__tests__/`: Jest unit tests
- `events/`: sample local invocation payloads
- `template.yaml`: SAM stack definition
- `env.example.json`: local SAM environment example

## API Surface

Public read endpoints:

- `GET /api`
- `GET /api/`
- `GET /api/{id}`
- `GET /api/get-random-image`
- `GET /api/browse/random`
- `GET /api/thumbnails`
- `GET /api/assets/{id}/integrity`

Write endpoints:

- `POST /api`
- `POST /api/uploads/sign`

Write endpoints require:

```http
x-api-key: <write-api-key>
```

Current data contracts:

- canonical identifier: `id`
- original object key: `files/<hash>.<ext>`
- thumbnail object key: `thumbnails/thumbnail-<hash>.jpeg`
- random browse index: `RandomImageIndex` on `status` + `randomKey`

## Configuration

Use `env.example.json` as the starting point for local SAM environment values.

Required runtime env:

- `LOOKUP_TABLE`
- `CLOUDFRONT_BASE_URL`
- `BUCKET_NAME`
- `BUCKET_REGION`
- `WRITE_API_KEY`
- `CORS_ALLOWED_ORIGINS`

Matching SAM parameters:

- `LookupTableName`
- `CloudFrontBaseUrl`
- `BucketName`
- `BucketRegion`
- `WriteApiKey`
- `AllowedCorsOrigins`

Notes:

- The stack owns the DynamoDB metadata table.
- The table uses `id` as the primary key.
- `RandomImageIndex` is required for `GET /api/get-random-image` and `GET /api/browse/random`.
- If a table with the target name already exists outside CloudFormation, import it or deploy with a new name.

## Local Development

Install dependencies and run tests:

```bash
npm install
npm run test
```

Build or run the local API:

```bash
sam build
sam local start-api
```

Convenience scripts:

```bash
npm run sam:dev
npm run sam:deploy
```

The local API uses the handler environment mappings in `env.json` or another SAM env file you provide.

## Deployment

First deploy:

```bash
sam build
sam deploy --guided
```

Subsequent deploys:

```bash
npm run sam:deploy
```

The template outputs the deployed API base URL. Clients should use that URL with the `/api` suffix.

## Storage and Upload Rules

The backend does not accept raw media bytes directly. Desktop and mobile clients must:

1. Compute SHA-256 and use it as `id`
2. Call `POST /api/uploads/sign`
3. Upload bytes to the returned S3 presigned URL
4. Register metadata through `POST /api`

Validation for `POST /api/uploads/sign` includes:

- valid `path`
- valid 64-character hex `id`
- supported extension
- exact MIME type match
- maximum byte length

The shared upload contract lives in `../../docs/upload-contract.md`.

## Random Browse and Random Item Behavior

`GET /api/get-random-image` and `GET /api/browse/random` both depend on items having:

- `status: "active"`
- a numeric `randomKey`

`POST /api` currently sets both fields on new metadata writes. If existing data is imported into the table later, it must be backfilled with those fields before relying on random discovery.

## Verification

Run these checks when changing backend code or infrastructure:

- `npm run test`
- `sam build`

For template changes that affect IAM, S3 permissions, or API routes, also verify the generated CloudFormation changeset before deployment.
