# HornyGrail Backend

AWS SAM backend for HornyGrail metadata, randomized browse, asset integrity checks, and presigned uploads.

## Current Responsibilities

- Store image and video metadata in DynamoDB using SHA-256 `id` as the primary key
- Maintain `status` and `randomKey` fields for random discovery
- Serve protected read endpoints for item lookup, random item lookup, randomized browse, and mobile read sessions
- Validate upload requests and issue presigned S3 URLs for originals and thumbnails
- Check whether metadata, originals, and thumbnails exist for repair flows
- Expose a unified CloudFront entrypoint for the static frontend, `/api/*`, `/files/*`, and `/thumbnails/*`
- Redirect-gate frontend routes with a CloudFront Function and enforce signed cookies on API and media routes
- Issue CloudFront signed cookies after a shared access code is submitted to `/auth/session`

## Project Layout

- `src/handlers/`: Lambda handlers grouped by feature
- `src/lib/`: shared validation, auth, and HTTP helpers
- `__tests__/`: Jest unit tests
- `events/`: sample local invocation payloads
- `template.yaml`: SAM stack definition
- `env.example.json`: local SAM environment example

## API Surface

Web read endpoints:

- `GET /api`
- `GET /api/`
- `GET /api/{id}`
- `GET /api/get-random-image`
- `GET /api/browse/random`
- `GET /api/thumbnails`

Mobile read endpoints:

- `POST /auth/mobile/session`
- `GET /api/mobile/{id}`
- `GET /api/mobile/browse/random`

Access endpoint:

- `POST /auth/session`

Write and repair endpoints:

- `GET /api/assets/{id}/integrity`
- `POST /api`
- `POST /api/uploads/sign`

Write endpoints accept either the desktop uploader's key or a mobile session token:

```http
x-api-key: <write-api-key>
Authorization: Bearer <token from POST /auth/mobile/session>
```

`DELETE /api/assets/{id}` accepts only the write key.

