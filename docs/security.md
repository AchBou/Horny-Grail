# Security Notes

## API

- Public read endpoints remain unauthenticated by design.
- Write endpoints require the `x-api-key` header and the Lambda runtime `WRITE_API_KEY` value.
- The desktop uploader should use backend-issued presigned URLs rather than direct AWS credentials.
- API Gateway CORS origins are controlled by the `AllowedCorsOrigins` SAM parameter.
- Local development currently needs both `http://localhost:5173` for the Svelte frontend and `http://localhost:1420` for Tauri dev.
- Browser uploads to presigned S3 URLs also require S3 bucket CORS on `my-awesome-very-secret-upload-bucket`.
- Handlers validate image IDs as 64-character hex strings and image extensions against supported image formats.

## Desktop Binary Dependencies

The desktop app bundles `src-tauri/binaries/ffmpeg.exe` so WebM thumbnails can be generated natively without requiring users to install ffmpeg.

Security and distribution notes:

- Treat the bundled ffmpeg binary as a third-party executable dependency.
- Replace it only from a trusted ffmpeg distribution source.
- Rebuild the Tauri app after replacement to verify the binary is packaged into the installer.
- The currently bundled ffmpeg build is GPL-enabled; distribution must account for ffmpeg's license obligations.

## S3

The image bucket is external to the SAM stack, so bucket policy and IAM role permissions must be managed in AWS.

Current bucket:

```text
my-awesome-very-secret-upload-bucket
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
        "*"
      ],
      "ExposeHeaders": [
        "ETag"
      ],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

The backend role that serves `POST /api/uploads/sign` needs these S3 permissions:

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
        "arn:aws:s3:::my-awesome-very-secret-upload-bucket/files/*",
        "arn:aws:s3:::my-awesome-very-secret-upload-bucket/thumbnails/*"
      ]
    }
  ]
}
```

The metadata write/read Lambda role also needs DynamoDB access limited to the configured table:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem"
      ],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/horny-grail-table"
    }
  ]
}
```

Do not grant broad `s3:*`, bucket-wide object access, or DynamoDB table CRUD permissions to backend roles.
