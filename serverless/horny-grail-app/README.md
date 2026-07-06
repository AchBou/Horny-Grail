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
- `GET /api/mobile/assets/{id}/integrity`

Access endpoint:

- `POST /auth/session`

Write and repair endpoints:

- `GET /api/assets/{id}/integrity`
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
- `BUCKET_NAME`
- `BUCKET_REGION`
- `WRITE_API_KEY`
- `CORS_ALLOWED_ORIGINS`

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

Notes:

- The stack owns the DynamoDB metadata table.
- The table uses `id` as the primary key.
- `RandomImageIndex` is required for `GET /api/get-random-image` and `GET /api/browse/random`.
- If a table with the target name already exists outside CloudFormation, import it or deploy with a new name.
- `FrontendBucketName` is the private S3 bucket that stores the built frontend assets. S3 website hosting is not required.
- `BucketName` is now both the upload target and the protected media origin behind CloudFront OAC.
- `AppSecretsSecretArn` points to a Secrets Manager JSON secret with these fields:
  - `writeApiKey`
  - `readAccessCode`
  - `readOriginSecret`
  - `mobileReadTokenSecret`
- `readAccessCode` is the shared code users enter on the static access page.
- `readOriginSecret` is injected by CloudFront into the raw API origin so the web read routes cannot be called directly on the `execute-api` hostname.
- `mobileReadTokenSecret` signs the short-lived bearer tokens returned by `POST /auth/mobile/session`.
- `MobileReadTokenTtlSeconds` defaults to `3600` seconds, which keeps a successful mobile session for 1 hour.
- `MobileSignedUrlTtlSeconds` defaults to `900` seconds, which keeps mobile media URLs valid for 15 minutes before the app refreshes them with another authenticated read request.
- `CloudFrontPublicKeyParameterName` points to an SSM parameter containing the PEM public key CloudFront uses to verify signed cookies.
- `CloudFrontPrivateKeySecretArn` points to a Secrets Manager secret containing the matching PEM private key.
- `AccessCookieTtlSeconds` defaults to `3600` seconds, which keeps a successful session for 1 hour.
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
  "readAccessCode": "replace-with-shared-code",
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