For originals, `POST /api/uploads/sign` returns an `x-amz-checksum-sha256` header (the id's SHA-256 in base64). Send every returned header with the S3 `PUT`; S3 rejects the upload if the body does not hash to the id.

Current data contracts:

- canonical identifier: `id`
- original object key: `files/<hash>.<ext>`
- thumbnail object key: `thumbnails/thumbnail-<hash>.jpeg`
- random browse index: `RandomImageIndex` on `status` + `randomKey`

## Configuration

Use `env.example.json` as the starting point for local SAM environment values.

Required runtime env:

- `LOOKUP_TABLE`
- `BUCKET_NAME`
- `BUCKET_REGION`
- `CORS_ALLOWED_ORIGINS`
- `APP_SECRETS_SECRET_ARN` (deployed). Without it, local runs and tests read `WRITE_API_KEY`, `READ_ORIGIN_SECRET`, `MOBILE_READ_TOKEN_SECRET` and `READ_ACCESS_CODE(_HASH)` from env instead.

Matching SAM parameters:

- `LookupTableName`
- `FrontendBucketName`
- `BucketName`
- `BucketRegion`
- `AppSecretsSecretArn`
- `MobileReadTokenTtlSeconds`
- `MobileSignedUrlTtlSeconds`
- `CloudFrontPublicKeyParameterName`
- `CloudFrontPrivateKeySecretArn`
- `AccessCookieTtlSeconds`
- `CloudFrontCookieResource`
- `AllowedCorsOrigins`
- `LoginGlobalFailuresPerHour` (default `20`)
- `BudgetAlertEmail` (optional; empty skips the budget)
- `MonthlyBudgetUsd` (default `5`)

Notes:

- The stack owns the DynamoDB metadata table.
- The table uses `id` as the primary key.
- `RandomImageIndex` is required for `GET /api/get-random-image` and `GET /api/browse/random`.
- If a table with the target name already exists outside CloudFormation, import it or deploy with a new name.
- `FrontendBucketName` is the private S3 bucket that stores the built frontend assets. S3 website hosting is not required.
- `BucketName` is now both the upload target and the protected media origin behind CloudFront OAC.
- `AppSecretsSecretArn` points to a Secrets Manager JSON secret with these fields:
  - `writeApiKey`
  - `readAccessCodeHash` (set with `npm run set-access-code`)
  - `readAccessCode` (legacy plaintext; only used while `readAccessCodeHash` is unset)
  - `readOriginSecret`
  - `mobileReadTokenSecret`
- Lambdas read every field of this secret at runtime (cached 1 minute), so values never appear in the Lambda console and changing one needs no deploy: it is live within a minute.
- `readAccessCodeHash` is an scrypt hash of the passphrase users enter on the web access page and the mobile unlock screen.
- `writeApiKey` rotation: put a new value in the secret and update the desktop uploader's `VITE_WRITE_API_KEY`. Nothing else to change.
- `readOriginSecret` is injected by CloudFront into the raw API origin so the web read routes cannot be called directly on the `execute-api` hostname. CloudFront's copy is resolved at deploy time, so rotating this one field also needs a deploy that changes the distribution; until then web reads fail.
- `mobileReadTokenSecret` signs the short-lived bearer tokens returned by `POST /auth/mobile/session`.
- `MobileReadTokenTtlSeconds` defaults to `3600` seconds, which keeps a successful mobile session for 1 hour. Sessions are kept short on purpose: this is a private vault, so the limit bounds what an unattended device exposes.
- `MobileSignedUrlTtlSeconds` defaults to `900` seconds, which keeps mobile media URLs valid for 15 minutes before the app refreshes them with another authenticated read request.
- `CloudFrontPublicKeyParameterName` points to an SSM parameter containing the PEM public key CloudFront uses to verify signed cookies.
- `CloudFrontPrivateKeySecretArn` points to a Secrets Manager secret containing the matching PEM private key.
- `AccessCookieTtlSeconds` defaults to `3600` seconds, which keeps a successful web session for 1 hour.
- `BudgetAlertEmail` creates an AWS Budget that emails when actual spend passes 80% of `MonthlyBudgetUsd`, or forecast spend passes 100%.
- `CloudFrontCookieResource` defaults to `https://*/*` to avoid deployment ordering problems. After deployment, you can restrict it to the protected distribution domain and redeploy.

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

For Lambda handler-only changes, use the faster code sync path instead of rebuilding and deploying the whole CloudFormation stack:

```bash
npm run sam:sync
```

`sam:sync` updates deployed Lambda code without applying template changes and puts shared dependencies in a layer to reduce repeated uploads. Use the full `sam:deploy` command after changing `template.yaml`, SAM parameters, IAM policies, API routes, environment variables, or CloudFront resources. The stack must already exist before `sam:sync` can be used.

The template outputs the deployed API base URL. Clients should use that URL with the `/api` suffix.

For the static public frontend, prefer these outputs from the protected CloudFront distribution:

- `ProtectedReadBaseUrl`
- `ProtectedReadApiBaseUrl`
- `ProtectedReadMediaBaseUrl`
- `ProtectedReadDistributionId`

Point:

- `front/PUBLIC_API_BASE_URL` to `ProtectedReadApiBaseUrl`
- `front/PUBLIC_CLOUDFRONT_BASE_URL` to `ProtectedReadMediaBaseUrl`
- the frontend deploy invalidation target to `ProtectedReadDistributionId`

Users access the static site through `ProtectedReadBaseUrl`. If the frontend route request does not include the signed-cookie names, CloudFront redirects to `/access`; after a correct code submission, `/auth/session` sets signed cookies and redirects back into the app. The API and media paths enforce those signed cookies through CloudFront trusted key groups.

The raw `execute-api` read routes are no longer anonymous. Browser reads only work when CloudFront injects `readOriginSecret` from the app secrets secret, and the mobile app must exchange the same shared code for a bearer token through `POST /auth/mobile/session`.

The protected distribution now reads both frontend assets and media directly from private S3 buckets through Origin Access Control. Once the stack-managed media bucket policy is in place, older public CloudFront media distributions that point at the same bucket will stop serving `files/*` and `thumbnails/*`.

### Access passphrase and login limits

Both `POST /auth/session` (web) and `POST /auth/mobile/session` (mobile) go through a login limiter backed by the stack's `LoginAttemptsTable`:

- After `LoginGlobalFailuresPerHour` wrong codes (from anyone) in a clock hour, every login pauses for 1 hour and a `LOGIN_GLOBAL_LOCK` warning is logged.
- If the limiter table cannot be reached, logins are refused (fail closed).
- There is no per-IP tracking on purpose: the site sits behind Cloudflare, so the IP the backend sees is a Cloudflare proxy, not the visitor.

The passphrase is case-insensitive and ignores extra spaces. Four or more random words are recommended.

Set or change it (prompts hidden, stores only the hash, live within 1 minute):

```bash
npm run set-access-code
npm run check-access-code                       # does a typed passphrase match the stored one?
node ./scripts/set-access-code.mjs --remove-plaintext   # also drop the legacy readAccessCode field
node ./scripts/set-access-code.mjs --print-only         # just print the hash
```

From PowerShell, call `node ./scripts/set-access-code.mjs` directly for flags; npm's PowerShell shim can swallow `--`.

Locked yourself out? Clear every counter and lock:

```bash
npm run unlock-logins
```

Both scripts find the stack from `samconfig.toml` (`stack_name`, `region`) and use your AWS CLI credentials. Override with `--stack`, `--region`, `--secret-id`, or `--table`.

### Access-code cookie keys

Before deploying the protected read distribution, create an RSA key pair, store the private key in Secrets Manager, and store the public key in SSM Parameter Store:

```bash
openssl genrsa -out cloudfront-private-key.pem 2048
openssl rsa -pubout -in cloudfront-private-key.pem -out cloudfront-public-key.pem
aws secretsmanager create-secret --name horny-grail/cloudfront-private-key --secret-string file://cloudfront-private-key.pem
aws ssm put-parameter --name /horny-grail/cloudfront-public-key --type String --value file://cloudfront-public-key.pem
```

Use:

- `/horny-grail/cloudfront-public-key` as `CloudFrontPublicKeyParameterName`
- the created secret ARN as `CloudFrontPrivateKeySecretArn`

Create another Secrets Manager secret for the app auth values:

```json
{
  "writeApiKey": "replace-with-write-api-key",
  "readAccessCodeHash": "set-with-npm-run-set-access-code",
  "readOriginSecret": "replace-with-long-random-string",
  "mobileReadTokenSecret": "replace-with-different-long-random-string"
}
```

Use that secret ARN as `AppSecretsSecretArn`.

### Frontend bucket policy

The frontend bucket policy is managed by this stack and scoped to the protected distribution. It allows only CloudFront Origin Access Control to read the private frontend bucket:

```json
{
  "Sid": "AllowProtectedReadDistribution",
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudfront.amazonaws.com"
  },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::hornygrail-front/*",
  "Condition": {
    "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::<account-id>:distribution/<distribution-id>"
    }
  }
}
```

If the target bucket already has an unmanaged policy in a new environment, delete or import that policy before deploying this stack resource.

## Storage and Upload Rules

The backend does not accept raw media bytes directly. Desktop and mobile clients must:

1. Compute SHA-256 and use it as `id`
2. Call `POST /api/uploads/sign`
3. Upload bytes to the returned S3 presigned URL (original and thumbnail)
4. Register metadata through `POST /api`

`POST /api` checks that both `files/<id>.<ext>` and `thumbnails/thumbnail-<id>.jpeg` exist before creating a new item, and returns `409` with `missing: ["original" | "thumbnail"]` otherwise, so browse never lists an item without its files. Re-registering an existing item returns it unchanged without the S3 check, which keeps retries and repair flows working.

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
- a numeric `randomKey` (items without one are missing from the index)

`POST /api` currently sets both fields on new metadata writes. If existing data is imported into the table later, it must be backfilled with those fields before relying on random discovery.

Both endpoints read every active item from `RandomImageIndex` per request (the collection is small: a few hundred items is a few read units):

- `get-random-image` picks one item uniformly. `randomKey` is only the index sort key now, so gaps between keys no longer bias the pick.
- `browse/random` orders items by `sha256(seed:id)`, with a new random seed per session. The cursor holds `{ seed, after }`, where `after` is the last position shown. An item added or removed mid-session does not reshuffle the rest, so nothing repeats or gets skipped. Cursors from the old `{ seed, segment, startKey }` format start a fresh shuffle; malformed cursors return 400.

If the collection grows into the tens of thousands, cache the item list per container or move to a stored shuffle.

## Verification

Run these checks when changing backend code or infrastructure:

- `npm run test`
- `sam build`

For template changes that affect IAM, S3 permissions, or API routes, also verify the generated CloudFormation changeset before deployment.
