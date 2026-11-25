# Security Notes

## API

- Everything sits behind one passphrase. The web gets CloudFront signed cookies from `POST /auth/session`; the mobile app gets a 1-hour bearer token from `POST /auth/mobile/session`. Only an scrypt hash of the passphrase is stored.
- Wrong passphrases are counted across everyone: after `LoginGlobalFailuresPerHour` (default 20) in an hour, all logins pause for an hour. `npm run unlock-logins` clears it.
- Web read routes only answer requests that carry CloudFront's origin secret header, so the raw `execute-api` URL is useless on its own.
- Write routes (sign upload, register, integrity) accept the desktop `x-api-key` or a mobile session. Delete accepts only the write key. The mobile app ships no key.
- Every secret lives in one Secrets Manager secret that the Lambdas read at runtime (cached for a minute), so none appear in the Lambda console and rotating one needs no deploy. CloudFront's copy of the origin secret is the exception: it is resolved at deploy time.
- Clients upload only through backend-issued presigned URLs, never with AWS credentials. Originals carry a SHA-256 checksum header, so S3 rejects content that does not match its id.
- API Gateway CORS origins are controlled by the `AllowedCorsOrigins` SAM parameter.
- Local development currently needs both `http://localhost:5173` for the Svelte frontend and `http://localhost:1420` for Tauri dev.
- Browser uploads to presigned S3 URLs also require S3 bucket CORS on the configured upload bucket.
- Handlers validate image IDs as 64-character hex strings, extensions against supported media formats, MIME type against extension, and upload byte length before issuing presigned S3 URLs.
- The shared desktop/mobile upload contract is documented in `docs/upload-contract.md`.

## Desktop Binary Dependencies

On Windows, the desktop app bundles `src-tauri/binaries/ffmpeg.exe` so WebM thumbnails can be generated natively without requiring users to install ffmpeg. On non-Windows, the desktop app falls back to `ffmpeg` from `PATH`.

Security and distribution notes:

- Treat the bundled ffmpeg binary as a third-party executable dependency.
- Replace it only from a trusted ffmpeg distribution source.
- Rebuild the Tauri app after replacement to verify the binary is packaged into the installer.
- The currently bundled ffmpeg build is GPL-enabled; distribution must account for ffmpeg's license obligations.

## S3

The image bucket is external to the SAM stack, so bucket policy and object-level IAM role permissions must be managed in AWS. The DynamoDB metadata table is managed by the SAM stack.

Configured bucket:

```text
Set this per environment with the SAM `BucketName` parameter or local `BUCKET_NAME` env value.
```

Current bucket region:

```text
us-west-2
```

Required bucket CORS for local development:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "http://localhost:1420",
        "http://localhost:5173"
      ],
      "AllowedMethods": [
        "PUT",
        "GET",
        "HEAD"
      ],
      "AllowedHeaders": [
        "content-type"
      ],
      "ExposeHeaders": [
        "ETag"
      ],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

The same configuration is stored in `docs/aws/upload-bucket-cors.json`. Add production web or mobile web origins explicitly; do not use `*` for upload origins. Native mobile clients are not browser-CORS constrained, but any WebView or hosted mobile web uploader origin must be listed.

Apply or inspect the current CORS config without hardcoding the bucket name:

```bash
export UPLOAD_BUCKET_NAME=your-upload-bucket-name
aws s3api get-bucket-cors --bucket "$UPLOAD_BUCKET_NAME"
aws s3api put-bucket-cors --bucket "$UPLOAD_BUCKET_NAME" --cors-configuration file://docs/aws/upload-bucket-cors.json
```

Recommended bucket public access settings:

```bash
aws s3api put-public-access-block \
  --bucket "$UPLOAD_BUCKET_NAME" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

The baseline bucket policy in `docs/aws/upload-bucket-policy-baseline.json` denies non-TLS S3 access. Merge it with any existing CloudFront OAC/OAI read policy instead of replacing a live bucket policy blindly.

The stack defines three Lambda roles (see `template.yaml`):

- `AuthFunction`: reads the app secret and the CloudFront private key; read/write on the login-attempts table.
- `ReadFunction`: reads the app secret and the metadata table; `s3:GetObject` on `files/*` and `thumbnails/*` to presign mobile media URLs.
- `WriteFunction`: reads the app secret; read/write on the metadata table (register and delete); `s3:PutObject` and `s3:GetObject` on `files/*` and `thumbnails/*`, plus `s3:ListBucket` so a missing object reads as 404.

For reference, signing uploads alone needs only:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-upload-bucket-name/files/*",
        "arn:aws:s3:::your-upload-bucket-name/thumbnails/*"
      ]
    }
  ]
}
```

Do not grant broad `s3:*` or bucket-wide object access to backend roles.

Bucket-side checklist:

- Keep direct public writes disabled; clients upload only through backend-issued presigned URLs.
- Keep direct public reads disabled unless intentionally serving outside CloudFront.
- Keep upload CORS limited to known browser origins and `content-type`.
- Keep Lambda S3 access limited to `files/*` and `thumbnails/*`.
- Preserve CloudFront read access through the existing distribution policy mechanism.
