# HornyGrail Backend

AWS SAM backend for HornyGrail metadata, randomized browse, asset integrity checks, and presigned uploads.

## Current Responsibilities

- Store image and video metadata in DynamoDB using SHA-256 `id` as the primary key
- Maintain `status` and `randomKey` fields for random discovery
- Serve read endpoints for item lookup, random item lookup, and randomized browse
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

Read endpoints:

- `GET /api`
- `GET /api/`
- `GET /api/{id}`
- `GET /api/get-random-image`
- `GET /api/browse/random`
- `GET /api/thumbnails`
- `GET /api/assets/{id}/integrity`

Access endpoint:

- `POST /auth/session`

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
- `FrontendBucketName`
- `MediaOriginDomainName`
- `BucketName`
- `BucketRegion`
- `WriteApiKey`
- `ReadAccessCode`
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
- `CloudFrontBaseUrl` is still used by read handlers that include media URLs in responses. The static frontend should build media URLs from `PUBLIC_CLOUDFRONT_BASE_URL` when possible.
- `FrontendBucketName` is the private S3 bucket that stores the built frontend assets. S3 website hosting is not required.
- `MediaOriginDomainName` should be the existing origin currently serving `/files/*` and `/thumbnails/*`.
- `ReadAccessCode` is the shared code users enter on the static access page.
- `CloudFrontPublicKeyParameterName` points to an SSM parameter containing the PEM public key CloudFront uses to verify signed cookies.
- `CloudFrontPrivateKeySecretArn` points to a Secrets Manager secret containing the matching PEM private key.
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
- `ProtectedReadDistributionArn`

Point:

- `front/PUBLIC_API_BASE_URL` to `ProtectedReadApiBaseUrl`
- `front/PUBLIC_CLOUDFRONT_BASE_URL` to `ProtectedReadMediaBaseUrl`
- the frontend deploy invalidation target to `ProtectedReadDistributionId`

Users access the static site through `ProtectedReadBaseUrl`. If the frontend route request does not include the signed-cookie names, CloudFront redirects to `/access`; after a correct code submission, `/auth/session` sets signed cookies and redirects back into the app. The API and media paths enforce those signed cookies through CloudFront trusted key groups.

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
- your shared code as `ReadAccessCode`

### Frontend bucket policy

The frontend bucket policy is now managed by this stack and scoped to the protected distribution.

Because `hornygrail-front` already has an unmanaged bucket policy today, the first adoption step is one-time:

1. Delete the existing bucket policy from `hornygrail-front`.
2. Redeploy this SAM stack.

After that, CloudFormation owns the bucket policy and keeps it aligned with the current protected distribution.

The managed policy statement looks like this:

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

This allows only the protected distribution to read the private frontend bucket through Origin Access Control.

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
